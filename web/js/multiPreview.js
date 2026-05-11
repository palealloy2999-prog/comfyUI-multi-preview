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

        // Initialize node state
        if (!node.multipreviewState) {
            node.multipreviewState = {
                buttons: {},
                selectedPin: 1,
                imageCount: 0,
            };
        }

        // Create control panel container
        const panelContainer = document.createElement("div");
        panelContainer.id = `multipreview-panel-${node.id}`;
        panelContainer.style.cssText = `
            display: flex;
            gap: 5px;
            padding: 8px;
            background: #2a2a2a;
            border-radius: 4px;
            margin-top: 8px;
            flex-wrap: wrap;
            align-items: center;
        `;

        // Count image inputs (image1 through image8 from INPUT_TYPES)
        const maxImages = 8;
        for (let i = 1; i <= maxImages; i++) {
            const inputName = `image${i}`;
            const button = document.createElement("button");
            button.id = `multipreview-btn-${node.id}-${i}`;
            button.textContent = i.toString();
            button.dataset.imageIndex = i;
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
                    node.multipreviewState.selectedPin = i;
                    updateAllButtonStates(node);
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
                    if (node.multipreviewState.selectedPin === i) {
                        button.style.background = "#4a90e2";
                        button.style.borderColor = "#5a9fef";
                    } else {
                        button.style.background = "#3a3a3a";
                        button.style.borderColor = "#555";
                    }
                }
            });

            node.multipreviewState.buttons[i] = {
                element: button,
                enabled: false,
            };
            panelContainer.appendChild(button);
        }

        // Add panel as DOM widget
        const widget = node.addDOMWidget("preview_panel", "multi_preview_panel", panelContainer, {
            serialize: false,
            hideOnZoom: false,
        });

        // Override onConnectionsChange to track which inputs have connections
        const originalOnConnectionsChange = node.onConnectionsChange;
        node.onConnectionsChange = function(type, slotIndex, connected, link_info, ioSlot) {
            if (originalOnConnectionsChange) {
                originalOnConnectionsChange.call(this, type, slotIndex, connected, link_info, ioSlot);
            }
            
            // Update button states based on connections
            updateButtonStates(this);
        };

        // Handle node execution - button state updates
        const originalOnExecuted = node.onExecuted;
        node.onExecuted = function(message) {
            if (originalOnExecuted) {
                originalOnExecuted.call(this, message);
            }
            
            // Update button availability based on which inputs are connected
            updateButtonStates(this);
        };

        // Initial button state update
        updateButtonStates(node);
    }
});

function updateButtonStates(node) {
    let connectedCount = 0;
    
    // Check which image inputs have connections
    for (let i = 1; i <= 8; i++) {
        const inputSlot = node.inputs?.find(inp => inp.name === `image${i}`);
        const hasConnection = inputSlot && (inputSlot.link !== null && inputSlot.link !== undefined);
        
        const button = node.multipreviewState.buttons[i];
        if (!button) continue;
        
        if (hasConnection) {
            connectedCount++;
            button.element.disabled = false;
            button.element.style.color = "#fff";
            button.element.style.cursor = "pointer";
            
            if (node.multipreviewState.selectedPin === i) {
                button.element.style.background = "#4a90e2";
                button.element.style.borderColor = "#5a9fef";
            } else {
                button.element.style.background = "#3a3a3a";
                button.element.style.borderColor = "#555";
            }
        } else {
            button.element.disabled = true;
            button.element.style.background = "#3a3a3a";
            button.element.style.borderColor = "#555";
            button.element.style.color = "#888";
            button.element.style.cursor = "not-allowed";
        }
    }
    
    node.multipreviewState.imageCount = connectedCount;
}
