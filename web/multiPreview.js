import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const VERSION = "v25-phase5-visible-receiver-test";
const NODE_NAME = "MultiPreview";
const RECEIVER_NODE_NAME = "MultiPreviewReceiver";
const MAX_PINS = 32;
const CANVAS_WIDGET_NAME = "multi_preview_canvas";

console.log(`[MultiPreview] ${VERSION} loaded`);

function requestRedraw(node) {
  if (typeof node?.setDirtyCanvas === "function") {
    node.setDirtyCanvas(true, true);
  } else if (app?.canvas?.setDirty) {
    app.canvas.setDirty(true, true);
  }
}

function requestResizeAndRedraw(node) {
  if (typeof node?.setSize === "function" && node.size) {
    node.setSize(node.size);
  }
  requestRedraw(node);
}

function isOurWidget(widget) {
  return !!widget && (widget.__mpPinKey || widget.__mpParentIdWidget || widget.name === CANVAS_WIDGET_NAME);
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
    console.warn("[MultiPreview] failed to parse json payload", error, value);
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
  return {};
}

function normalizePinImages(value) {
  value = parseMaybeJson(value);
  value = unwrapSingle(value);

  const result = emptyPinImages();
  if (!isPlainObject(value)) return result;

  for (const key of Object.keys(value)) {
    if (!/^\d+$/.test(String(key))) continue;
    result[String(key)] = normalizeImages(value[key]);
  }

  return result;
}

