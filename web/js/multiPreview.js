// MultiPreview v23 debug-lite build
console.info('[MultiPreview] v23 preserve-previous-preview loaded')

import { app } from '../../scripts/app.js'
import { api } from '../../scripts/api.js'

const PARENT_NODE = 'MultiPreview'
const RECEIVER_NODE = 'MultiPreviewReceiver'
const VIRTUAL_ID_BASE = 900000000
const MAX_PINS = 100
const LOG_PREFIX = '[MultiPreview v23]'
const PREVIEW_CACHE = (globalThis.__multiPreviewCache ??= new Map())

function log(event, data = undefined) {
  if (data === undefined) console.log(`${LOG_PREFIX} ${event}`)
  else console.log(`${LOG_PREFIX} ${event}`, data)
}

function warn(event, data = undefined) {
  if (data === undefined) console.warn(`${LOG_PREFIX} ${event}`)
  else console.warn(`${LOG_PREFIX} ${event}`, data)
}

function summarizeNode(node) {
  if (!node) return null
  return {
    id: node.id,
    type: node.type,
    comfyClass: node.comfyClass,
    inputs: (node.inputs || []).map((input) => ({ name: input.name, type: input.type, link: input.link })),
    selectedPin: node._mpSelectedPin,
    imagePins: Object.keys(node._mpImageByPin || {}),
  }
}

function getPreviewCacheKey(node) {
  return String(node?.id ?? '')
}

function cloneImageItem(item) {
  if (!item || typeof item !== 'object') return null
  return {
    filename: item.filename,
    subfolder: item.subfolder || '',
    type: item.type || 'temp',
    width: Number(item.width) || undefined,
    height: Number(item.height) || undefined,
  }
}

function cloneImageEntry(entry) {
  if (!entry || typeof entry !== 'object') return null
  const items = Array.isArray(entry.items) ? entry.items.map(cloneImageItem).filter(Boolean) : []
  return {
    pin: Number(entry.pin) || 0,
    items,
    currentIndex: Number(entry.currentIndex) || 0,
  }
}

function cloneImageByPin(imageByPin) {
  const result = {}
  for (const [pin, entry] of Object.entries(imageByPin || {})) {
    const cloned = cloneImageEntry(entry)
    if (cloned && cloned.items.length > 0) result[pin] = cloned
  }
  return result
}

function cacheParentPreview(node) {
  if (!isParentNode(node)) return
  const key = getPreviewCacheKey(node)
  if (!key) return
  PREVIEW_CACHE.set(key, {
    selectedPin: node._mpSelectedPin ?? 1,
    imageByPin: cloneImageByPin(node._mpImageByPin || {}),
  })
}

function restoreParentPreviewCache(node) {
  if (!isParentNode(node)) return false
  const key = getPreviewCacheKey(node)
  const cached = key ? PREVIEW_CACHE.get(key) : null
  if (!cached) return false

  const hasCurrentImages = Object.keys(node._mpImageByPin || {}).length > 0
  if (!hasCurrentImages) {
    node._mpImageByPin = cloneImageByPin(cached.imageByPin || {})
  }
  node._mpSelectedPin = cached.selectedPin ?? node._mpSelectedPin ?? 1
  return true
}

function clearParentPreviewCache(node) {
  const key = getPreviewCacheKey(node)
  if (key) PREVIEW_CACHE.delete(key)
}

function isAliveElement(element) {
  return !!(element && element.isConnected)
}

function removeDomWidgetByName(node, name) {
  if (!Array.isArray(node?.widgets)) return
  node.widgets = node.widgets.filter((widget) => widget?.name !== name)
}

function ensureDomWidgets(node) {
  let rebuilt = false

  if (!isAliveElement(node._mpButtonContainer)) {
    removeDomWidgetByName(node, 'mp_buttons')
    node._mpButtonContainer = null
    node._mpButtonWidget = null
    node._mpButtons = {}
    createButtonPanel(node)
    rebuilt = true
  }

  if (!isAliveElement(node._mpImgElement) || !isAliveElement(node._mpPreviewContainer)) {
    removeDomWidgetByName(node, 'mp_preview')
    node._mpPreviewContainer = null
    node._mpPreviewContents = null
    node._mpImgElement = null
    node._mpPlaceholder = null
    node._mpSizeLabel = null
    node._mpPageButton = null
    node._mpPreviewWidget = null
    createPreviewPanel(node)
    rebuilt = true
  }

  return rebuilt
}

