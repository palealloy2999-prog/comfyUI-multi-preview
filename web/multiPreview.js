import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const VERSION = "v1.2.26";
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
const STATE_PERSIST_INTERVAL_MS = 1000;
const ENABLE_PERIODIC_STATE_PERSIST = false;
const GLOBAL_STATE_STORE_KEY = "__multiPreviewStateStore_v2";

// Set to true when diagnosing state restoration issues.
const DEBUG = false;

function mpNodeLabel(node) {
  if (!node) return "node:null";
  return `${node.type || node.comfyClass || "unknown"}#${node.id ?? "?"}`;
}

function mpLog(label, ...args) {
  if (!DEBUG) return;
  console.log(`[MultiPreview ${VERSION}] ${label}`, ...args);
}

function mpWarn(label, ...args) {
  if (!DEBUG) return;
  console.warn(`[MultiPreview ${VERSION}] ${label}`, ...args);
}

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

function clonePlainObject(value) {
  if (value == null) return value;

  try {
    return structuredClone(value);
  } catch {
    try {
      return JSON.parse(JSON.stringify(value));
    } catch {
      return value;
    }
  }
}

function globalStateStore() {
  globalThis[GLOBAL_STATE_STORE_KEY] ??= new Map();
  return globalThis[GLOBAL_STATE_STORE_KEY];
}

function graphIdentityForNode(node) {
  const graph = node?.graph;
  if (!graph) return "graph:unknown";

  // Subgraphs usually have a stable id. The root graph may not; in that case
  // use "root" and rely on the connection snapshot check to avoid stale
  // cross-workflow restores.
  return String(graph.id ?? graph.graphId ?? graph.uuid ?? "root");
}

function promptFallbackStateKey(nodeId, type) {
  if (nodeId == null) return null;
  const normalizedType = type || "MultiPreview";
  return `prompt:${normalizedType}:${nodeId}`;
}

function previewStateKey(node) {
  if (!node || node.id == null) return null;

  const type = node.type || node.comfyClass || "MultiPreview";
  return `${graphIdentityForNode(node)}:${type}:${node.id}`;
}

function previewStateKeysForNode(node) {
  if (!node || node.id == null) return [];

  const type = node.type || node.comfyClass || "MultiPreview";
  return [
    previewStateKey(node),
    promptFallbackStateKey(node.id, type),
  ].filter(Boolean);
}

function graphLinkById(graph, linkId) {
  const links = graph?.links;
  if (!links || linkId == null) return null;

  if (typeof links.get === "function") {
    return links.get(linkId) || null;
  }

  return links[linkId] || null;
}

function currentConnectedPinSnapshot(node) {
  return getImageInputs(node)
    .filter(({ input }) => isInputConnected(input))
    .map(({ input, num }) => {
      const link = graphLinkById(node.graph, input.link);
      const originId = link?.origin_id ?? link?.originId ?? null;
      const originNode =
        originId != null && typeof node.graph?.getNodeById === "function"
          ? node.graph.getNodeById(Number(originId))
          : null;

      return {
        pin: String(num),
        link: input.link != null ? String(input.link) : "",
        origin_id: originId != null ? String(originId) : "",
        origin_slot: link?.origin_slot != null ? String(link.origin_slot) : "",
        origin_type: String(originNode?.type || originNode?.comfyClass || ""),
      };
    })
    .sort((a, b) => Number(a.pin) - Number(b.pin));
}

function snapshotPinKeys(snapshot) {
  return (snapshot || [])
    .map((item) => (typeof item === "object" ? item.pin : item))
    .filter((pin) => pin != null)
    .map((pin) => String(pin))
    .sort((a, b) => Number(a) - Number(b));
}

function sameConnectionSnapshot(a, b) {
  return JSON.stringify(a || []) === JSON.stringify(b || []);
}

function candidateGraphs() {
  const graphs = [
    app?.canvas?.graph,
    app?.graph,
    app?.rootGraph,
  ].filter(Boolean);

  return [...new Set(graphs)];
}

function nodeListFromGraph(graph) {
  if (!graph) return [];

  if (Array.isArray(graph._nodes)) return graph._nodes;
  if (graph._nodes_by_id && typeof graph._nodes_by_id === "object") {
    return Object.values(graph._nodes_by_id);
  }

  return [];
}

function countStateImages(state) {
  return countPinImages(state?.pinImages || emptyPinImages());
}

