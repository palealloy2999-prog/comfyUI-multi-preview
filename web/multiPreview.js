import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const VERSION = "v1.2.1";
const NODE_NAME = "MultiPreview";
const AUTO_NODE_NAME = "MultiPreviewAuto";
const INTERNAL_RECEIVER_NODE_NAME = "MultiPreviewInternalReceiver";

// Keep this value in sync with MAX_PINS in nodes.py.
const MAX_PINS = 32;

const DEFAULT_NODE_WIDTH = 320;
const DEFAULT_NODE_HEIGHT = 390;
const MAX_UNWRAP_DEPTH = 10;
const STANDARD_PREVIEW_CLEANUP_DELAY_MS = 50;
const MAX_IMAGE_CACHE_ENTRIES = 128;

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

function isManagedPreviewNodeName(name) {
  return name === NODE_NAME || name === AUTO_NODE_NAME;
}

function isAutoPreviewNode(node) {
  return node?.type === AUTO_NODE_NAME || node?.comfyClass === AUTO_NODE_NAME;
}

function isOurWidget(widget) {
  return !!widget && widget.__mpPinKey;
}

function looksLikeStandardPreviewWidget(widget) {
  if (!widget || isOurWidget(widget)) return false;

  const name = String(widget.name || "").toLowerCase();
  const type = String(widget.type || "").toLowerCase();
  const ctor = String(widget.constructor?.name || "").toLowerCase();

  // Keep this intentionally conservative. This cleanup only targets the
  // standard image preview widget that ComfyUI may add asynchronously.
  return (
    widget.name === "$$canvas-image-preview" ||
    name.includes("preview") ||
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
  // ComfyUI can recreate the standard preview widget asynchronously after
  // node execution. Schedule cleanup across a few timing phases to avoid
  // duplicate previews without depending on one specific frontend lifecycle.
  removeStandardPreviewWidgets(node);

  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(() => removeStandardPreviewWidgets(node));
  }

  setTimeout(() => removeStandardPreviewWidgets(node), 0);
  setTimeout(() => removeStandardPreviewWidgets(node), STANDARD_PREVIEW_CLEANUP_DELAY_MS);
}

function imageDataToUrl(data) {
  const filename = encodeURIComponent(data?.filename ?? "");
  const type = encodeURIComponent(data?.type ?? "temp");
  const subfolder = encodeURIComponent(data?.subfolder ?? "");
  const previewFormat = typeof app.getPreviewFormatParam === "function" ? app.getPreviewFormatParam() : "";
  const rand = typeof app.getRandParam === "function" ? app.getRandParam() : `&rand=${Math.random()}`;
  return api.apiURL(`/view?filename=${filename}&type=${type}&subfolder=${subfolder}${previewFormat}${rand}`);
}

function imageCacheKey(data) {
  return [
    data?.type ?? "temp",
    data?.subfolder ?? "",
    data?.filename ?? "",
  ].join("/");
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

  while (Array.isArray(current) && current.length === 1 && guard < MAX_UNWRAP_DEPTH) {
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

function normalizeCustomReceiverEvent(event) {
  const detail = event?.detail ?? event ?? {};
  const payload = detail?.payload ?? detail;

  if (!payload || typeof payload !== "object") return null;

  const parentId = Number(payload.parent_id ?? payload.parentId ?? payload.parent);
  const pin = Number(payload.pin ?? payload.pin_index ?? payload.pinIndex);
  const images = normalizeImages(payload.images);

  if (!Number.isFinite(parentId) || !Number.isInteger(pin) || pin < 1 || images.length === 0) {
    return null;
  }

  return {
    parentId,
    pinKey: String(pin),
    images,
  };
}

function imageCacheForNode(node) {
  node.__mpImageCache ??= new Map();
  return node.__mpImageCache;
}

function trimImageCache(cache) {
  while (cache.size > MAX_IMAGE_CACHE_ENTRIES) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey === undefined) return;
    cache.delete(oldestKey);
  }
}