function rehydrateParentNode(node, reason = 'rehydrate') {
  if (!isParentNode(node)) return false
  const restored = restoreParentPreviewCache(node)
  const rebuilt = ensureDomWidgets(node)

  if (restored || rebuilt) {
    rebuildButtons(node)
    updateButtonStates(node)
    showImage(node, node._mpSelectedPin ?? 1)
    ensureParentSize(node)
    markNodeDirty(node)
    log('rehydrated', { reason, restored, rebuilt, node: summarizeNode(node) })
    return true
  }

  return false
}

app.registerExtension({
  name: 'comfyui.multipreview',

  setup() {
    log('setup', { hasQueuePrompt: !!api?.queuePrompt })
    patchQueuePrompt()
    api.addEventListener?.('executed', handleExecutedEvent)
  },

  async beforeQueuePrompt(...args) {
    log('beforeQueuePrompt', { argCount: args.length })
    for (const arg of args) injectVirtualReceivers(arg, 'beforeQueuePrompt')
  },

  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (isParentNodeData(nodeData)) {
      log('register parent', { name: nodeData?.name, comfyClass: nodeData?.comfyClass })
      patchParentNodeType(nodeType)
      return
    }

    if (isReceiverNodeData(nodeData)) {
      log('register internal receiver', { name: nodeData?.name, comfyClass: nodeData?.comfyClass })
      nodeData.category = '_internal/MultiPreview'
      nodeData.display_name = '__internal__ MultiPreview Receiver'
      nodeData.hidden = true
      nodeData.hide = true
      nodeData.skip_list = true
    }
  },

  async nodeCreated(node) {
    if (!isParentNode(node)) return
    log('nodeCreated', summarizeNode(node))
    initializeParentNode(node)
    startParentInputWatcher(node)
    setTimeout(() => syncParentNode(node, 'nodeCreated'), 0)
  },
})

function patchParentNodeType(nodeType) {
  patchConnectionHandler(nodeType, 'onConnectionsChange')
  patchConnectionHandler(nodeType, 'onConnectionChange')
  patchResizeHandler(nodeType, 'onResize')
  patchResizeHandler(nodeType, 'onNodeResized')

  const origOnRemoved = nodeType.prototype.onRemoved
  nodeType.prototype.onRemoved = function (...args) {
    log('node removed', summarizeNode(this))
    stopParentInputWatcher(this)
    origOnRemoved?.apply(this, args)
  }
}

function patchConnectionHandler(nodeType, methodName) {
  const original = nodeType.prototype[methodName]
  if (original?._mpPatched) return

  const patched = function (...args) {
    original?.apply(this, args)
    if (!isParentNode(this)) return

    const side = args[0]
    const isInputSide = side === 1 || side === 'input' || side === 'INPUT'
    if (!isInputSide) return

    log('connection changed', { methodName, args, node: summarizeNode(this) })
    syncParentNode(this, 'connectionChanged')
  }

  patched._mpPatched = true
  nodeType.prototype[methodName] = patched
}

function patchResizeHandler(nodeType, methodName) {
  const original = nodeType.prototype[methodName]
  if (original?._mpResizePatched) return

  const patched = function (...args) {
    const result = original?.apply(this, args)
    if (isParentNode(this)) {
      handleNodeResize(this, methodName)
    }
    return result
  }

  patched._mpResizePatched = true
  nodeType.prototype[methodName] = patched
}

function handleNodeResize(node, source = 'resize') {
  const signature = getNodeSizeSignature(node)
  if (signature === node._mpLastSizeSignature && source !== 'force') return
  node._mpLastSizeSignature = signature
  requestAnimationFrame(() => {
    compactDomWidget(node._mpButtonWidget, 34)
    updatePreviewWidgetSize(node)
    markNodeDirty(node)
  })
}

