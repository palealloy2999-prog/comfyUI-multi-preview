import { app } from "../../scripts/app.js";

app.registerExtension({
    name: "comfyui.multipreview",
    
    async setup() {
        // Setup complete
    },
    
    async loadedGraphNode(node, app) {
        if (node.type !== "MultiPreview") {
            return;
        }

        // Initialize state
        if (!node.multipreviewState) {
            node.multipreviewState = {
                buttons: {},
                selectedPin: 1,
                previewData: null,
                previewCanvas: null,
            };
        }

        // Ensure initial image input exists
        if (!getImageInputs(node).length) {
            addImageInput(node);
        }

        // Create UI elements
        createControlPanel(node);
        createPreviewCanvas(node);

        // Override onConnectionsChange to handle dynamic input growth
        const originalOnConnectionsChange = node.onConnectionsChange;
        node.onConnectionsChange = function(type, slotIndex, connected, link_info, ioSlot) {
            if (originalOnConnectionsChange) {
                originalOnConnectionsChange.call(this, type, slotIndex, connected, link_info, ioSlot);
            }

            // type === 1 means input connection
            if (type === 1) {
                const input = this.inputs?.[slotIndex];
                if (input && isImageInput(input)) {
                    if (connected) {
                        // Last image input was connected - add new trailing empty input
                        ensureTrailingEmptyInput(this);
                    } else {
                        // Input disconnected - remove unused trailing inputs
                        removeUnusedTrailingInputs(this);
                    }
                }
            }

            // Refresh UI
            refreshControlPanel(this);
            updateButtonStates(this);
        };

        // Handle node execution - refresh preview image
        const originalOnExecuted = node.onExecuted;
        node.onExecuted = function(output) {
            if (originalOnExecuted) {
                originalOnExecuted.call(this, output);
            }
            
            // Store preview data for display
            node.multipreviewState.previewData = output;
            displayPreviewImage(this, output);
        };

        // Initial UI update
        updateButtonStates(node);
    }
});

// ==================== Helper Functions ====================

function isImageInput(input) {
    return input && typeof input.name === 'string' && input.name.startsWith('image');
}

function getImageInputs(node) {
    return (node.inputs || []).filter(isImageInput);
}

function getImageInputIndex(inputName) {
    // Extract number from "image1", "image2", etc.
    const match = inputName.match(/^image(\d+)$/);
    return match ? parseInt(match[1], 10) : 0;
}

function addImageInput(node) {
    const inputs = getImageInputs(node);
    const nextIndex = inputs.length + 1;
    node.addInput(`image${nextIndex}`, "IMAGE");
}

function ensureTrailingEmptyInput(node) {
    const inputs = getImageInputs(node);
    if (!inputs.length) {
        addImageInput(node);
        return;
    }

    const lastInput = inputs[inputs.length - 1];
    // If last input is connected, add new empty input
    if (lastInput.link !== null && lastInput.link !== undefined) {
        addImageInput(node);
    }
}

function removeUnusedTrailingInputs(node) {
    const inputs = getImageInputs(node);
    // Remove trailing unconnected inputs (but keep at least one)
    for (let i = inputs.length - 1; i > 0; i--) {
        const input = inputs[i];
        if (!input.link) {
            const slotIndex = node.inputs.indexOf(input);
            if (slotIndex >= 0) {
                node.removeInput(slotIndex);
            }
        } else {
            break; // Stop at first connected input
        }
    }
}

// ==================== UI Panel Functions ====================

