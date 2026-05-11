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

        // Create UI elements
        createControlPanel(node);
        createPreviewCanvas(node);

        // Ensure at least image1 and image2 exist
        ensureMinimumInputs(node);

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
            
            console.log("[MultiPreview] onExecuted called with output:", output);
            
            // Store preview data for display
            if (output) {
                node.multipreviewState.previewData = output;
                displayPreviewImage(this, output);
            }
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

function ensureMinimumInputs(node) {
    const inputs = getImageInputs(node);
    // Ensure we have at least image1 and image2
    if (!inputs.find(i => i.name === 'image1')) {
        node.addInput('image1', 'IMAGE');
    }
    if (!inputs.find(i => i.name === 'image2')) {
        node.addInput('image2', 'IMAGE');
    }
}

function addImageInput(node) {
    const inputs = getImageInputs(node);
    const highestIndex = Math.max(...inputs.map(i => getImageInputIndex(i.name)));
    const nextIndex = highestIndex + 1;
    if (nextIndex <= 100) { // Cap at reasonable limit
        node.addInput(`image${nextIndex}`, "IMAGE");
    }
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
    // Only create once - reuse existing container
    let panelContainer = document.getElementById(`multipreview-buttons-${node.id}`);
    
    if (panelContainer) {
        // Panel already exists, just update buttons
        updateButtonStates(node);
        return;
    }

    panelContainer = document.createElement("div");
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
    node.multipreviewState.buttonContainer = panelContainer;

    // Add as DOM widget
    node.addDOMWidget("preview_buttons", "preview_buttons", panelContainer, {
        serialize: false,
        hideOnZoom: false,
    });

    // Recreate buttons whenever inputs change
    recreateButtons(node);
}

function recreateButtons(node) {
    const panelContainer = node.multipreviewState.buttonContainer;
    if (!panelContainer) return;

    // Clear existing buttons
    panelContainer.innerHTML = "";
    node.multipreviewState.buttons = {};

    const imageInputs = getImageInputs(node);
    console.log(`[MultiPreview] Creating buttons for ${imageInputs.length} inputs`);

    imageInputs.forEach((input) => {
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
                console.log(`[MultiPreview] Clicked button ${pinNumber}`);
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

    updateButtonStates(node);
}

function refreshControlPanel(node) {
    recreateButtons(node);
}

function updateButtonStates(node) {
    const imageInputs = getImageInputs(node);
    
    console.log(`[MultiPreview] updateButtonStates: ${imageInputs.length} inputs`);

    imageInputs.forEach((input) => {
        const pinNumber = getImageInputIndex(input.name);
        const button = node.multipreviewState.buttons[pinNumber];
        if (!button) {
            console.warn(`[MultiPreview] Button not found for pin ${pinNumber}`);
            return;
        }

        const hasConnection = input.link !== null && input.link !== undefined;
        const isSelected = node.multipreviewState.selectedPin === pinNumber;

        if (hasConnection) {
            button.element.disabled = false;
            button.element.style.color = "#fff";
            button.element.style.cursor = "pointer";
            button.element.style.background = isSelected ? "#4a90e2" : "#3a3a3a";
            button.element.style.borderColor = isSelected ? "#5a9fef" : "#555";
            console.log(`[MultiPreview] Pin ${pinNumber}: connected and ${isSelected ? 'selected' : 'not selected'}`);
        } else {
            button.element.disabled = true;
            button.element.style.background = "#3a3a3a";
            button.element.style.borderColor = "#555";
            button.element.style.color = "#888";
            button.element.style.cursor = "not-allowed";
            console.log(`[MultiPreview] Pin ${pinNumber}: not connected`);
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
    if (!node.multipreviewState.previewCanvas) {
        return;
    }

    const selectedPin = node.multipreviewState.selectedPin;
    const imageInputName = `image${selectedPin}`;

    // Try to get image from connected node's output
    const imageInput = node.inputs?.find(i => i.name === imageInputName);
    if (!imageInput || !imageInput.link) {
        // No connection for this pin
        const canvas = node.multipreviewState.previewCanvas;
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#1a1a1a";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = "#666";
        ctx.font = "14px Arial";
        ctx.textAlign = "center";
        ctx.fillText("No image connected", canvas.width / 2, canvas.height / 2);
        return;
    }

    // Get the link info
    const graph = node.graph;
    if (!graph) return;

    const link = graph.links[imageInput.link];
    if (!link) return;

    // Get the source node
    const sourceNodeId = link.origin_id;
    const sourceSlot = link.origin_slot;
    const sourceNode = graph.getNodeById(sourceNodeId);

    if (!sourceNode) return;

    // Try to get image data from source node
    if (sourceNode.imgs && sourceNode.imgs.length > 0) {
        // Source is a preview or similar node
        const img = new Image();
        img.onload = () => {
            const canvas = node.multipreviewState.previewCanvas;
            canvas.width = img.width;
            canvas.height = img.height;
            const ctx = canvas.getContext("2d");
            ctx.drawImage(img, 0, 0);
        };
        img.onerror = () => {
            console.error("[MultiPreview] Failed to load image");
        };
        // Set image source based on ComfyUI's image URL pattern
        const filename = sourceNode.imgs[0];
        img.src = `/view?filename=${encodeURIComponent(filename)}&type=output`;
    } else if (sourceNode._outputImages && sourceNode._outputImages.length > 0) {
        // Alternative: try to get image data directly
        const imageData = sourceNode._outputImages[0];
        if (imageData && imageData.data) {
            const canvas = node.multipreviewState.previewCanvas;
            canvas.width = imageData.width || 512;
            canvas.height = imageData.height || 512;
            const ctx = canvas.getContext("2d");
            const imgData = ctx.createImageData(canvas.width, canvas.height);
            imgData.data.set(new Uint8ClampedArray(imageData.data));
            ctx.putImageData(imgData, 0, 0);
        }
    } else {
        // No image data found
        const canvas = node.multipreviewState.previewCanvas;
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#1a1a1a";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = "#666";
        ctx.font = "14px Arial";
        ctx.textAlign = "center";
        ctx.fillText("Image data not available", canvas.width / 2, canvas.height / 2);
    }
}