function patchQueuePrompt() {
  if (!api?.queuePrompt || api.queuePrompt._mpPatched) return

  const original = api.queuePrompt
  api.queuePrompt = function (...args) {
    log('queuePrompt', { argCount: args.length })
    try {
      resetQueuedParentPreviews()
      for (const arg of args) injectVirtualReceivers(arg, 'queuePrompt')
    } catch (err) {
      warn('queuePrompt inject failed', err)
    }
    return original.apply(this, args)
  }

  api.queuePrompt._mpPatched = true
}

function isParentNodeData(nodeData) {
  return nodeData?.name === PARENT_NODE || nodeData?.comfyClass === PARENT_NODE
}

function isReceiverNodeData(nodeData) {
  return nodeData?.name === RECEIVER_NODE || nodeData?.comfyClass === RECEIVER_NODE
}

function isParentNode(node) {
  return node?.comfyClass === PARENT_NODE || node?.type === PARENT_NODE || node?.constructor?.type === PARENT_NODE
}

function initializeParentNode(node) {
  node._mpSelectedPin ??= 1
  node._mpImageByPin ??= {}
  node._mpInputSignature = getInputSignature(node)
  node._mpLastSizeSignature = getNodeSizeSignature(node)

  ensureMinimumInputs(node)
  restoreParentPreviewCache(node)
  ensureDomWidgets(node)

  rebuildButtons(node)
  updateButtonStates(node)
  showImage(node, node._mpSelectedPin ?? 1)
  ensureParentSize(node)
  markNodeDirty(node)
}

function syncParentNode(node, reason = 'manual') {
  if (!isParentNode(node)) return

  const before = getInputSignature(node)
  ensureMinimumInputs(node)
  const changeInfo = updateDynamicInputs(node)
  dropImagesForRemovedPins(node)
  rebuildButtons(node)
  normalizeSelectedPin(node)
  updateButtonStates(node)
  showImage(node, node._mpSelectedPin ?? 1)
  ensureParentSize(node)
  cacheParentPreview(node)
  markNodeDirty(node)
  const after = getInputSignature(node)
  node._mpInputSignature = after
  node._mpLastSizeSignature = getNodeSizeSignature(node)

  if (before !== after || changeInfo.changed) {
    log('sync', { reason, before, after, changeInfo, node: summarizeNode(node) })
  }
}

function getInputSignature(node) {
  return getImageInputs(node)
    .map((input) => `${input.name}:${input.type}:${input.link ?? 'none'}`)
    .join('|')
}

function getNodeSizeSignature(node) {
  const width = Math.round(Number(node?.size?.[0] ?? 0))
  const height = Math.round(Number(node?.size?.[1] ?? 0))
  return `${width}x${height}`
}

function startParentInputWatcher(node) {
  if (node._mpInputWatcher) return
  node._mpInputSignature = getInputSignature(node)
  node._mpLastSizeSignature = getNodeSizeSignature(node)

  node._mpInputWatcher = setInterval(() => {
    if (!app.graph || !app.graph._nodes?.includes(node)) {
      stopParentInputWatcher(node)
      return
    }

    if (
      !isAliveElement(node._mpButtonContainer) ||
      !isAliveElement(node._mpPreviewContainer) ||
      !isAliveElement(node._mpImgElement)
    ) {
      rehydrateParentNode(node, 'detachedDomWatcher')
      return
    }

    const current = getInputSignature(node)
    if (current !== node._mpInputSignature) {
      log('input watcher changed', { before: node._mpInputSignature, after: current, node: summarizeNode(node) })
      syncParentNode(node, 'inputWatcher')
    }
  }, 500)
}

function stopParentInputWatcher(node) {
  if (node?._mpInputWatcher) {
    clearInterval(node._mpInputWatcher)
    node._mpInputWatcher = null
  }
}

function isImageInput(input) {
  return input && /^image\d+$/.test(input.name)
}

function getImageInputs(node) {
  return [...(node.inputs || [])].filter(isImageInput).sort((a, b) => getPinNumber(a.name) - getPinNumber(b.name))
}

function getPinNumber(inputName) {
  const m = String(inputName || '').match(/^image(\d+)$/)
  return m ? parseInt(m[1], 10) : 0
}

function ensureMinimumInputs(node) {
  const names = getImageInputs(node).map((input) => input.name)
  if (!names.includes('image1')) {
    node.addInput('image1', 'IMAGE')
    log('pin added', { nodeId: node.id, name: 'image1', reason: 'minimum' })
  }
}