function saveNodeState(node) {
  if (!node || !isManagedPreviewNodeName(node.type || node.comfyClass)) return;

  const key = previewStateKey(node);
  if (!key) {
    mpLog("saveNodeState: skipped - no key", mpNodeLabel(node));
    return;
  }

  saveCurrentPinIndex(node);

  const nextState = {
    selectedPin: getSelectedPin(node),
    autoSwitchLatest: getAutoSwitchLatest(node) === true,
    pinImages: clonePlainObject(node.__mpPinImages || emptyPinImages()),
    pinImageIndex: clonePlainObject(node.__mpPinImageIndex || {}),
    connectedPinSnapshot: clonePlainObject(currentConnectedPinSnapshot(node)),
    imageIndex: node.imageIndex === null ? null : Number.isInteger(node.imageIndex) ? node.imageIndex : 0,
    timestamp: Date.now(),
    cleared: false,
  };

  const store = globalStateStore();
  const prevState = store.get(key);
  const nextCount = countStateImages(nextState);
  const prevCount = countStateImages(prevState);

  // Tab/view switches can briefly rebuild nodes with empty transient UI state.
  // Do not let that empty state overwrite a useful cached preview.
  if (nextCount === 0 && prevCount > 0) {
    mpLog("saveNodeState: skipped empty overwrite", {
      key,
      node: mpNodeLabel(node),
      selectedPin: nextState.selectedPin,
      nextCount,
      prevCount,
      prevState,
    });
    return;
  }

  // Empty state without an existing image cache is not useful for preview
  // restoration. Avoid repeatedly storing/logging it during idle polling.
  if (nextCount === 0 && prevCount === 0) {
    mpLog("saveNodeState: skipped empty no-cache state", {
      key,
      node: mpNodeLabel(node),
      selectedPin: nextState.selectedPin,
      nextCount,
      prevCount,
    });
    return;
  }

  store.set(key, nextState);
  mpLog("saveNodeState: stored", {
    key,
    node: mpNodeLabel(node),
    selectedPin: nextState.selectedPin,
    imageIndex: nextState.imageIndex,
    pinKeys: Object.keys(nextState.pinImages || {}),
    imageCount: nextCount,
  });
}

function saveNodeStateSoon(node) {
  if (!node || node.__mpSaveStateScheduled) return;

  node.__mpSaveStateScheduled = true;

  const run = () => {
    node.__mpSaveStateScheduled = false;
    saveNodeState(node);
  };

  if (typeof queueMicrotask === "function") {
    queueMicrotask(run);
  } else {
    Promise.resolve().then(run);
  }
}

function restoreNodeState(node) {
  if (!node) return false;

  const keys = previewStateKeysForNode(node);
  if (keys.length === 0) {
    // onNodeCreated can run before the final node id is available.
    // Do not mark this node as restored yet; onConfigure / later ensureWidgets
    // may be able to restore it once the id is stable.
    mpLog("restoreNodeState: skipped - no key yet", mpNodeLabel(node));
    return false;
  }

  const store = globalStateStore();
  let key = null;
  let state = null;
  for (const candidateKey of keys) {
    const candidateState = store.get(candidateKey);
    if (candidateState) {
      key = candidateKey;
      state = candidateState;
      break;
    }
  }

  if (!state) {
    mpLog("restoreNodeState: skipped - no cached state", {
      keys,
      node: mpNodeLabel(node),
      storeKeys: [...globalStateStore().keys()],
    });
    return false;
  }

  if (state.cleared === true) {
    mpLog("restoreNodeState: skipped - state explicitly cleared", { key, node: mpNodeLabel(node) });
    return false;
  }

  const currentSnapshot = currentConnectedPinSnapshot(node);
  const cachedSnapshot = state.connectedPinSnapshot || [];

  // Avoid restoring images from another workflow/tab that happens to reuse the
  // same node id. During graph setup the current snapshot may be empty, so only
  // reject when both sides have concrete connection data and they differ.
  if (currentSnapshot.length > 0 && cachedSnapshot.length > 0 && !sameConnectionSnapshot(currentSnapshot, cachedSnapshot)) {
    globalStateStore().delete(key);
    mpLog("restoreNodeState: skipped - connection snapshot mismatch", {
      key,
      node: mpNodeLabel(node),
      currentSnapshot,
      cachedSnapshot,
    });
    return false;
  }

  const liveCount = countPinImages(node.__mpPinImages || emptyPinImages());
  const cachedCount = countStateImages(state);

  // If live state still has images, keep it.
  if (liveCount > 0) {
    node.__mpStateRestored = true;
    mpLog("restoreNodeState: skipped - live state already exists", {
      key,
      node: mpNodeLabel(node),
      liveCount,
      cachedCount,
    });
    return false;
  }

  // Retry case:
  // A tab/view switch can keep the same node object and __mpStateRestored=true
  // while clearing its live pin image state. If cached images still exist,
  // restore again instead of returning early.
  if (node.__mpStateRestored && cachedCount === 0) {
    mpLog("restoreNodeState: skipped - already restored and cache empty", {
      key,
      node: mpNodeLabel(node),
      liveCount,
      cachedCount,
    });
    return false;
  }

  if (cachedCount === 0) {
    mpLog("restoreNodeState: skipped - cached state has no images", {
      key,
      node: mpNodeLabel(node),
      liveCount,
      cachedCount,
      state,
    });
    return false;
  }

  node.properties ??= {};
  node.properties.selected_pin = String(state.selectedPin || node.properties.selected_pin || "1");
  if (typeof state.autoSwitchLatest === "boolean" && !isAutoPreviewNode(node)) {
    node.properties.auto_switch_latest = state.autoSwitchLatest;
  }
  node.__mpPinImages = clonePlainObject(state.pinImages || emptyPinImages());
  node.__mpPinImageIndex = clonePlainObject(state.pinImageIndex || {});
  node.__mpConnectedPinSnapshot = clonePlainObject(state.connectedPinSnapshot || []);
  node.imageIndex = state.imageIndex === null ? null : Number.isInteger(state.imageIndex) ? state.imageIndex : 0;
  node.__mpStateRestored = true;

  const restoredCount = countPinImages(node.__mpPinImages);
  mpLog("restoreNodeState: restored", {
    key,
    node: mpNodeLabel(node),
    selectedPin: node.properties.selected_pin,
    imageIndex: node.imageIndex,
    pinKeys: Object.keys(node.__mpPinImages || {}),
    liveCount,
    cachedCount,
    restoredCount,
    state,
  });

  return restoredCount > 0;
}