function createControlPanel(node) {
    // Remove existing panel if any
    const existing = document.getElementById(`multipreview-buttons-${node.id}`);
    if (existing) {
        existing.remove();
    }

    const panelContainer = document.createElement("div");
    panelContainer.id = `multipreview-buttons-${node.id}`;
    panelContainer.style.cssText = `
        display: flex;
        gap: 5px;
        padding: 8px;
        background: #2a2a2a;
        border-radius: 4px;
        margin-bottom: 8px;
        flex-wrap: wrap;
        align-items: center;
    `;

    node.multipreviewState.buttons = {};

    const imageInputs = getImageInputs(node);
    imageInputs.forEach((input, idx) => {
        const pinNumber = getImageInputIndex(input.name);
        const button = document.createElement("button");
        button.id = `multipreview-btn-${node.id}-${pinNumber}`;
        button.textContent = pinNumber.toString();
        button.dataset.pinNumber = pinNumber;
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
        `;
        button.disabled = true;

        button.addEventListener("click", (e) => {
            e.preventDefault();
            if (!button.disabled) {
                node.multipreviewState.selectedPin = pinNumber;
                updateButtonStates(node);
                displayPreviewImage(node, node.multipreviewState.previewData);
            }
        });

        button.addEventListener("mouseenter", () => {
            if (!button.disabled) {
                button.style.background = "#4a4a4a";
                button.style.borderColor = "#777";
            }
        });

        button.addEventListener("mouseleave", () => {
            if (!button.disabled) {
                if (node.multipreviewState.selectedPin === pinNumber) {
                    button.style.background = "#4a90e2";
                    button.style.borderColor = "#5a9fef";
                } else {
                    button.style.background = "#3a3a3a";
                    button.style.borderColor = "#555";
                }
            }
        });

        node.multipreviewState.buttons[pinNumber] = {
            element: button,
        };
        panelContainer.appendChild(button);
    });

    // Add as DOM widget
    node.addDOMWidget("preview_buttons", "preview_buttons", panelContainer, {
        serialize: false,
        hideOnZoom: false,
    });
}

function refreshControlPanel(node) {
    createControlPanel(node);
}

function updateButtonStates(node) {
    const imageInputs = getImageInputs(node);
    
    imageInputs.forEach((input) => {
        const pinNumber = getImageInputIndex(input.name);
        const button = node.multipreviewState.buttons[pinNumber];
        if (!button) return;

        const hasConnection = input.link !== null && input.link !== undefined;
        const isSelected = node.multipreviewState.selectedPin === pinNumber;

        if (hasConnection) {
            button.element.disabled = false;
            button.element.style.color = "#fff";
            button.element.style.cursor = "pointer";
            button.element.style.background = isSelected ? "#4a90e2" : "#3a3a3a";
            button.element.style.borderColor = isSelected ? "#5a9fef" : "#555";
        } else {
            button.element.disabled = true;
            button.element.style.background = "#3a3a3a";
            button.element.style.borderColor = "#555";
            button.element.style.color = "#888";
            button.element.style.cursor = "not-allowed";
        }
    });
}

// ==================== Preview Canvas Functions ====================

function createPreviewCanvas(node) {
    const canvasContainer = document.createElement("div");
    canvasContainer.id = `multipreview-canvas-${node.id}`;
    canvasContainer.style.cssText = `
        width: 100%;
        min-height: 200px;
        background: #1a1a1a;
        border: 1px solid #444;
        border-radius: 4px;
        display: flex;
        align-items: center;
        justify-content: center;
        margin-top: 8px;
    `;

    const canvas = document.createElement("canvas");
    canvas.id = `multipreview-canvas-element-${node.id}`;
    canvas.style.cssText = `
        max-width: 100%;
        max-height: 100%;
        object-fit: contain;
    `;

    canvasContainer.appendChild(canvas);
    node.multipreviewState.previewCanvas = canvas;

    node.addDOMWidget("preview_canvas", "preview_canvas", canvasContainer, {
        serialize: false,
        hideOnZoom: false,
        getMinHeight: () => 200,
    });
}

function displayPreviewImage(node, outputData) {
    if (!outputData || !node.multipreviewState.previewCanvas) {
        return;
    }

    const selectedPin = node.multipreviewState.selectedPin;
    const imageKey = `image${selectedPin}`;

    // Output data is keyed by input name (e.g., "image1", "image2", etc.)
    const images = outputData[imageKey];
    if (!images || !images[0]) {
        return;
    }

    const imageData = images[0]; // First image in batch
    if (!imageData) {
        return;
    }

    const canvas = node.multipreviewState.previewCanvas;
    canvas.width = imageData.width || 512;
    canvas.height = imageData.height || 512;

    const ctx = canvas.getContext("2d");
    const imageArray = new Uint8ClampedArray(imageData.data);
    const imgData = ctx.createImageData(
        canvas.width,
        canvas.height
    );
    imgData.data.set(imageArray);
    ctx.putImageData(imgData, 0, 0);
}