function updateDynamicInputs(node) {
  const changes = { changed: false, added: [], removed: [] }
  let changed = false
  let guard = 0

  do {
    changed = false
    const inputs = getImageInputs(node)
    if (!inputs.length) return changes

    const last = inputs[inputs.length - 1]
    if (last?.link != null) {
      const maxPin = Math.max(...inputs.map((input) => getPinNumber(input.name)))
      const nextName = `image${maxPin + 1}`
      if (maxPin < MAX_PINS && !inputs.some((input) => input.name === nextName)) {
        node.addInput(nextName, 'IMAGE')
        changes.changed = true
        changes.added.push(nextName)
        log('pin added', { nodeId: node.id, name: nextName, reason: 'last pin connected' })
        changed = true
      }
    }
    guard += 1
  } while (changed && guard < MAX_PINS)

  const inputs = getImageInputs(node)
  for (let i = inputs.length - 1; i > 0; i--) {
    const cur = inputs[i]
    const prev = inputs[i - 1]
    if (cur.link == null && prev.link == null) {
      const pin = getPinNumber(cur.name)
      delete node._mpImageByPin?.[pin]
      const slotIndex = node.inputs.indexOf(cur)
      if (slotIndex >= 0) {
        node.removeInput(slotIndex)
        changes.changed = true
        changes.removed.push(cur.name)
        log('pin removed', { nodeId: node.id, name: cur.name, reason: 'trailing empty pins' })
      }
    } else {
      break
    }
  }

  return changes
}

function dropImagesForRemovedPins(node) {
  const validPins = new Set(getImageInputs(node).map((input) => getPinNumber(input.name)))
  Object.keys(node._mpImageByPin || {}).forEach((pinKey) => {
    if (!validPins.has(Number(pinKey))) delete node._mpImageByPin[pinKey]
  })
}

function resetQueuedParentPreviews() {
  for (const node of app.graph?._nodes || []) {
    if (!isParentNode(node)) continue

    // Keep the previous preview visible while the new queue is running.
    // New results overwrite each pin when their receiver returns.
    restoreParentPreviewCache(node)
    ensureDomWidgets(node)
    dropImagesForRemovedPins(node)
    normalizeSelectedPin(node)
    rebuildButtons(node)
    updateButtonStates(node)
    showImage(node, node._mpSelectedPin ?? 1)
    ensureParentSize(node)
    cacheParentPreview(node)
    markNodeDirty(node)
    log('preview preserved for new queue', { nodeId: node.id, node: summarizeNode(node) })
  }
}

function injectVirtualReceivers(target, source = 'unknown') {
  const output = getPromptOutput(target)
  if (!output) {
    warn('inject skipped: prompt output not found', { source })
    return
  }

  removeOldVirtualReceivers(output)

  for (const parent of app.graph?._nodes || []) {
    if (!isParentNode(parent)) continue

    const parentPrompt = output[String(parent.id)] || output[parent.id]
    if (!parentPrompt?.inputs) {
      warn('inject skipped: parent not in prompt', { source, parentId: parent.id })
      continue
    }

    const connectedInputs = getImageInputs(parent).filter((input) => input.link != null)
    for (const input of connectedInputs) {
      const pin = getPinNumber(input.name)
      const imageRef = getExecutableImageRef(output, parentPrompt, parent, input)
      if (!imageRef) {
        warn('inject skipped: executable input ref not found', {
          source,
          parentId: parent.id,
          inputName: input.name,
          pin,
        })
        continue
      }

      const virtualId = getVirtualReceiverId(parent.id, pin)
      output[virtualId] = {
        inputs: {
          image: imageRef,
          parent_id: String(parent.id),
          pin,
        },
        class_type: RECEIVER_NODE,
        _meta: {
          title: `_MP virtual receiver ${parent.id}:${pin}`,
        },
      }

      log('virtual receiver injected', { source, parentId: parent.id, pin, inputName: input.name, imageRef, virtualId })
    }
  }
}

function getExecutableImageRef(output, parentPrompt, parent, input) {
  const convertedRef = parentPrompt?.inputs?.[input.name]
  if (isValidPromptLink(convertedRef)) return normalizePromptLink(convertedRef)

  const link = app.graph?.links?.[input.link]
  if (!link) return null

  if (output[String(link.origin_id)] || output[link.origin_id]) {
    return [String(link.origin_id), link.origin_slot]
  }

  warn('upstream node is not in prompt output', {
    originId: link.origin_id,
    inputName: input.name,
    parentId: parent.id,
  })
  return null
}