function makeImageEntry(node, data, index) {
  const key = imageCacheKey(data);
  const cache = imageCacheForNode(node);
  let cached = cache.get(key);

  if (!cached) {
    const url = imageDataToUrl(data);
    const img = new Image();

    cached = {
      url,
      img,
      loaded: false,
      error: false,
      waiters: [],
    };

    img.onload = () => {
      cached.loaded = true;
      cached.error = false;

      const waiters = cached.waiters.splice(0);
      for (const waiter of waiters) {
        try {
          waiter(cached);
        } catch (error) {
          console.warn("[MultiPreview] image load waiter failed", error);
        }
      }

      requestRedraw(node);
    };

    img.onerror = () => {
      cached.error = true;

      const waiters = cached.waiters.splice(0);
      for (const waiter of waiters) {
        try {
          waiter(cached);
        } catch (error) {
          console.warn("[MultiPreview] image error waiter failed", error);
        }
      }

      console.warn(`[MultiPreview] failed to load preview image: ${url}`);
      requestRedraw(node);
    };

    img.src = url;
    cache.set(key, cached);
    trimImageCache(cache);
  } else {
    // Refresh insertion order so the Map behaves like a tiny LRU cache.
    cache.delete(key);
    cache.set(key, cached);
  }

  // Return a per-display entry so duplicate images in different pins/batch
  // positions do not overwrite each other's index metadata.
  return {
    data,
    index,
    url: cached.url,
    img: cached.img,
    get loaded() {
      return cached.loaded;
    },
    get error() {
      return cached.error;
    },
    waiters: cached.waiters,
  };
}

function preloadImages(node, images) {
  normalizeImages(images).forEach((data, index) => makeImageEntry(node, data, index));
}

function preloadPinImages(node, pinImages) {
  if (!pinImages || typeof pinImages !== "object") return;

  for (const images of Object.values(pinImages)) {
    preloadImages(node, images);
  }
}

function whenEntryReady(entry, callback) {
  if (!entry) return false;

  if (entry.loaded || entry.error) {
    callback(entry);
    return true;
  }

  entry.waiters ??= [];
  entry.waiters.push(callback);
  return false;
}

function getTargetImageIndex(node, pinKey, entries, options = {}) {
  const maxIndex = Math.max(0, entries.length - 1);

  if (Number.isInteger(options?.targetIndex)) {
    return Math.min(Math.max(0, options.targetIndex), maxIndex);
  }

  // Default behavior: always restore per-pin index.
  return Math.min(getStoredPinIndex(node, pinKey), maxIndex);
}

function getSelectedPin(node) {
  node.properties ??= {};
  return String(node.properties.selected_pin || "1");
}

function setSelectedPin(node, pinKey) {
  node.properties ??= {};
  node.properties.selected_pin = String(pinKey);
}

function getAutoSwitchLatest(node) {
  if (isAutoPreviewNode(node)) return true;

  node.properties ??= {};
  return node.properties.auto_switch_latest === true;
}

function setAutoSwitchLatest(node, enabled) {
  node.properties ??= {};
  node.properties.auto_switch_latest = enabled === true;
}

function pinImageIndexMap(node) {
  node.__mpPinImageIndex ??= {};
  return node.__mpPinImageIndex;
}

function saveCurrentPinIndex(node) {
  const pinKey = getSelectedPin(node);
  if (!pinKey) return;

  const index = Number.isInteger(node.imageIndex) ? node.imageIndex : 0;
  pinImageIndexMap(node)[String(pinKey)] = Math.max(0, index);
}

function getStoredPinIndex(node, pinKey) {
  const raw = pinImageIndexMap(node)[String(pinKey)];
  return Number.isInteger(raw) ? Math.max(0, raw) : 0;
}

function setStoredPinIndex(node, pinKey, index) {
  pinImageIndexMap(node)[String(pinKey)] = Math.max(0, Number(index) || 0);
}

function clearStoredPinIndex(node, pinKey) {
  delete pinImageIndexMap(node)[String(pinKey)];
}

