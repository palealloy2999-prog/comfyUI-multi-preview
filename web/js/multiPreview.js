/**
 * Multi Preview Node JavaScript Extension
 * Provides UI enhancements for the MultiPreview node with pin-aligned buttons
 */

import { app } from "../../scripts/app.js";

const IMAGE_INPUT_PREFIX = 'image'
const IMAGE_INPUT_TYPE = 'IMAGE'

app.registerExtension({
    name: "comfyui.multipreview",
    async setup() {
        // Setup complete
    },
    
    async addCustomNodeDefs(defs, app) {
        // Register custom node definitions
    },
    
    async loadedGraphNode(node, app) {
      if (node.type !== 'MultiPreview') {
        return
      }

      if (!node.multipreviewState) {
        node.multipreviewState = {
          buttons: {},
          selectedPin: null,
        }
      }

      // Ensure at least one image input exists for a fresh node
      if (!getImageInputs(node).length) {
        addNewImageInput(node)
      }

      createControlPanel(node)

      const originalOnConnectionsChange = node.onConnectionsChange
      node.onConnectionsChange = function (type, slotIndex, connected, link_info, ioSlot) {
        if (originalOnConnectionsChange) {
          originalOnConnectionsChange.call(this, type, slotIndex, connected, link_info, ioSlot)
        }

        if (type === 1) {
          const input = this.inputs[slotIndex]
          if (input && isImageInput(input)) {
            if (connected) {
              ensureTrailingEmptyInput(this)
            } else {
              removeUnusedTrailingImageInputs(this)
            }
          }
        }

        refreshControlPanel(this)
        monitorInputs(this)
      }

      monitorInputs(node)

      const originalOnExecuted = node.onExecuted
      node.onExecuted = function (message) {
        if (originalOnExecuted) {
          originalOnExecuted.call(this, message)
        }
        updateButtonStates(this)
      }
    }
});

function isImageInput(input) {
  return input && typeof input.name === 'string' && input.name.startsWith(IMAGE_INPUT_PREFIX)
}

function getImageInputs(node) {
  return (node.inputs || []).filter(isImageInput)
}

function addNewImageInput(node) {
  const nextIndex = getImageInputs(node).length + 1
  node.addInput(`${IMAGE_INPUT_PREFIX}${nextIndex}`, IMAGE_INPUT_TYPE)
}

function removeUnusedTrailingImageInputs(node) {
  const imageInputs = getImageInputs(node)
  for (let i = imageInputs.length - 1; i > 0; i--) {
    const input = imageInputs[i]
    if (!input.link) {
      const slotIndex = node.inputs.indexOf(input)
      if (slotIndex >= 0) {
        node.removeInput(slotIndex)
      }
    } else {
      break
    }
  }
}

function ensureTrailingEmptyInput(node) {
  const imageInputs = getImageInputs(node)
  const lastInput = imageInputs[imageInputs.length - 1]
  if (!lastInput) {
    addNewImageInput(node)
    return
  }
  if (lastInput.link !== null && lastInput.link !== undefined) {
    addNewImageInput(node)
  }
}

function refreshControlPanel(node) {
  const oldPanel = document.getElementById(`multipreview-panel-${node.id}`)
  if (oldPanel) {
    oldPanel.remove()
    node.multipreviewPanel = null
  }
  createControlPanel(node)
}

function createControlPanel(node) {
    const imageInputs = getImageInputs(node)
    if (!imageInputs.length) {
      return
    }

    const container = document.createElement("div");
    container.id = `multipreview-panel-${node.id}`;
    container.style.cssText = `
        display: flex;
        gap: 5px;
        padding: 8px;
        background: #2a2a2a;
        border-radius: 4px;
        margin-top: 8px;
        flex-wrap: wrap;
    `;

    node.multipreviewState.buttons = {};

    imageInputs.forEach((input, index) => {
      const pinNumber = index + 1
      const pinLabel = input.name || `pin_${pinNumber}`

      const button = document.createElement('button')
      button.id = `multipreview-btn-${node.id}-${pinNumber}`
      button.textContent = pinNumber.toString()
      button.dataset.pinNumber = pinNumber
      button.dataset.pinLabel = pinLabel
      button.style.cssText = `
            min-width: 32px;
            height: 32px;
            padding: 0;
            border: 1px solid #555;
            border-radius: 3px;
            background: #3a3a3a;
            color: #888;
            font-weight: bold;
            cursor: not-allowed;
            transition: all 0.2s ease;
            font-size: 12px;
        `
      button.disabled = true

      button.addEventListener('click', (e) => {
        e.preventDefault()
        if (!button.disabled) {
          selectPin(node, pinNumber)
        }
      })

      button.addEventListener('mouseenter', () => {
        if (!button.disabled) {
          button.style.background = '#4a4a4a'
          button.style.borderColor = '#777'
        }
      })

      button.addEventListener('mouseleave', () => {
        if (!button.disabled) {
          if (node.multipreviewState.selectedPin === pinNumber) {
            button.style.background = '#4a90e2'
            button.style.borderColor = '#5a9fef'
          } else {
            button.style.background = '#3a3a3a'
            button.style.borderColor = '#555'
          }
        }
      })

      node.multipreviewState.buttons[pinNumber] = {
        element: button,
        enabled: false,
        active: false,
        label: pinLabel,
      }
      container.appendChild(button)
    })

    node.multipreviewPanel = container
}

function monitorInputs(node) {
    updateButtonStates(node)
}

function updateButtonState(node, pinNumber, hasInput) {
    const buttonState = node.multipreviewState.buttons[pinNumber];
    if (!buttonState) return;

    const button = buttonState.element;
    const isActive = node.multipreviewState.selectedPin === pinNumber;

    buttonState.enabled = hasInput;
    buttonState.active = isActive;

    if (hasInput) {
        button.disabled = false;
        button.style.color = "#fff";
        button.style.cursor = "pointer";
        button.style.background = isActive ? '#4a90e2' : '#3a3a3a'
        button.style.borderColor = isActive ? '#5a9fef' : '#555'
    } else {
        button.disabled = true;
        button.style.background = "#3a3a3a";
        button.style.borderColor = "#555";
        button.style.color = "#888";
        button.style.cursor = "not-allowed";
    }
}

function selectPin(node, pinNumber) {
  node.multipreviewState.selectedPin = pinNumber
  Object.entries(node.multipreviewState.buttons).forEach(([num, buttonState]) => {
    if (!buttonState) return
    const isActive = parseInt(num, 10) === pinNumber
    buttonState.element.style.background = isActive ? '#4a90e2' : '#3a3a3a'
    buttonState.element.style.borderColor = isActive ? '#5a9fef' : '#555'
  })

  if (node.onPinSelected) {
    node.onPinSelected(pinNumber)
  }
}

function updateButtonStates(node) {
    const imageInputs = getImageInputs(node)
    imageInputs.forEach((input, index) => {
      const pinNumber = index + 1
      const hasInput = input.link !== null && input.link !== undefined
      updateButtonState(node, pinNumber, hasInput)
    })
}