function isValidPromptLink(value) {
  return Array.isArray(value) && value.length >= 2 && value[0] != null && value[1] != null
}

function normalizePromptLink(value) {
  return [String(value[0]), value[1]]
}

function getPromptOutput(target) {
  if (!target || typeof target !== 'object') return null
  if (isPromptOutput(target.output)) return target.output
  if (isPromptOutput(target.prompt)) return target.prompt
  if (isPromptOutput(target)) return target
  return null
}

function isPromptOutput(value) {
  return !!(
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.values(value).some((entry) => entry?.class_type && entry?.inputs)
  )
}

function removeOldVirtualReceivers(output) {
  Object.keys(output).forEach((key) => {
    const node = output[key]
    if (node?.class_type === RECEIVER_NODE && String(node?._meta?.title || '').startsWith('_MP virtual receiver')) {
      delete output[key]
    }
  })
}

function getVirtualReceiverId(parentId, pin) {
  return String(VIRTUAL_ID_BASE + Number(parentId) * 1000 + Number(pin))
}

function handleExecutedEvent(event) {
  const detail = event?.detail || {}
  const output = detail.output || detail?.data?.output || detail
  const raw = output?.mp_receiver

  if (!raw) {
    return
  }

  log('executed event: raw mp_receiver', raw)

  const entries = normalizeReceiverEntries(raw)
  log('executed event: normalized mp_receiver', entries)

  if (!entries.length) {
    warn('executed skipped: mp_receiver could not be normalized', raw)
    return
  }

  for (const entry of entries) {
    handleReceiverEntry(entry)
  }
}

function normalizeReceiverEntries(value) {
  if (!value) return []

  if (isReceiverEntry(value)) {
    return [value]
  }

  if (Array.isArray(value)) {
    const entries = value.filter(isReceiverEntry)
    if (entries.length > 0) {
      return entries
    }

    // Previous broken format looked like:
    // ["parent_id", "pin", "filename", "subfolder", "type"].
    // That contains only keys, not values, so it cannot be recovered.
    if (value.every((item) => typeof item === 'string')) {
      warn('normalizeReceiverEntries: got key list only; values are missing', value)
    }

    return []
  }

  if (typeof value === 'object') {
    // Some wrappers may place the payload under a common single key.
    for (const key of ['data', 'value', 'payload', 'entry']) {
      if (isReceiverEntry(value[key])) {
        return [value[key]]
      }
      if (Array.isArray(value[key])) {
        const entries = value[key].filter(isReceiverEntry)
        if (entries.length > 0) return entries
      }
    }
  }

  return []
}

function isReceiverEntry(value) {
  return (
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    value.parent_id != null &&
    value.pin != null &&
    (value.filename != null || Array.isArray(value.items))
  )
}

function normalizeReceiverItems(entry) {
  if (Array.isArray(entry?.items) && entry.items.length > 0) {
    return entry.items.map(normalizeReceiverItem).filter(Boolean)
  }
  const single = normalizeReceiverItem(entry)
  return single ? [single] : []
}

function normalizeReceiverItem(item) {
  if (!item || typeof item !== 'object' || item.filename == null) return null
  return {
    filename: item.filename,
    subfolder: item.subfolder || '',
    type: item.type || 'temp',
    width: Number(item.width) || undefined,
    height: Number(item.height) || undefined,
  }
}

function getCurrentImageItem(entry) {
  const items = entry?.items || []
  if (!items.length) return null
  const current = Number(entry.currentIndex) || 0
  const index = ((current % items.length) + items.length) % items.length
  entry.currentIndex = index
  return items[index]
}