function countPinImages(pinImages) {
  if (!isPlainObject(pinImages)) return 0;
  return Object.keys(pinImages).reduce((sum, pinKey) => {
    return sum + normalizeImages(pinImages?.[pinKey]).length;
  }, 0);
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

function extractReceiverPayload(output) {
  const candidates = [
    output?.mp_receiver_json,
    output?.mp_receiver,
    output?.ui?.mp_receiver_json,
    output?.ui?.mp_receiver,
  ];

  for (const candidate of candidates) {
    const parsed = parseMaybeJson(candidate);
    const payload = unwrapSingle(parsed);
    if (!isPlainObject(payload)) continue;

    const parentId = Number(payload.parent_id ?? payload.parentId ?? payload.parent);
    const pin = Number(payload.pin ?? payload.pin_index ?? payload.pinIndex);
    const images = normalizeImages(payload.images);

    if (Number.isFinite(parentId) && Number.isInteger(pin) && pin >= 1 && images.length > 0) {
      return {
        parentId,
        pinKey: String(pin),
        images,
      };
    }
  }

  return null;
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

function getSelectedPin(node) {
  node.properties ??= {};
  return String(node.properties.selected_pin || "1");
}

function setSelectedPin(node, pinKey) {
  node.properties ??= {};
  node.properties.selected_pin = String(pinKey);
}

function getPinNumberFromInput(input) {
  const match = String(input?.name || "").match(/^image(\d+)$/);
  if (!match) return null;
  const num = Number(match[1]);
  if (!Number.isInteger(num) || num < 1) return null;
  return num;
}

function getImageInputs(node) {
  return (node.inputs || [])
    .map((input, index) => ({ input, index, num: getPinNumberFromInput(input) }))
    .filter((item) => item.num !== null)
    .sort((a, b) => a.num - b.num);
}

function inputPinKeys(node) {
  return getImageInputs(node).map((item) => String(item.num));
}

function receivedPinKeys(node) {
  const keys = Object.keys(node.__mpPinImages || {})
    .filter((key) => /^\d+$/.test(key))
    .filter((key) => normalizeImages(node.__mpPinImages?.[key]).length > 0);

  return keys.sort((a, b) => Number(a) - Number(b));
}

function currentPinKeys(node) {
  const keys = new Set([...inputPinKeys(node), ...receivedPinKeys(node)]);
  return [...keys].sort((a, b) => Number(a) - Number(b));
}

function findImageInputIndex(node, pinNumber) {
  return (node.inputs || []).findIndex((input) => getPinNumberFromInput(input) === Number(pinNumber));
}

function isInputConnected(input) {
  return input?.link != null;
}

function ensureImageInput(node, pinNumber) {
  if (findImageInputIndex(node, pinNumber) !== -1) return false;

  if (typeof node.addInput === "function") {
    node.addInput(`image${pinNumber}`, "IMAGE");
    return true;
  }

  node.inputs ??= [];
  node.inputs.push({ name: `image${pinNumber}`, type: "IMAGE", link: null });
  return true;
}

function removeImageInput(node, pinNumber) {
  const index = findImageInputIndex(node, pinNumber);
  if (index === -1) return false;

  const input = node.inputs?.[index];
  if (isInputConnected(input)) return false;

  if (typeof node.removeInput === "function") {
    node.removeInput(index);
  } else {
    node.inputs.splice(index, 1);
  }
  return true;
}

function desiredInputCount(node) {
  const imageInputs = getImageInputs(node);

  let maxConnected = 0;
  for (const { input, num } of imageInputs) {
    if (isInputConnected(input)) {
      maxConnected = Math.max(maxConnected, num);
    }
  }

  if (maxConnected <= 0) return 1;
  return Math.min(MAX_PINS, maxConnected + 1);
}

function reconcileDynamicInputs(node) {
  if (!node || node.__mpReconcilingPins) return;
  node.__mpReconcilingPins = true;

  try {
    const desiredCount = desiredInputCount(node);

    for (let num = 1; num <= desiredCount; num += 1) {
      ensureImageInput(node, num);
    }

    const imageInputsDesc = getImageInputs(node).sort((a, b) => b.num - a.num);
    for (const { input, num } of imageInputsDesc) {
      if (num <= desiredCount) continue;
      if (isInputConnected(input)) continue;
      removeImageInput(node, num);
    }

    ensureButtonWidgetsForPins(node);
    removeStandardPreviewWidgetsSoon(node);
  } finally {
    node.__mpReconcilingPins = false;
  }

  requestResizeAndRedraw(node);
}

function hasImagesForPin(node, pinKey) {
  return normalizeImages(node.__mpPinImages?.[String(pinKey)]).length > 0;
}

function firstAvailablePin(node) {
  const keys = currentPinKeys(node);
  return keys.find((pinKey) => hasImagesForPin(node, pinKey)) || keys[0] || "1";
}

function syncContextMenuImages(node, entries) {
  node.images = entries.map((entry) => entry.data);
  node.imgs = entries.map((entry) => entry.img);
  node.imageIndex = 0;
  node.overIndex = null;
}

function updateButtonLabels(node) {
  if (!node.widgets) return;
  const selectedPin = getSelectedPin(node);
  const validPins = new Set(currentPinKeys(node));

  for (const widget of node.widgets) {
    if (!widget.__mpPinKey) continue;

    const pinKey = String(widget.__mpPinKey);
    const hasImages = hasImagesForPin(node, pinKey);
    const label = `${pinKey}${selectedPin === pinKey ? " *" : ""}${hasImages ? "" : " -"}`;

    widget.value = label;
    widget.name = label;
    widget.disabled = !validPins.has(pinKey);
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

function ensureButtonWidgetsForPins(node) {
  node.widgets ??= [];

  const validPins = currentPinKeys(node);

  node.widgets = node.widgets.filter((widget) => {
    if (!widget.__mpPinKey) return true;
    return validPins.includes(String(widget.__mpPinKey));
  });

  for (const pinKey of validPins) {
    const existing = node.widgets.find((widget) => String(widget.__mpPinKey) === pinKey);
    if (existing) continue;

    const widget = node.addWidget("button", pinKey, pinKey, () => selectPin(node, pinKey), {});
    widget.__mpPinKey = pinKey;
  }

  const nonPinWidgets = node.widgets.filter((widget) => !widget.__mpPinKey);
  const pinWidgets = node.widgets
    .filter((widget) => widget.__mpPinKey)
    .sort((a, b) => Number(a.__mpPinKey) - Number(b.__mpPinKey));

  node.widgets = [...nonPinWidgets, ...pinWidgets];

  updateButtonLabels(node);
}

function ensureParentIdWidget(node) {
  if (!node.widgets) return;

  const value = String(node.id ?? "");
  let widget = node.widgets.find((w) => w.__mpParentIdWidget);
  if (!widget) {
    widget = node.addWidget("text", "parent_id", value, () => {}, {});
    widget.__mpParentIdWidget = true;
    widget.disabled = true;
  }

  widget.value = value;
}

function ensureWidgets(node) {
  node.properties ??= {};
  node.properties.selected_pin ??= "1";
  node.__mpPinImages ??= emptyPinImages();
  node.__mpEntries ??= [];

  syncContextMenuImages(node, node.__mpEntries);
  ensureParentIdWidget(node);

  if (!node.__mpWidgetsReady) {
    node.__mpWidgetsReady = true;

    reconcileDynamicInputs(node);

    node.size[0] = Math.max(node.size?.[0] || 0, 320);
    node.size[1] = Math.max(node.size?.[1] || 0, 390);
  } else {
    reconcileDynamicInputs(node);
  }

  ensureButtonWidgetsForPins(node);
  removeStandardPreviewWidgetsSoon(node);
  updateButtonLabels(node);
  requestRedraw(node);
}

function findNodeById(id) {
  const wanted = String(id);

  if (app?.graph?.getNodeById) {
    const node = app.graph.getNodeById(Number(id));
    if (node) return node;
  }

  for (const node of app?.graph?._nodes || []) {
    if (String(node.id) === wanted) return node;
  }

  return null;
}

function applyReceiverPayloadToParent(payload) {
  if (!payload) return false;

  const parent = findNodeById(payload.parentId);
  if (!parent) {
    console.warn(`[MultiPreviewReceiver] parent node not found: ${payload.parentId}`);
    return false;
  }

  ensureWidgets(parent);

  parent.__mpPinImages ??= emptyPinImages();
  parent.__mpPinImages[payload.pinKey] = payload.images;

  ensureButtonWidgetsForPins(parent);

  const selectedPin = getSelectedPin(parent);
  const shouldDisplayNow =
    selectedPin === payload.pinKey ||
    !hasImagesForPin(parent, selectedPin) ||
    !(parent.__mpEntries || []).length;

  if (shouldDisplayNow) {
    selectPin(parent, payload.pinKey);
  } else {
    updateButtonLabels(parent);
    requestRedraw(parent);
  }

  removeStandardPreviewWidgetsSoon(parent);
  requestRedraw(parent);
  return true;
}

app.registerExtension({
  name: `mick.MultiPreview.${VERSION}`,

  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name === NODE_NAME) {
      const originalOnNodeCreated = nodeType.prototype.onNodeCreated;
      const originalOnConfigure = nodeType.prototype.onConfigure;
      const originalOnExecuted = nodeType.prototype.onExecuted;
      const originalOnConnectionsChange = nodeType.prototype.onConnectionsChange;

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

      nodeType.prototype.onConnectionsChange = function (...args) {
        const result = originalOnConnectionsChange?.apply(this, args);

        setTimeout(() => {
          reconcileDynamicInputs(this);

          const selectedPin = getSelectedPin(this);
          if (!currentPinKeys(this).includes(selectedPin)) {
            setSelectedPin(this, firstAvailablePin(this));
          }

          updateButtonLabels(this);
          requestRedraw(this);
        }, 0);

        return result;
      };

      nodeType.prototype.onExecuted = function (output, ...args) {
        void originalOnExecuted;
        void args;

        ensureWidgets(this);
        removeStandardPreviewWidgetsSoon(this);

        const pinImages = extractPinImages(output);
        if (countPinImages(pinImages) > 0) {
          this.__mpPinImages = {
            ...(this.__mpPinImages || {}),
            ...pinImages,
          };

          let selectedPin = getSelectedPin(this);
          if (!hasImagesForPin(this, selectedPin)) {
            selectedPin = firstAvailablePin(this);
          }

          selectPin(this, selectedPin);
        }

        reconcileDynamicInputs(this);
        removeStandardPreviewWidgetsSoon(this);
        updateButtonLabels(this);
        requestRedraw(this);
      };
    }

    if (nodeData.name === RECEIVER_NODE_NAME) {
      const originalOnExecuted = nodeType.prototype.onExecuted;

      nodeType.prototype.onExecuted = function (output, ...args) {
        // Receiver must not create its own preview. It only forwards images to parent.
        void originalOnExecuted;
        void args;

        const payload = extractReceiverPayload(output);
        applyReceiverPayloadToParent(payload);
      };
    }
  },
});
