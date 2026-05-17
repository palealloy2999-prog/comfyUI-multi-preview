import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const VERSION = "v25-phase2-fix8-fix3-base";
const NODE_NAME = "MultiPreview";
const PIN_KEYS = ["1", "2"];
const CANVAS_WIDGET_NAME = "multi_preview_canvas";

console.log(`[MultiPreview] ${VERSION} loaded`);

function requestRedraw(node) {
  if (typeof node?.setDirtyCanvas === "function") {
    node.setDirtyCanvas(true, true);
  } else if (app?.canvas?.setDirty) {
    app.canvas.setDirty(true, true);
  }
}


function isOurWidget(widget) {
  return !!widget && (widget.__mpPinKey || widget.name === CANVAS_WIDGET_NAME);
}

function looksLikeStandardPreviewWidget(widget) {
  if (!widget || isOurWidget(widget)) return false;

  const name = String(widget.name || "").toLowerCase();
  const type = String(widget.type || "").toLowerCase();
  const ctor = String(widget.constructor?.name || "").toLowerCase();

  return (
    widget.name === "$$canvas-image-preview" ||
    name.includes("preview") ||
    name.includes("image") ||
    type === "image" ||
    ctor.includes("imagepreview")
  );
}

function removeStandardPreviewWidgets(node) {
  if (!Array.isArray(node?.widgets)) return;

  const before = node.widgets.length;
  node.widgets = node.widgets.filter((widget) => !looksLikeStandardPreviewWidget(widget));

  if (before !== node.widgets.length) {
    requestRedraw(node);
  }
}

function removeStandardPreviewWidgetsSoon(node) {
  removeStandardPreviewWidgets(node);

  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(() => removeStandardPreviewWidgets(node));
  }

  setTimeout(() => removeStandardPreviewWidgets(node), 0);
  setTimeout(() => removeStandardPreviewWidgets(node), 50);
}

function imageDataToUrl(data) {
  const filename = encodeURIComponent(data?.filename ?? "");
  const type = encodeURIComponent(data?.type ?? "temp");
  const subfolder = encodeURIComponent(data?.subfolder ?? "");
  const previewFormat = typeof app.getPreviewFormatParam === "function" ? app.getPreviewFormatParam() : "";
  const rand = typeof app.getRandParam === "function" ? app.getRandParam() : `&rand=${Math.random()}`;
  return api.apiURL(`/view?filename=${filename}&type=${type}&subfolder=${subfolder}${previewFormat}${rand}`);
}

function isImageMeta(value) {
  return !!value && typeof value === "object" && typeof value.filename === "string";
}

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function unwrapSingle(value) {
  let current = value;
  let guard = 0;

  while (Array.isArray(current) && current.length === 1 && guard < 10) {
    const only = current[0];
    // Keep a single image metadata object wrapped as an image list.
    if (isImageMeta(only)) break;
    current = only;
    guard += 1;
  }

  return current;
}

function maybeJoinCharArray(value) {
  if (!Array.isArray(value) || value.length === 0) return value;
  if (!value.every((item) => typeof item === "string" && item.length === 1)) return value;
  return value.join("");
}

function parseMaybeJson(value) {
  value = maybeJoinCharArray(value);
  value = unwrapSingle(value);
  value = maybeJoinCharArray(value);

  if (typeof value !== "string") return value;

  try {
    return JSON.parse(value);
  } catch (error) {
    console.warn("[MultiPreview] failed to parse mp_images_json", error, value);
    return null;
  }
}

function normalizeImages(value) {
  value = unwrapSingle(value);
  if (!value) return [];

  if (isImageMeta(value)) return [value];

  if (Array.isArray(value)) {
    const result = [];
    for (const item of value) {
      if (isImageMeta(item)) {
        result.push(item);
      } else {
        result.push(...normalizeImages(item));
      }
    }
    return result;
  }

  if (isPlainObject(value)) {
    if (Array.isArray(value.images)) return normalizeImages(value.images);

    const numericValues = Object.keys(value)
      .filter((key) => /^\d+$/.test(key))
      .sort((a, b) => Number(a) - Number(b))
      .map((key) => value[key]);

    if (numericValues.length > 0) return normalizeImages(numericValues);
  }

  return [];
}

function emptyPinImages() {
  const result = {};
  for (const pinKey of PIN_KEYS) result[pinKey] = [];
  return result;
}

function normalizePinImages(value) {
  value = parseMaybeJson(value);
  value = unwrapSingle(value);

  const result = emptyPinImages();
  if (!isPlainObject(value)) return result;

  for (const pinKey of PIN_KEYS) {
    result[pinKey] = normalizeImages(value[pinKey]);
  }

  return result;
}

function countPinImages(pinImages) {
  return PIN_KEYS.reduce((sum, pinKey) => sum + normalizeImages(pinImages?.[pinKey]).length, 0);
}

function extractPinImages(output) {
  const candidates = [
    output?.mp_images_json,
    output?.mp_images,
    output?.ui?.mp_images_json,
    output?.ui?.mp_images,
  ];

  for (const candidate of candidates) {
    const normalized = normalizePinImages(candidate);
    if (countPinImages(normalized) > 0) return normalized;
  }

  return emptyPinImages();
}

function makeImageEntry(node, data, index) {
  const url = imageDataToUrl(data);
  const img = new Image();

  const entry = {
    data,
    index,
    url,
    img,
    loaded: false,
    error: false,
  };

  img.onload = () => {
    entry.loaded = true;
    requestRedraw(node);
  };

  img.onerror = () => {
    entry.error = true;
    console.warn(`[MultiPreview] failed to load preview image: ${url}`);
    requestRedraw(node);
  };

  img.src = url;
  return entry;
}