function handleReceiverEntry(entry) {
  const parentId = Number(entry.parent_id)
  const pin = Number(entry.pin)
  if (!Number.isFinite(parentId) || !Number.isFinite(pin)) {
    warn('executed skipped: invalid parent/pin', entry)
    return
  }

  const parent = app.graph?.getNodeById?.(parentId)
  if (!isParentNode(parent)) {
    warn('executed skipped: parent not found', { parentId, pin })
    return
  }

  const items = normalizeReceiverItems(entry)
  if (!items.length) {
    warn('executed skipped: no image items', { parentId, pin, entry })
    return
  }

  parent._mpImageByPin ??= {}
  parent._mpImageByPin[pin] = {
    pin,
    items,
    currentIndex: 0,
  }

  log('image stored', { parentId, pin, count: items.length, entry: parent._mpImageByPin[pin] })
  cacheParentPreview(parent)

  normalizeSelectedPin(parent)
  rebuildButtons(parent)
  updateButtonStates(parent)
  showImage(parent, parent._mpSelectedPin ?? pin)
  ensureParentSize(parent)
  cacheParentPreview(parent)
  markNodeDirty(parent)
}

function createButtonPanel(node) {
  const container = document.createElement('div')
  container.style.cssText = `
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
        padding: 4px 6px;
        background: #2a2a2a;
        border-radius: 4px;
        align-items: center;
        box-sizing: border-box;
        width: 100%;
        height: 34px;
        min-height: 34px;
        max-height: 34px;
        overflow: hidden;
    `

  const widget = node.addDOMWidget('mp_buttons', 'mp_buttons', container)
  widget.computeSize = () => [node.size?.[0] ?? 340, 34]

  node._mpButtonContainer = container
  node._mpButtonWidget = widget
  node._mpButtons = {}

  requestAnimationFrame(() => compactDomWidget(widget, 34))
}

function rebuildButtons(node) {
  const container = node._mpButtonContainer
  if (!container) return

  container.innerHTML = ''
  node._mpButtons = {}

  const imageInputs = getImageInputs(node)
  imageInputs.forEach((input) => {
    const pin = getPinNumber(input.name)
    const btn = document.createElement('button')
    btn.textContent = String(pin)
    btn.type = 'button'
    btn.style.cssText = `
            min-width: 38px;
            height: 24px;
            padding:0 8px;
            border-radius: 3px;
            font-weight: bold;
            font-size: 12px;
            border: 1px solid #444;
            background: #2e2e2e;
            color: #555;
            cursor: not-allowed;
        `
    btn.disabled = true

    btn.addEventListener('click', (e) => {
      e.preventDefault()
      e.stopPropagation()
      if (btn.disabled) return
      node._mpSelectedPin = pin
      log('button clicked', { nodeId: node.id, pin })
      updateButtonStates(node)
      showImage(node, pin)
      cacheParentPreview(node)
      markNodeDirty(node)
    })

    node._mpButtons[pin] = btn
    container.appendChild(btn)
  })

  requestAnimationFrame(() => compactDomWidget(node._mpButtonWidget, 34))
}

function updateButtonStates(node) {
  const inputs = getImageInputs(node)
  const selectedPin = node._mpSelectedPin ?? 1

  inputs.forEach((input) => {
    const pin = getPinNumber(input.name)
    const btn = node._mpButtons?.[pin]
    if (!btn) return

    const hasImage = !!node._mpImageByPin?.[pin]
    const selected = selectedPin === pin
    btn.disabled = !hasImage

    if (!hasImage) {
      btn.style.background = '#2e2e2e'
      btn.style.borderColor = '#444'
      btn.style.color = '#555'
      btn.style.cursor = 'not-allowed'
    } else if (selected) {
      btn.style.background = '#4a90e2'
      btn.style.borderColor = '#5a9fef'
      btn.style.color = '#fff'
      btn.style.cursor = 'pointer'
    } else {
      btn.style.background = '#3a3a3a'
      btn.style.borderColor = '#555'
      btn.style.color = '#ccc'
      btn.style.cursor = 'pointer'
    }
  })
}

function normalizeSelectedPin(node) {
  const current = node._mpSelectedPin ?? 1
  if (node._mpImageByPin?.[current]) return

  const availablePins = Object.keys(node._mpImageByPin || {})
    .map(Number)
    .filter((pin) => !Number.isNaN(pin))
    .sort((a, b) => a - b)

  node._mpSelectedPin = availablePins.length > 0 ? availablePins[0] : 1
}