function restoreDisplayedPinIfNeeded(node) {
  if (!node) return;

  if ((node.__mpEntries || []).length > 0) {
    mpLog("restoreDisplayedPinIfNeeded: skipped - entries already exist", {
      node: mpNodeLabel(node),
      entries: node.__mpEntries.length,
    });
    return;
  }

  const selectedPin = getSelectedPin(node);
  mpLog("restoreDisplayedPinIfNeeded: start", {
    node: mpNodeLabel(node),
    selectedPin,
    receivedPins: receivedPinKeys(node),
    pinImageCount: countPinImages(node.__mpPinImages || emptyPinImages()),
  });

  if (hasImagesForPin(node, selectedPin)) {
    mpLog("restoreDisplayedPinIfNeeded: select selected pin", { node: mpNodeLabel(node), selectedPin });
    selectPin(node, selectedPin, { deferUntilLoaded: true });
    return;
  }

  const fallbackPin = receivedPinKeys(node)[0];
  if (fallbackPin && hasImagesForPin(node, fallbackPin)) {
    mpLog("restoreDisplayedPinIfNeeded: select fallback pin", { node: mpNodeLabel(node), fallbackPin });
    selectPin(node, fallbackPin, { deferUntilLoaded: true });
  } else {
    mpLog("restoreDisplayedPinIfNeeded: no displayable pin", { node: mpNodeLabel(node), fallbackPin });
  }
}

function managedPreviewNodes() {
  const nodes = [];

  for (const graph of candidateGraphs()) {
    for (const node of nodeListFromGraph(graph)) {
      if (isManagedPreviewNodeName(node?.type || node?.comfyClass)) {
        nodes.push(node);
      }
    }
  }

  return [...new Set(nodes)];
}

function persistAllPreviewStates() {
  const nodes = managedPreviewNodes();
  mpLog("persistAllPreviewStates: start", {
    count: nodes.length,
    nodes: nodes.map(mpNodeLabel),
  });

  for (const node of nodes) {
    saveNodeState(node);
  }
}