function reconcileConnectedPinIndexState(node) {
  const prev = new Set((node.__mpConnectedPinSnapshot || []).map((x) => String(x)));
  const next = new Set(connectedInputPinKeys(node));

  // Reset per-pin batch index when a pin is attached or detached.
  for (const pinKey of next) {
    if (!prev.has(pinKey)) {
      clearStoredPinIndex(node, pinKey);
    }
  }

  for (const pinKey of prev) {
    if (!next.has(pinKey)) {
      clearStoredPinIndex(node, pinKey);
    }
  }

  node.__mpConnectedPinSnapshot = [...next].sort((a, b) => Number(a) - Number(b));
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

function connectedInputPinKeys(node) {
  return getImageInputs(node)
    .filter(({ input }) => isInputConnected(input))
    .map((item) => String(item.num));
}

function buttonPinKeys(node) {
  if (isAutoPreviewNode(node)) return [];

  // Dynamic inputs include one extra empty pin for the next connection.
  // Buttons should be shown for:
  // - currently connected pins
  // - pins that still have last-run images
  //
  // This keeps the current preview/button state when a cable is disconnected.
  // The stale state is cleared at the next execution, not immediately on disconnect.
  const keys = new Set([...connectedInputPinKeys(node), ...receivedPinKeys(node)]);
  return [...keys].sort((a, b) => Number(a) - Number(b));
}

function receivedPinKeys(node) {
  const keys = Object.keys(node.__mpPinImages || {})
    .filter((key) => /^\d+$/.test(key))
    .filter((key) => normalizeImages(node.__mpPinImages?.[key]).length > 0);

  return keys.sort((a, b) => Number(a) - Number(b));
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
    // Do not clear disconnected pin previews here.
    // They are intentionally preserved until the next execution starts.
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
  const keys = buttonPinKeys(node);
  return keys.find((pinKey) => hasImagesForPin(node, pinKey)) || keys[0] || "1";
}

function prepareNodeStateForRun(node, activePinKeys) {
  if (!node) return;

  const active = new Set((activePinKeys || []).map((key) => String(key)));

  node.__mpPinImages ??= emptyPinImages();

  for (const key of Object.keys(node.__mpPinImages)) {
    if (!active.has(String(key))) {
      delete node.__mpPinImages[key];
    }
  }

  const selectedPin = getSelectedPin(node);
  if (!active.has(selectedPin)) {
    setSelectedPin(node, firstAvailablePin(node));
  }

  updateButtonLabels(node);
  requestRedraw(node);
}

function syncContextMenuImages(node, entries, options = {}) {
  const resetIndex = options?.resetIndex === true;
  const hasTargetIndex = Number.isInteger(options?.targetIndex);
  const prevIndex = Number.isInteger(node.imageIndex) ? node.imageIndex : 0;
  const maxIndex = Math.max(0, entries.length - 1);

  node.images = entries.map((entry) => entry.data);
  node.imgs = entries.map((entry) => entry.img);

  // Preserve the current batch page when other pins update or when the same
  // pin receives a new result. Reset only for explicit user pin switching.
  // targetIndex is used for auto-follow-latest mode.
  if (hasTargetIndex) {
    node.imageIndex = Math.min(Math.max(0, options.targetIndex), maxIndex);
  } else {
    node.imageIndex = resetIndex ? 0 : Math.min(Math.max(0, prevIndex), maxIndex);
  }

  node.overIndex = null;
}

function updateButtonLabels(node) {
  if (!node.widgets) return;
  const selectedPin = getSelectedPin(node);
  const validPins = new Set(buttonPinKeys(node));

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

function selectPin(node, pinKey, options = {}) {
  pinKey = String(pinKey);

  if (!hasImagesForPin(node, pinKey)) {
    updateButtonLabels(node);
    requestRedraw(node);
    return;
  }

  // Persist the current page of the currently selected pin before switching
  // or re-selecting, so same-pin updates also keep the last viewed page.
  saveCurrentPinIndex(node);

  const images = normalizeImages(node.__mpPinImages?.[pinKey]);
  const entries = images.map((data, index) => makeImageEntry(node, data, index));
  const targetIndex = getTargetImageIndex(node, pinKey, entries, options);
  const targetEntry = entries[targetIndex];

  if (
    options?.deferUntilLoaded === true &&
    (node.imgs || []).length > 0 &&
    targetEntry &&
    !targetEntry.loaded &&
    !targetEntry.error
  ) {
    const token = {};
    node.__mpPendingSelectionToken = token;

    whenEntryReady(targetEntry, () => {
      if (node.__mpPendingSelectionToken !== token) return;
      selectPin(node, pinKey, {
        ...options,
        deferUntilLoaded: false,
        targetIndex,
      });
    });

    updateButtonLabels(node);
    requestRedraw(node);
    return;
  }

  setSelectedPin(node, pinKey);
  node.__mpEntries = entries;

  syncContextMenuImages(node, node.__mpEntries, {
    targetIndex,
  });
  setStoredPinIndex(node, pinKey, node.imageIndex);

  removeStandardPreviewWidgetsSoon(node);
  updateButtonLabels(node);
  requestRedraw(node);
}

function ensureAutoSwitchWidget(node) {
  node.widgets ??= [];

  if (isAutoPreviewNode(node)) {
    node.widgets = node.widgets.filter((widget) => !widget.__mpAutoSwitchWidget);
    return;
  }

  let widget = node.widgets.find((w) => w.__mpAutoSwitchWidget);
  if (widget) {
    widget.value = getAutoSwitchLatest(node);
    return;
  }

  widget = node.addWidget(
    "toggle",
    "auto_latest",
    getAutoSwitchLatest(node),
    (value) => {
      setAutoSwitchLatest(node, value === true);
      requestRedraw(node);
    },
    {}
  );
  widget.__mpAutoSwitchWidget = true;
}

function ensureButtonWidgetsForPins(node) {
  node.widgets ??= [];

  if (isAutoPreviewNode(node)) {
    node.widgets = node.widgets.filter((widget) => !widget.__mpPinKey);
    updateButtonLabels(node);
    return;
  }

  const validPins = buttonPinKeys(node);

  node.widgets = node.widgets.filter((widget) => {
    if (!widget.__mpPinKey) return true;
    return validPins.includes(String(widget.__mpPinKey));
  });

  for (const pinKey of validPins) {
    const existing = node.widgets.find((widget) => String(widget.__mpPinKey) === pinKey);
    if (existing) continue;

    const widget = node.addWidget("button", pinKey, pinKey, () => selectPin(node, pinKey, { deferUntilLoaded: true }), {});
    widget.__mpPinKey = pinKey;
  }

  const nonPinWidgets = node.widgets.filter((widget) => !widget.__mpPinKey);
  const pinWidgets = node.widgets
    .filter((widget) => widget.__mpPinKey)
    .sort((a, b) => Number(a.__mpPinKey) - Number(b.__mpPinKey));

  node.widgets = [...nonPinWidgets, ...pinWidgets];

  updateButtonLabels(node);
}

function ensureWidgets(node) {
  node.properties ??= {};
  node.properties.selected_pin ??= "1";
  node.properties.auto_switch_latest ??= false;
  node.__mpPinImages ??= emptyPinImages();
  node.__mpEntries ??= [];
  node.__mpImageCache ??= new Map();
  node.__mpPinImageIndex ??= {};
  node.__mpConnectedPinSnapshot ??= [];

  syncContextMenuImages(node, node.__mpEntries);

  if (!node.__mpWidgetsReady) {
    node.__mpWidgetsReady = true;

    node.size ??= [DEFAULT_NODE_WIDTH, DEFAULT_NODE_HEIGHT];
    node.size[0] = Math.max(node.size[0] || 0, DEFAULT_NODE_WIDTH);
    node.size[1] = Math.max(node.size[1] || 0, DEFAULT_NODE_HEIGHT);
  }

  reconcileDynamicInputs(node);

  ensureAutoSwitchWidget(node);
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

  // Fallback for older or unusual ComfyUI frontend paths.
  // app.graph._nodes is a private field and may change in future versions.
  for (const node of app?.graph?._nodes || []) {
    if (String(node.id) === wanted) return node;
  }

  return null;
}

function applyReceiverPayloadToParent(payload) {
  if (!payload) return false;

  const parent = findNodeById(payload.parentId);
  if (!parent) {
    console.warn(`[MultiPreview] parent node not found: ${payload.parentId}`);
    return false;
  }

  ensureWidgets(parent);

  parent.__mpPinImages ??= emptyPinImages();
  parent.__mpPinImages[payload.pinKey] = payload.images;
  preloadImages(parent, payload.images);

  ensureButtonWidgetsForPins(parent);

  const selectedPin = getSelectedPin(parent);
  const autoSwitchLatest = getAutoSwitchLatest(parent) === true;
  const shouldDisplayNow =
    autoSwitchLatest ||
    selectedPin === payload.pinKey ||
    !hasImagesForPin(parent, selectedPin) ||
    !(parent.__mpEntries || []).length;

  if (shouldDisplayNow) {
    selectPin(parent, payload.pinKey, {
      // Always use per-pin remembered batch index.
      // On first display of a pin, this resolves to index 0.
      deferUntilLoaded: true,
    });
  } else {
    updateButtonLabels(parent);
    requestRedraw(parent);
  }

  removeStandardPreviewWidgetsSoon(parent);
  return true;
}

function handleCustomReceiverEvent(event) {
  const payload = normalizeCustomReceiverEvent(event);
  if (!payload) return;
  applyReceiverPayloadToParent(payload);
}

function registerCustomReceiverEventListener() {
  if (!api || typeof api.addEventListener !== "function") return;
  if (api.__mpCustomReceiverListenerRegistered) return;

  api.addEventListener("multi_preview_receiver", handleCustomReceiverEvent);
  api.__mpCustomReceiverListenerRegistered = true;
}

const injectedPromptObjects = new WeakSet();

function isPromptNodeObject(value) {
  return !!value && typeof value === "object" && typeof value.class_type === "string";
}

function getPromptOutputFromQueueArgs(args) {
  if (args?.[1]?.output && typeof args[1].output === "object") return args[1].output;
  if (args?.[1]?.prompt && typeof args[1].prompt === "object") return args[1].prompt;
  if (args?.[0]?.output && typeof args[0].output === "object") return args[0].output;
  if (args?.[0]?.prompt && typeof args[0].prompt === "object") return args[0].prompt;
  return null;
}

function getPromptOutputFromGraphToPromptResult(result) {
  if (result?.output && typeof result.output === "object") return result.output;
  if (result?.prompt && typeof result.prompt === "object") return result.prompt;
  return null;
}

function nextPromptNodeId(prompt) {
  let maxId = 0;
  for (const key of Object.keys(prompt || {})) {
    const n = Number(key);
    if (Number.isFinite(n)) maxId = Math.max(maxId, n);
  }
  return maxId + 1;
}

function cloneLinkValue(value) {
  return Array.isArray(value) ? [...value] : value;
}

function connectedImageInputsFromLiveNode(nodeId, promptNode) {
  const liveNode = findNodeById(nodeId);
  const result = [];

  if (liveNode) {
    for (const { input, num } of getImageInputs(liveNode)) {
      if (!isInputConnected(input)) continue;

      const key = `image${num}`;
      const linkValue = promptNode?.inputs?.[key];

      if (!Array.isArray(linkValue)) continue;

      result.push({ key, pin: num, linkValue });
    }

    return result.sort((a, b) => a.pin - b.pin);
  }

  // Fallback for unusual serialization/execution paths where the live
  // LiteGraph node cannot be found. In normal browser execution, the live node
  // path above is the source of truth.
  return Object.keys(promptNode?.inputs || {})
    .filter((key) => /^image\d+$/.test(key))
    .filter((key) => Array.isArray(promptNode.inputs[key]))
    .map((key) => ({
      key,
      pin: Number(key.replace("image", "")),
      linkValue: promptNode.inputs[key],
    }))
    .filter((item) => Number.isInteger(item.pin) && item.pin >= 1)
    .sort((a, b) => a.pin - b.pin);
}


function promptAlreadyHasInternalReceiver(prompt, parentId, pin) {
  for (const node of Object.values(prompt || {})) {
    if (!isPromptNodeObject(node)) continue;
    if (node.class_type !== INTERNAL_RECEIVER_NODE_NAME) continue;
    if (Number(node.inputs?.parent_id) === Number(parentId) && Number(node.inputs?.pin) === Number(pin)) {
      return true;
    }
  }
  return false;
}

function injectInternalReceiversIntoPrompt(prompt) {
  if (!prompt || typeof prompt !== "object") return 0;
  if (injectedPromptObjects.has(prompt)) return 0;
  injectedPromptObjects.add(prompt);

  let nextId = nextPromptNodeId(prompt);
  let injectedCount = 0;

  for (const [nodeId, node] of Object.entries(prompt)) {
    if (!isPromptNodeObject(node)) continue;
    if (!isManagedPreviewNodeName(node.class_type)) continue;

    const connectedPins = connectedImageInputsFromLiveNode(nodeId, node);
    const liveNode = findNodeById(nodeId);

    // At execution start, clear stale images for pins that are no longer
    // connected. Until this point, disconnecting a cable does not immediately
    // alter the displayed preview state.
    if (liveNode) {
      prepareNodeStateForRun(
        liveNode,
        connectedPins.map((item) => String(item.pin))
      );
    }

    for (const { pin, linkValue } of connectedPins) {
      if (promptAlreadyHasInternalReceiver(prompt, nodeId, pin)) continue;

      const receiverId = String(nextId++);
      prompt[receiverId] = {
        inputs: {
          image: cloneLinkValue(linkValue),
          parent_id: Number(nodeId),
          pin,
        },
        class_type: INTERNAL_RECEIVER_NODE_NAME,
        _meta: {
          title: `MultiPreviewInternalReceiver ${nodeId}:${pin}`,
        },
      };

      injectedCount += 1;
    }

    // Keep imageN dependencies on the parent prompt node as a fallback.
    // Internal receivers provide immediate updates, while the parent node can
    // still execute normally for node-run-button and API-style execution paths.
  }

  return injectedCount;
}

function patchQueuePromptOnce() {
  // Use multiple hook points because ComfyUI frontend versions and execution
  // paths differ between normal queueing, node execution, and serialized prompt
  // generation. injectedPromptObjects prevents duplicate injection for the same
  // prompt object when more than one hook fires.
  if (api && typeof api.queuePrompt === "function" && !api.__mpQueuePromptPatched) {
    const originalApiQueuePrompt = api.queuePrompt.bind(api);

    api.queuePrompt = async function (...args) {
      const output = getPromptOutputFromQueueArgs(args);
      injectInternalReceiversIntoPrompt(output);
      return originalApiQueuePrompt(...args);
    };

    api.__mpQueuePromptPatched = true;
  }

  if (app && typeof app.graphToPrompt === "function" && !app.__mpGraphToPromptPatched) {
    const originalGraphToPrompt = app.graphToPrompt.bind(app);

    app.graphToPrompt = async function (...args) {
      const result = await originalGraphToPrompt(...args);
      const output = getPromptOutputFromGraphToPromptResult(result);
      injectInternalReceiversIntoPrompt(output);
      return result;
    };

    app.__mpGraphToPromptPatched = true;
  }
}

async function beforeQueuePromptHook(workflow, output) {
  injectInternalReceiversIntoPrompt(output);
}

app.registerExtension({
  name: `mick.MultiPreview.${VERSION}`,

  async setup() {
    patchQueuePromptOnce();
    registerCustomReceiverEventListener();
  },

  async beforeQueuePrompt(workflow, output) {
    await beforeQueuePromptHook(workflow, output);
  },

  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (!isManagedPreviewNodeName(nodeData.name)) return;

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
        reconcileConnectedPinIndexState(this);

        const selectedPin = getSelectedPin(this);
        if (!isAutoPreviewNode(this) && !buttonPinKeys(this).includes(selectedPin)) {
          setSelectedPin(this, firstAvailablePin(this));
        }

        updateButtonLabels(this);
        requestRedraw(this);
      }, 0);

      return result;
    };

    nodeType.prototype.onExecuted = function (output, ...args) {
      // Intentionally do not call original PreviewImage.onExecuted.
      // MultiPreview manages node.images/node.imgs directly and removes the
      // standard preview widget to avoid duplicate previews.
      void originalOnExecuted;
      void args;

      ensureWidgets(this);
      removeStandardPreviewWidgetsSoon(this);

      const pinImages = extractPinImages(output);
      if (countPinImages(pinImages) > 0) {
        // Direct parent execution is a completed run result, so replace the
        // previous run state instead of keeping stale disconnected pins.
        saveCurrentPinIndex(this);
        this.__mpPinImages = pinImages;
        preloadPinImages(this, pinImages);

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
  },
});