function createPreviewPanel(node) {
  const container = document.createElement('div')
  container.style.cssText = `
        width: 100%;
        height: 100%;
        min-height: 80px;
        border-radius: 4px;
        display: flex;
        align-items: center;
        justify-content: center;
        overflow: hidden;
        box-sizing: border-box;
        position: relative;
        flex-wrap: wrap;
    `

  const img = document.createElement('img')
  img.style.cssText = `
    max-width: 100%;
    max-height: calc(100% - 22px);
    width: auto;
    height: auto;
        object-fit: contain;
        display: none;
    `

  const placeholder = document.createElement('span')
  placeholder.textContent = 'No image'
  placeholder.style.cssText = 'color: #fff; font-size: 13px; font-family: sans-serif;'

  const sizeLabel = document.createElement('div')
  sizeLabel.style.cssText = `
        padding: 2px 6px;
        border-radius: 4px;
        text-align:center;
        color: #ddd;
        font-size: 12px;
        line-height: 1.2;
        font-family: sans-serif;
        pointer-events: none;
        display: none;
        white-space: nowrap;
    `
  sizeLabel.textContent = ''

  const pageButton = document.createElement('button')
  pageButton.type = 'button'
  pageButton.style.cssText = `
        position: absolute;
        right: 8px;
        bottom: 8px;
        min-width: 38px;
        height: 38px;
        border: none;
        border-radius: 8px;
        background: rgba(45, 45, 45, 0.92);
        color: #fff;
        font-size: 12px;
        font-family: sans-serif;
        cursor: pointer;
        display: none;
    `
  pageButton.textContent = '1/1'
  pageButton.addEventListener('click', (e) => {
    e.preventDefault()
    e.stopPropagation()
    cycleBatchImage(node)
  })

  const contents = document.createElement('div')
  contents.style.cssText = `
      max-height:100%;
      height:100%;
    `
  container.appendChild(contents)

  contents.appendChild(img)
  contents.appendChild(placeholder)
  contents.appendChild(sizeLabel)
  container.appendChild(pageButton)

  const widget = node.addDOMWidget('mp_preview', 'mp_preview', container)
  widget.computeSize = () => [node.size?.[0] ?? 340, getPreviewHeight(node)]

  node._mpPreviewContainer = container
  node._mpPreviewContents = contents
  node._mpImgElement = img
  node._mpPlaceholder = placeholder
  node._mpSizeLabel = sizeLabel
  node._mpPageButton = pageButton
  node._mpPreviewWidget = widget

  requestAnimationFrame(() => updatePreviewWidgetSize(node))
}

function showImage(node, pinNumber) {
  const img = node._mpImgElement
  const placeholder = node._mpPlaceholder
  const sizeLabel = node._mpSizeLabel
  const pageButton = node._mpPageButton
  if (!img || !placeholder) return

  const entry = node._mpImageByPin?.[pinNumber]
  const item = getCurrentImageItem(entry)
  if (!entry || !item) {
    img.style.display = 'none'
    placeholder.style.display = ''
    placeholder.textContent = 'No image'
    if (sizeLabel) {
      sizeLabel.style.display = 'none'
      sizeLabel.textContent = ''
    }
    updatePageButton(pageButton, 0, 0)
    return
  }

  const items = entry.items || []
  const currentIndex = entry.currentIndex || 0
  updatePageButton(pageButton, currentIndex, items.length)

  const params = new URLSearchParams({
    filename: item.filename,
    subfolder: item.subfolder || '',
    type: item.type || 'temp',
    rand: Math.random(),
  })

  const url = api?.apiURL ? api.apiURL(`/view?${params}`) : `/view?${params}`
  img.onload = () => {
    updateSizeLabel(sizeLabel, item, img)
    log('image loaded', {
      nodeId: node.id,
      pin: pinNumber,
      url,
      index: currentIndex,
      total: items.length,
      width: item.width,
      height: item.height,
    })
  }
  img.onerror = () => {
    img.style.display = 'none'
    placeholder.style.display = ''
    placeholder.textContent = 'Failed to load image'
    if (sizeLabel) {
      sizeLabel.style.display = 'none'
      sizeLabel.textContent = ''
    }
    warn('image load error', { nodeId: node.id, pin: pinNumber, url, item })
  }
  img.src = url
  img.style.display = 'block'
  placeholder.style.display = 'none'
  updateSizeLabel(sizeLabel, item, img)
}