function registerStatePersistence() {
  if (globalThis.__mpStatePersistenceRegistered) {
    mpLog("registerStatePersistence: already registered");
    return;
  }
  globalThis.__mpStatePersistenceRegistered = true;

  mpLog("registerStatePersistence: registered", {
    interval: STATE_PERSIST_INTERVAL_MS,
    periodic: ENABLE_PERIODIC_STATE_PERSIST,
  });

  if (ENABLE_PERIODIC_STATE_PERSIST) {
    setInterval(persistAllPreviewStates, STATE_PERSIST_INTERVAL_MS);
  }

  if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
    window.addEventListener("blur", persistAllPreviewStates);
    window.addEventListener("beforeunload", persistAllPreviewStates);
  }

  if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
    document.addEventListener("visibilitychange", persistAllPreviewStates);
  }
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
  if (!node) return;

  // Coalesce repeated cleanup requests. This function is called from several
  // execution/UI paths, and without a guard each call schedules the same timer
  // chain again.
  if (node.__mpStandardPreviewCleanupScheduled) {
    removeStandardPreviewWidgets(node);
    return;
  }

  node.__mpStandardPreviewCleanupScheduled = true;

  const finish = () => {
    removeStandardPreviewWidgets(node);
    node.__mpStandardPreviewCleanupScheduled = false;
  };

  // ComfyUI can recreate the standard preview widget asynchronously after
  // node execution. Schedule cleanup across a few timing phases to avoid
  // duplicate previews without depending on one specific frontend lifecycle.
  removeStandardPreviewWidgets(node);

  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(() => removeStandardPreviewWidgets(node));
  }

  setTimeout(() => removeStandardPreviewWidgets(node), 0);
  setTimeout(() => removeStandardPreviewWidgets(node), STANDARD_PREVIEW_CLEANUP_DELAY_MS);
  setTimeout(finish, 150);
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
  const stateKeyRaw = payload.state_key ?? payload.stateKey ?? null;
  const stateKey = typeof stateKeyRaw === "string" && stateKeyRaw ? stateKeyRaw : null;

  if (!Number.isFinite(parentId) || !Number.isInteger(pin) || pin < 1 || images.length === 0) {
    return null;
  }

  return {
    parentId,
    pinKey: String(pin),
    stateKey,
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

    // Do not mutate the evicted entry's Image object here.
    // The same entry may still be referenced by node.imgs, node.__mpEntries,
    // or a deferred selectPin() waiter. Clearing img.src or waiters here can
    // blank the current preview or prevent a deferred selection from completing.
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

function hasOwnOption(object, key) {
  return Object.prototype.hasOwnProperty.call(object || {}, key);
}

function normalizeDisplayImageIndex(value, maxIndex) {
  // ComfyUI uses explicit null for batch grid view.
  // Undefined means no stored value yet, so default to page 0.
  if (value === null) return null;
  if (value === undefined) return 0;
  if (Number.isInteger(value)) return Math.min(Math.max(0, value), Math.max(0, maxIndex));
  return 0;
}

function normalizeNumericImageIndex(value, maxIndex) {
  const normalized = normalizeDisplayImageIndex(value, maxIndex);
  return normalized == null ? 0 : normalized;
}

function getTargetImageIndex(node, pinKey, entries, options = {}) {
  const maxIndex = Math.max(0, entries.length - 1);

  if (hasOwnOption(options, "targetIndex")) {
    return normalizeNumericImageIndex(options.targetIndex, maxIndex);
  }

  // Default behavior: always restore per-pin index.
  return normalizeNumericImageIndex(getStoredPinIndex(node, pinKey), maxIndex);
}

function getDisplayImageIndex(node, pinKey, entries, options = {}) {
  const maxIndex = Math.max(0, entries.length - 1);

  if (hasOwnOption(options, "displayIndex")) {
    return normalizeDisplayImageIndex(options.displayIndex, maxIndex);
  }

  if (hasOwnOption(options, "targetIndex")) {
    return normalizeDisplayImageIndex(options.targetIndex, maxIndex);
  }

  return normalizeDisplayImageIndex(getStoredPinIndex(node, pinKey), maxIndex);
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

function installImageIndexTracker(node) {
  if (!node || node.__mpImageIndexTrackerInstalled) return;

  const descriptor = Object.getOwnPropertyDescriptor(node, "imageIndex");
  if (descriptor && descriptor.configurable === false) return;

  // ComfyUI uses explicit null imageIndex to represent the batch grid view.
  // Undefined means no stored value yet, so default to page 0.
  let current =
    node.imageIndex === null
      ? null
      : Number.isInteger(node.imageIndex)
        ? Math.max(0, node.imageIndex)
        : 0;

  Object.defineProperty(node, "imageIndex", {
    configurable: true,
    enumerable: true,
    get() {
      return current;
    },
    set(value) {
      current = value === null ? null : Number.isInteger(value) ? Math.max(0, value) : 0;

      const pinKey = getSelectedPin(node);
      if (pinKey && hasImagesForPin(node, pinKey)) {
        pinImageIndexMap(node)[String(pinKey)] = current;
        saveNodeStateSoon(node);
      }
    },
  });

  node.__mpImageIndexTrackerInstalled = true;
  node.imageIndex = current;
}

function saveCurrentPinIndex(node) {
  const pinKey = getSelectedPin(node);
  if (!pinKey) return;

  const index = node.imageIndex === null ? null : Number.isInteger(node.imageIndex) ? Math.max(0, node.imageIndex) : 0;
  pinImageIndexMap(node)[String(pinKey)] = index;
}

function getStoredPinIndex(node, pinKey) {
  const raw = pinImageIndexMap(node)[String(pinKey)];
  if (raw === null) return null;
  if (raw === undefined) return 0;
  return Number.isInteger(raw) ? Math.max(0, raw) : 0;
}

function setStoredPinIndex(node, pinKey, index) {
  pinImageIndexMap(node)[String(pinKey)] = index === null ? null : Math.max(0, Number(index) || 0);
}

function clearStoredPinIndex(node, pinKey) {
  delete pinImageIndexMap(node)[String(pinKey)];
}

function reconcileConnectedPinIndexState(node) {
  const previousSnapshot = node.__mpConnectedPinSnapshot || [];
  const prevPins = new Set(snapshotPinKeys(previousSnapshot));
  const nextSnapshot = currentConnectedPinSnapshot(node);
  const nextPins = new Set(snapshotPinKeys(nextSnapshot));
  const hasPreviousSnapshot = previousSnapshot.length > 0;

  // Reset per-pin batch index when a pin is attached or detached.
  // Do not treat the initial graph/configure pass as an attach event; otherwise
  // restored per-pin batch indexes can be cleared before the preview is drawn.
  if (hasPreviousSnapshot) {
    for (const pinKey of nextPins) {
      if (!prevPins.has(pinKey)) {
        clearStoredPinIndex(node, pinKey);
      }
    }

    for (const pinKey of prevPins) {
      if (!nextPins.has(pinKey)) {
        clearStoredPinIndex(node, pinKey);
      }
    }
  }

  node.__mpConnectedPinSnapshot = nextSnapshot;
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


function reconcileDynamicInputs(node, options = {}) {
  if (!node || node.__mpReconcilingPins) return;
  node.__mpReconcilingPins = true;

  const allowRemove = options?.allowRemove !== false;

  try {
    // Do not clear disconnected pin previews here.
    // They are intentionally preserved until the next execution starts.
    const desiredCount = desiredInputCount(node);

    for (let num = 1; num <= desiredCount; num += 1) {
      ensureImageInput(node, num);
    }

    // During workflow load/reconnect, onConfigure can fire before LiteGraph has
    // fully restored links. In that state input.link can temporarily look null,
    // so removing inputs here may corrupt slot/link layout for the whole canvas.
    // Only prune inputs from explicit connection-change or execution paths.
    if (allowRemove) {
      const imageInputsDesc = getImageInputs(node).sort((a, b) => b.num - a.num);
      for (const { input, num } of imageInputsDesc) {
        if (num <= desiredCount) continue;
        if (isInputConnected(input)) continue;
        removeImageInput(node, num);
      }
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


function clearPreviewState(node, { clearCache = false } = {}) {
  if (!node) return;

  node.__mpPinImages = emptyPinImages();
  node.__mpEntries = [];
  node.__mpPinImageIndex = {};
  node.__mpConnectedPinSnapshot = currentConnectedPinSnapshot(node);
  node.__mpPendingSelectionToken = null;
  // Do not set node.imgs/node.images to an empty array.
  // ComfyUI's standard image preview widget can still exist for a short moment
  // and may read imgs[0].naturalWidth. An empty array can crash that path.
  //
  // Also do not replace the preview with a 1x1 dummy. If a standard preview
  // widget is still visible during the failing/no-input execution, keep the
  // previous non-empty imgs array, matching normal Preview Image behavior.
  if (!Array.isArray(node.imgs) || node.imgs.length === 0) {
    delete node.imgs;
  }
  if (!Array.isArray(node.images) || node.images.length === 0) {
    delete node.images;
  }

  // Preserve node.imageIndex here. If ComfyUI marks the node red because the
  // user executed it with no connected inputs, keeping the previous imageIndex
  // matches normal Preview Image behavior and avoids jumping back to page 1.
  node.overIndex = null;

  // Also clear legacy app.nodeOutputs image fields when available, so restore
  // paths do not rediscover stale images for this node.
  const output = app?.nodeOutputs?.[String(node.id)];
  if (output) {
    delete output.images;
    delete output.gifs;
  }

  if (clearCache) {
    const key = previewStateKey(node);
    if (key) {
      globalStateStore().set(key, {
        selectedPin: getSelectedPin(node),
        pinImages: emptyPinImages(),
        pinImageIndex: {},
        connectedPinSnapshot: clonePlainObject(currentConnectedPinSnapshot(node)),
        imageIndex: Number.isInteger(node.imageIndex) ? node.imageIndex : 0,
        timestamp: Date.now(),
        cleared: true,
      });
    }
  }

  ensureButtonWidgetsForPins(node);
  updateButtonLabels(node);
  removeStandardPreviewWidgetsSoon(node);
  requestRedraw(node);
}

function prepareNodeStateForRun(node, activePinKeys) {
  if (!node) return;

  const active = new Set((activePinKeys || []).map((key) => String(key)));

  if (active.size === 0) {
    // No connected image inputs.
    //
    // If this node already has a previous preview, keep the current visual state
    // and let the Python node raise an execution error so ComfyUI marks it red,
    // matching normal Preview Image behavior.
    //
    // If this is a fresh node with no previous preview, there is simply nothing
    // to display; the Python-side execution error still marks it red.
    saveCurrentPinIndex(node);
    if (countPinImages(node.__mpPinImages || emptyPinImages()) > 0) {
      saveNodeState(node);
    }
    updateButtonLabels(node);
    requestRedraw(node);
    return;
  }

  node.__mpPinImages ??= emptyPinImages();
  node.__mpPinImageIndex ??= {};

  for (const key of Object.keys(node.__mpPinImages)) {
    if (!active.has(String(key))) {
      delete node.__mpPinImages[key];
      delete node.__mpPinImageIndex[key];
    }
  }

  const selectedPin = getSelectedPin(node);
  if (!active.has(selectedPin)) {
    setSelectedPin(node, firstAvailablePin(node));
  }

  node.__mpConnectedPinSnapshot = currentConnectedPinSnapshot(node);
  saveNodeState(node);
  updateButtonLabels(node);
  requestRedraw(node);
}

function syncContextMenuImages(node, entries, options = {}) {
  const resetIndex = options?.resetIndex === true;
  const hasTargetIndex = hasOwnOption(options, "targetIndex");
  const prevIndex = node.imageIndex === null ? null : Number.isInteger(node.imageIndex) ? node.imageIndex : 0;
  const maxIndex = Math.max(0, entries.length - 1);

  // Preserve the current batch page/grid state when other pins update or when
  // the same pin receives a new result. Reset only for explicit user pin
  // switching. targetIndex is used for auto-follow-latest mode.
  const nextIndex = hasTargetIndex
    ? normalizeDisplayImageIndex(options.targetIndex, maxIndex)
    : resetIndex
      ? 0
      : normalizeDisplayImageIndex(prevIndex, maxIndex);

  const pendingEntries = entries.filter((entry) => entry && !entry.loaded && !entry.error);

  if (pendingEntries.length > 0) {
    const token = {};
    node.__mpPendingImageSyncToken = token;

    const retry = () => {
      if (node.__mpPendingImageSyncToken !== token) return;
      if (entries.some((entry) => entry && !entry.loaded && !entry.error)) return;

      syncContextMenuImages(node, entries, {
        ...options,
        targetIndex: nextIndex,
      });
      updateButtonLabels(node);
      requestRedraw(node);
      saveNodeState(node);
    };

    for (const entry of pendingEntries) {
      whenEntryReady(entry, retry);
    }

    // Keep the previous node.imgs until the whole batch is ready. ComfyUI's
    // standard preview widget can briefly render unloaded images as 0x0.
    return false;
  }

  node.__mpPendingImageSyncToken = null;
  node.images = entries.map((entry) => entry.data);
  node.imgs = entries.map((entry) => entry.img);
  node.imageIndex = nextIndex;
  node.overIndex = null;

  return true;
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

  mpLog("selectPin: start", {
    node: mpNodeLabel(node),
    pinKey,
    options,
    selectedPin: getSelectedPin(node),
    currentImageIndex: node?.imageIndex,
    hasImages: hasImagesForPin(node, pinKey),
    pinImageCount: normalizeImages(node?.__mpPinImages?.[pinKey]).length,
  });

  if (!hasImagesForPin(node, pinKey)) {
    mpLog("selectPin: no images for pin", { node: mpNodeLabel(node), pinKey });
    updateButtonLabels(node);
    requestRedraw(node);
    saveNodeState(node);
    return;
  }

  // Persist the current page of the currently selected pin before switching
  // or re-selecting, so same-pin updates also keep the last viewed page.
  saveCurrentPinIndex(node);

  const images = normalizeImages(node.__mpPinImages?.[pinKey]);
  const entries = images.map((data, index) => makeImageEntry(node, data, index));
  const targetIndex = getTargetImageIndex(node, pinKey, entries, options);
  const displayIndex = getDisplayImageIndex(node, pinKey, entries, options);
  const targetEntry = entries[targetIndex];

  mpLog("selectPin: entries prepared", {
    node: mpNodeLabel(node),
    pinKey,
    entries: entries.length,
    targetIndex,
    targetLoaded: targetEntry?.loaded,
    targetError: targetEntry?.error,
  });

  if (
    options?.deferUntilLoaded === true &&
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
        targetIndex: displayIndex,
      });
    });

    mpLog("selectPin: deferred until target image loaded", {
      node: mpNodeLabel(node),
      pinKey,
      targetIndex,
      url: targetEntry?.url,
    });
    updateButtonLabels(node);
    requestRedraw(node);
    return;
  }

  setSelectedPin(node, pinKey);
  node.__mpEntries = entries;

  const synced = syncContextMenuImages(node, node.__mpEntries, {
    targetIndex: displayIndex,
  });

  if (!synced) {
    mpLog("selectPin: sync deferred until batch images are loaded", {
      node: mpNodeLabel(node),
      pinKey,
      targetIndex,
      entries: node.__mpEntries.length,
    });
    updateButtonLabels(node);
    requestRedraw(node);
    saveNodeState(node);
    return;
  }

  setStoredPinIndex(node, pinKey, node.imageIndex);

  removeStandardPreviewWidgetsSoon(node);
  updateButtonLabels(node);
  requestRedraw(node);
  mpLog("selectPin: done", {
    node: mpNodeLabel(node),
    pinKey,
    imageIndex: node.imageIndex,
    imgs: node.imgs?.length,
    images: node.images?.length,
  });
  saveNodeState(node);
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

function ensureWidgets(node, options = {}) {
  const reconcileInputs = options?.reconcileInputs === true;

  mpLog("ensureWidgets: start", {
    node: mpNodeLabel(node),
    selectedPin: node?.properties?.selected_pin,
    pinImageCount: countPinImages(node?.__mpPinImages || emptyPinImages()),
    entries: node?.__mpEntries?.length,
    widgetsReady: node?.__mpWidgetsReady,
    reconcileInputs,
  });

  node.properties ??= {};
  node.properties.selected_pin ??= "1";
  node.properties.auto_switch_latest ??= false;

  installImageIndexTracker(node);

  restoreNodeState(node);

  node.__mpPinImages ??= emptyPinImages();
  node.__mpEntries ??= [];
  node.__mpImageCache ??= new Map();
  node.__mpPinImageIndex ??= {};
  node.__mpConnectedPinSnapshot ??= [];

  if ((node.__mpEntries || []).length > 0) {
    syncContextMenuImages(node, node.__mpEntries);
  }

  if (!node.__mpWidgetsReady) {
    node.__mpWidgetsReady = true;

    node.size ??= [DEFAULT_NODE_WIDTH, DEFAULT_NODE_HEIGHT];
    node.size[0] = Math.max(node.size[0] || 0, DEFAULT_NODE_WIDTH);
    node.size[1] = Math.max(node.size[1] || 0, DEFAULT_NODE_HEIGHT);
  }

  if (reconcileInputs) {
    reconcileDynamicInputs(node, { allowRemove: true });
  }

  ensureAutoSwitchWidget(node);
  ensureButtonWidgetsForPins(node);
  restoreDisplayedPinIfNeeded(node);
  removeStandardPreviewWidgetsSoon(node);
  updateButtonLabels(node);
  requestRedraw(node);
  saveNodeState(node);

  mpLog("ensureWidgets: end", {
    node: mpNodeLabel(node),
    selectedPin: getSelectedPin(node),
    pinImageCount: countPinImages(node.__mpPinImages || emptyPinImages()),
    entries: node.__mpEntries?.length,
    widgets: node.widgets?.length,
    imgs: node.imgs?.length,
    images: node.images?.length,
  });

  // LiteGraph can call onNodeCreated/onConfigure before all graph/tab state is
  // fully settled. Run one deferred restore pass so tab/view switching can
  // recover previews after the node has its final id and widgets.
  if (!node.__mpDeferredRestoreScheduled) {
    node.__mpDeferredRestoreScheduled = true;
    setTimeout(() => {
      node.__mpDeferredRestoreScheduled = false;
      mpLog("ensureWidgets: deferred restore pass", { node: mpNodeLabel(node) });
      const restored = restoreNodeState(node);
      if (restored || countPinImages(node.__mpPinImages || emptyPinImages()) > 0) {
        ensureButtonWidgetsForPins(node);
        restoreDisplayedPinIfNeeded(node);
        updateButtonLabels(node);
        requestRedraw(node);
        saveNodeState(node);
      }
    }, 0);
  }
}

function ensureCoreState(node) {
  if (!node) return;

  node.properties ??= {};
  node.properties.selected_pin ??= "1";
  node.properties.auto_switch_latest ??= false;

  installImageIndexTracker(node);

  node.__mpPinImages ??= emptyPinImages();
  node.__mpEntries ??= [];
  node.__mpImageCache ??= new Map();
  node.__mpPinImageIndex ??= {};
  node.__mpConnectedPinSnapshot ??= [];
}

function findNodeById(id) {
  const wanted = String(id);
  const numericId = Number(id);
  const graphs = candidateGraphs();

  mpLog("findNodeById: start", {
    id,
    graphCount: graphs.length,
    graphNodeCounts: graphs.map((graph) => nodeListFromGraph(graph).length),
  });

  for (const graph of graphs) {
    if (typeof graph?.getNodeById === "function") {
      const node = graph.getNodeById(numericId);
      if (node) {
        mpLog("findNodeById: found by getNodeById", { id, node: mpNodeLabel(node) });
        return node;
      }
    }

    // Fallback for older or unusual ComfyUI frontend paths.
    // _nodes is a private field and may change in future versions.
    for (const node of nodeListFromGraph(graph)) {
      if (String(node.id) === wanted) {
        mpLog("findNodeById: found by node list", { id, node: mpNodeLabel(node) });
        return node;
      }
    }
  }

  mpWarn("findNodeById: not found", { id, graphCount: graphs.length });
  return null;
}

function receiverStateKey(payload, liveNode = null) {
  if (typeof payload?.stateKey === "string" && payload.stateKey) return payload.stateKey;

  const liveKey = previewStateKey(liveNode);
  if (liveKey) return liveKey;

  return promptFallbackStateKey(payload?.parentId, liveNode?.type || liveNode?.comfyClass || "MultiPreview");
}

function mergeReceiverPayloadIntoStateStore(payload, liveNode = null) {
  const key = receiverStateKey(payload, liveNode);
  if (!key) {
    mpWarn("mergeReceiverPayloadIntoStateStore: missing state key", payload);
    return null;
  }

  const store = globalStateStore();
  const previousState = store.get(key) || {};
  const pinImages = clonePlainObject(previousState.pinImages || emptyPinImages());
  pinImages[payload.pinKey] = normalizeImages(payload.images);

  const pinImageIndex = clonePlainObject(previousState.pinImageIndex || {});
  const nextImagesForPin = normalizeImages(pinImages[payload.pinKey]);
  const maxPayloadIndex = Math.max(0, nextImagesForPin.length - 1);
  const existingPinIndex = pinImageIndex[payload.pinKey];
  pinImageIndex[payload.pinKey] =
    existingPinIndex === null
      ? null
      : existingPinIndex === undefined
        ? 0
        : Number.isInteger(existingPinIndex)
          ? Math.min(Math.max(0, existingPinIndex), maxPayloadIndex)
          : 0;

  const autoSwitchLatest =
    liveNode != null ? getAutoSwitchLatest(liveNode) === true : previousState.autoSwitchLatest === true;

  const previousSelectedPin = String(previousState.selectedPin || payload.pinKey || "1");
  const selectedPinHasImages = normalizeImages(pinImages[previousSelectedPin]).length > 0;
  const nextSelectedPin =
    autoSwitchLatest || previousSelectedPin === payload.pinKey || !selectedPinHasImages
      ? payload.pinKey
      : previousSelectedPin;

  const selectedPinImages = normalizeImages(pinImages[nextSelectedPin]);
  const selectedPinIndex = pinImageIndex[nextSelectedPin];
  const selectedStateIndex =
    selectedPinIndex === null
      ? null
      : selectedPinIndex === undefined
        ? 0
        : Number.isInteger(selectedPinIndex)
          ? Math.min(Math.max(0, selectedPinIndex), Math.max(0, selectedPinImages.length - 1))
          : 0;

  const nextState = {
    selectedPin: String(nextSelectedPin || payload.pinKey || "1"),
    autoSwitchLatest,
    pinImages,
    pinImageIndex,
    connectedPinSnapshot: clonePlainObject(
      liveNode != null ? currentConnectedPinSnapshot(liveNode) : previousState.connectedPinSnapshot || []
    ),
    imageIndex: selectedStateIndex,
    timestamp: Date.now(),
    cleared: false,
  };

  store.set(key, nextState);

  mpLog("mergeReceiverPayloadIntoStateStore: stored", {
    key,
    payloadPin: payload.pinKey,
    selectedPin: nextState.selectedPin,
    autoSwitchLatest,
    pinKeys: Object.keys(nextState.pinImages || {}),
    imageCount: countStateImages(nextState),
  });

  return { key, state: nextState };
}

function applyStateToLiveNode(node, state, payloadPinKey = null) {
  if (!node || !state) return false;

  if (!node.__mpWidgetsReady) {
    ensureWidgets(node, { reconcileInputs: false });
  } else {
    ensureCoreState(node);
  }

  node.properties ??= {};
  node.properties.selected_pin = String(state.selectedPin || node.properties.selected_pin || "1");
  if (!isAutoPreviewNode(node) && typeof state.autoSwitchLatest === "boolean") {
    node.properties.auto_switch_latest = state.autoSwitchLatest;
  }

  node.__mpPinImages = clonePlainObject(state.pinImages || emptyPinImages());
  node.__mpPinImageIndex = clonePlainObject(state.pinImageIndex || {});
  node.__mpConnectedPinSnapshot = clonePlainObject(state.connectedPinSnapshot || []);
  preloadPinImages(node, node.__mpPinImages);

  ensureButtonWidgetsForPins(node);

  const displayPin = String(state.selectedPin || payloadPinKey || getSelectedPin(node) || "1");
  const shouldDisplayNow =
    hasImagesForPin(node, displayPin) &&
    (displayPin === String(payloadPinKey || "") ||
      !hasImagesForPin(node, getSelectedPin(node)) ||
      !(node.__mpEntries || []).length);

  mpLog("applyStateToLiveNode: decision", {
    node: mpNodeLabel(node),
    payloadPin: payloadPinKey,
    selectedPin: getSelectedPin(node),
    displayPin,
    entries: node.__mpEntries?.length,
    shouldDisplayNow,
  });

  if (shouldDisplayNow) {
    selectPin(node, displayPin, {
      deferUntilLoaded: true,
      targetIndex: state.imageIndex === null ? null : Number.isInteger(state.imageIndex) ? state.imageIndex : undefined,
    });
  } else {
    updateButtonLabels(node);
    requestRedraw(node);
  }

  removeStandardPreviewWidgetsSoon(node);
  saveNodeState(node);
  return true;
}

function applyReceiverPayloadToParent(payload) {
  if (!payload) {
    mpWarn("applyReceiverPayloadToParent: empty payload");
    return false;
  }

  mpLog("applyReceiverPayloadToParent: payload", {
    parentId: payload.parentId,
    pinKey: payload.pinKey,
    images: payload.images?.length,
    payload,
  });

  const parent = findNodeById(payload.parentId);
  const merged = mergeReceiverPayloadIntoStateStore(payload, parent);

  if (!merged) {
    return false;
  }

  if (!parent) {
    mpLog("applyReceiverPayloadToParent: state stored without live node", {
      stateKey: merged.key,
      parentId: payload.parentId,
      pinKey: payload.pinKey,
      selectedPin: merged.state?.selectedPin,
    });
    return true;
  }

  return applyStateToLiveNode(parent, merged.state, payload.pinKey);
}

function handleCustomReceiverEvent(event) {
  mpLog("customEvent:multi_preview_receiver", event?.detail ?? event);
  const payload = normalizeCustomReceiverEvent(event);
  if (!payload) {
    mpWarn("customEvent: normalized payload is empty", event);
    return;
  }
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
    const stateKey =
      previewStateKey(liveNode) ||
      promptFallbackStateKey(nodeId, node.class_type || "MultiPreview");

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
          state_key: stateKey || "",
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
    mpLog("extension:setup");
    patchQueuePromptOnce();
    registerCustomReceiverEventListener();
    registerStatePersistence();
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
    const originalOnRemoved = nodeType.prototype.onRemoved;

    nodeType.prototype.onNodeCreated = function (...args) {
      mpLog("lifecycle:onNodeCreated", { node: mpNodeLabel(this), args });
      const result = originalOnNodeCreated?.apply(this, args);
      ensureWidgets(this, { reconcileInputs: false });
      return result;
    };

    nodeType.prototype.onConfigure = function (...args) {
      mpLog("lifecycle:onConfigure", { node: mpNodeLabel(this), args });
      const result = originalOnConfigure?.apply(this, args);
      ensureWidgets(this, { reconcileInputs: false });
      return result;
    };

    nodeType.prototype.onConnectionsChange = function (...args) {
      mpLog("lifecycle:onConnectionsChange", { node: mpNodeLabel(this), args });
      const result = originalOnConnectionsChange?.apply(this, args);

      if (this.__mpConnectionChangeScheduled) {
        return result;
      }

      this.__mpConnectionChangeScheduled = true;
      setTimeout(() => {
        this.__mpConnectionChangeScheduled = false;

        reconcileDynamicInputs(this, { allowRemove: true });
        reconcileConnectedPinIndexState(this);

        const selectedPin = getSelectedPin(this);
        if (!isAutoPreviewNode(this) && !buttonPinKeys(this).includes(selectedPin)) {
          setSelectedPin(this, firstAvailablePin(this));
        }

        updateButtonLabels(this);
        requestRedraw(this);
        saveNodeState(this);
      }, 0);

      return result;
    };

    nodeType.prototype.onRemoved = function (...args) {
      mpLog("lifecycle:onRemoved", { node: mpNodeLabel(this) });

      const store = globalStateStore();
      for (const key of previewStateKeysForNode(this)) {
        if (store.delete(key)) {
          mpLog("onRemoved: cleared globalStateStore key", { key, node: mpNodeLabel(this) });
        }
      }

      return originalOnRemoved?.apply(this, args);
    };

    nodeType.prototype.onExecuted = function (output, ...args) {
      mpLog("lifecycle:onExecuted", {
        node: mpNodeLabel(this),
        outputKeys: Object.keys(output || {}),
        output,
        args,
      });
      // Intentionally do not call original PreviewImage.onExecuted.
      // MultiPreview manages node.images/node.imgs directly and removes the
      // standard preview widget to avoid duplicate previews.
      // Intentionally unused: suppress lint/no-unused warnings for captured args.
      void originalOnExecuted;
      void args;

      ensureWidgets(this, { reconcileInputs: false });
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

        selectPin(this, selectedPin, { deferUntilLoaded: true });
      }

      reconcileDynamicInputs(this, { allowRemove: true });
      removeStandardPreviewWidgetsSoon(this);
      updateButtonLabels(this);
      requestRedraw(this);
      saveNodeState(this);
    };
  },
});