function drawPlaceholder(ctx, text, x, y, w, h) {
  /*
  ctx.save();
  ctx.fillStyle = "rgba(80, 80, 80, 0.18)";
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = "rgba(180, 180, 180, 0.32)";
  ctx.strokeRect(x, y, w, h);
  ctx.fillStyle = "rgba(220, 220, 220, 0.72)";
  ctx.font = "13px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x + w / 2, y + h / 2);
  ctx.restore();
  */
}

function drawContainImage(ctx, img, x, y, w, h) {
  if (!img?.naturalWidth || !img?.naturalHeight) return;

  const imageAspect = img.naturalWidth / img.naturalHeight;
  const areaAspect = w / h;
  let dw;
  let dh;

  if (imageAspect > areaAspect) {
    dw = w;
    dh = w / imageAspect;
  } else {
    dh = h;
    dw = h * imageAspect;
  }

  const dx = x + (w - dw) / 2;
  const dy = y + (h - dh) / 2;
  ctx.drawImage(img, dx, dy, dw, dh);
}

function getSelectedPin(node) {
  node.properties ??= {};
  return String(node.properties.selected_pin || "1");
}

function setSelectedPin(node, pinKey) {
  node.properties ??= {};
  node.properties.selected_pin = String(pinKey);
}

function hasImagesForPin(node, pinKey) {
  return normalizeImages(node.__mpPinImages?.[pinKey]).length > 0;
}

function firstAvailablePin(node) {
  return PIN_KEYS.find((pinKey) => hasImagesForPin(node, pinKey)) || "1";
}

function syncContextMenuImages(node, entries) {
  // Some ComfyUI extensions read node.imgs[node.imageIndex] directly.
  // Keep those fields defined even though MultiPreview draws its own canvas.
  node.images = entries.map((entry) => entry.data);
  node.imgs = entries.map((entry) => entry.img);
  node.imageIndex = 0;
  node.overIndex = null;
}

function updateButtonLabels(node) {
  if (!node.widgets) return;
  const selectedPin = getSelectedPin(node);

  for (const pinKey of PIN_KEYS) {
    const widget = node.widgets.find((w) => w.__mpPinKey === pinKey);
    if (!widget) continue;

    const hasImages = hasImagesForPin(node, pinKey);
    const label = `${pinKey}${selectedPin === pinKey ? " *" : ""}${hasImages ? "" : " -"}`;
    widget.value = label;
    widget.name = label;
  }
}

function selectPin(node, pinKey) {
  pinKey = String(pinKey);

  if (!hasImagesForPin(node, pinKey)) {
    updateButtonLabels(node);
    requestRedraw(node);
    return;
  }

  setSelectedPin(node, pinKey);

  const images = normalizeImages(node.__mpPinImages?.[pinKey]);
  node.__mpEntries = images.map((data, index) => makeImageEntry(node, data, index));

  syncContextMenuImages(node, node.__mpEntries);
  removeStandardPreviewWidgetsSoon(node);
  updateButtonLabels(node);
  requestRedraw(node);
}



function ensureWidgets(node) {
  if (node.__mpWidgetsReady) return;
  node.__mpWidgetsReady = true;

  node.properties ??= {};
  node.properties.selected_pin ??= "1";
  node.__mpPinImages ??= emptyPinImages();
  node.__mpEntries ??= [];
  syncContextMenuImages(node, node.__mpEntries);

  for (const pinKey of PIN_KEYS) {
    const widget = node.addWidget("button", pinKey, pinKey, () => selectPin(node, pinKey), {});
    widget.__mpPinKey = pinKey;
  }
  
  removeStandardPreviewWidgetsSoon(node);

  node.size[0] = Math.max(node.size?.[0] || 0, 320);
  node.size[1] = Math.max(node.size?.[1] || 0, 390);

  updateButtonLabels(node);
  requestRedraw(node);
}

app.registerExtension({
  name: `mick.MultiPreview.${VERSION}`,

  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== NODE_NAME) return;

    const originalOnNodeCreated = nodeType.prototype.onNodeCreated;
    const originalOnConfigure = nodeType.prototype.onConfigure;
    const originalOnExecuted = nodeType.prototype.onExecuted;

    nodeType.prototype.onNodeCreated = function (...args) {
      const result = originalOnNodeCreated?.apply(this, args);
      ensureWidgets(this);
      return result;
    };

    nodeType.prototype.onConfigure = function (...args) {
      const result = originalOnConfigure?.apply(this, args);
      ensureWidgets(this);
      return result;
    };

    nodeType.prototype.onExecuted = function (output, ...args) {
      // Do not call the inherited PreviewImage onExecuted here.
      // This node has its own switchable canvas, and calling the original
      // PreviewImage renderer can reintroduce duplicate previews.
      void originalOnExecuted;
      void args;

      ensureWidgets(this);
      removeStandardPreviewWidgetsSoon(this);

      this.__mpPinImages = extractPinImages(output);

      let selectedPin = getSelectedPin(this);
      if (!hasImagesForPin(this, selectedPin)) {
        selectedPin = firstAvailablePin(this);
      }

      selectPin(this, selectedPin);
      removeStandardPreviewWidgetsSoon(this);
      updateButtonLabels(this);
      requestRedraw(this);
    };
  },
});