function cycleBatchImage(node) {
  const pin = node?._mpSelectedPin ?? 1
  const entry = node?._mpImageByPin?.[pin]
  if (!entry || !Array.isArray(entry.items) || entry.items.length <= 1) return
  const current = Number(entry.currentIndex) || 0
  entry.currentIndex = (current + 1) % entry.items.length
  log('batch page clicked', { nodeId: node.id, pin, index: entry.currentIndex, total: entry.items.length })
  showImage(node, pin)
  cacheParentPreview(node)
  markNodeDirty(node)
}

function updatePageButton(pageButton, currentIndex, total) {
  if (!pageButton) return
  if (!Number.isFinite(total) || total <= 1) {
    pageButton.style.display = 'none'
    pageButton.textContent = '1/1'
    return
  }
  pageButton.textContent = `${currentIndex + 1}/${total}`
  pageButton.style.display = ''
}

function updateSizeLabel(sizeLabel, item, img) {
  if (!sizeLabel) return
  const width = Number(item?.width) || img?.naturalWidth || 0
  const height = Number(item?.height) || img?.naturalHeight || 0
  sizeLabel.textContent = width > 0 && height > 0 ? `${width} × ${height}` : ''
  sizeLabel.style.display = width > 0 && height > 0 ? '' : 'none'
}

function compactDomWidget(widget, height) {
  if (!widget) return
  widget.computeSize = () => [0, height]

  const wrapper = widget.element?.closest?.('.dom-widget')
  if (wrapper) {
    wrapper.classList.remove('size-full')
    wrapper.style.flex = '0 0 auto'
    wrapper.style.height = `${height}px`
    wrapper.style.minHeight = `${height}px`
    wrapper.style.maxHeight = `${height}px`
    wrapper.style.overflow = 'hidden'
  }

  if (widget.element) {
    widget.element.style.height = `${height}px`
    widget.element.style.minHeight = `${height}px`
    widget.element.style.maxHeight = `${height}px`
  }
}

function getPreviewHeight(node) {
  // LiteGraph lays out inputs + widgets vertically. Keep the button row compact,
  // then give the remaining visible node height to the preview widget.
  const nodeHeight = node.size?.[1] ?? 360
  const imageInputCount = getImageInputs(node).length
  const titleHeight = 34
  const inputRowsHeight = Math.max(1, imageInputCount) * 22
  const buttonHeight = 42
  const paddingAndMargins = 34
  return Math.max(80, nodeHeight - titleHeight - inputRowsHeight - buttonHeight - paddingAndMargins)
}

function updatePreviewWidgetSize(node) {
  const widget = node?._mpPreviewWidget
  if (!widget) return

  const height = getPreviewHeight(node)
  widget.computeSize = () => [node.size?.[0] ?? 340, height]

  const wrapper = widget.element?.closest?.('.dom-widget')
  if (wrapper) {
    wrapper.classList.remove('size-full')
    wrapper.style.flex = '0 0 auto'
    wrapper.style.height = `${height}px`
    wrapper.style.minHeight = `${height}px`
    wrapper.style.maxHeight = `${height}px`
    wrapper.style.overflow = 'hidden'
  }

  if (widget.element) {
    widget.element.style.height = `${height}px`
    widget.element.style.minHeight = `${height}px`
    widget.element.style.maxHeight = `${height}px`
    widget.element.style.overflow = 'hidden'
  }
  const contents = node?._mpPreviewContents
  if (contents) {
    contents.style.height = `${height}px`
    contents.style.minHeight = `${height}px`
    contents.style.maxHeight = `${height}px`
    contents.style.overflow = 'hidden'
  }
}

function ensureParentSize(node) {
  const width = Math.max(node.size?.[0] ?? 340, 340)
  const height = Math.max(node.size?.[1] ?? 320, 320)

  if (typeof node.setSize === 'function') {
    node.setSize([width, height])
  } else {
    node.size = [width, height]
  }

  requestAnimationFrame(() => {
    compactDomWidget(node._mpButtonWidget, 34)
    updatePreviewWidgetSize(node)
  })
}

function markNodeDirty(node) {
  node.setDirtyCanvas?.(true, true)
  app.graph?.setDirtyCanvas?.(true, true)
}
