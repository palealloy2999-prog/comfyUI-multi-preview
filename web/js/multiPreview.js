/**
 * Multi Preview Node JavaScript Extension
 * Provides UI enhancements for the MultiPreview node with pin-aligned buttons
 */

import { app } from "../../scripts/app.js";

app.registerExtension({
    name: "comfyui.multipreview",
    async setup() {
        // Setup complete
    },
    
    async addCustomNodeDefs(defs, app) {
        // Register custom node definitions
    },
    
    async loadedGraphNode(node, app) {
        if (node.type === "MultiPreview") {
            // Initialize button state tracker
            if (!node.multipreviewState) {
                node.multipreviewState = {
                    buttons: {},
                    selectedPin: null,
                    lastInputCount: 0,
                };
            }
            
            // Create initial control panel
            createControlPanel(node);
            
            // Monitor for connection changes
            const originalOnConnectionsChange = node.onConnectionsChange;
            node.onConnectionsChange = function() {
                if (originalOnConnectionsChange) {
                    originalOnConnectionsChange.call(this);
                }
                // Rebuild panel if input count changed
                setTimeout(() => {
                    if (node.inputs && node.inputs.length !== node.multipreviewState.lastInputCount) {
                        node.multipreviewState.lastInputCount = node.inputs.length;
                        // Remove old panel
                        const oldPanel = document.getElementById(`multipreview-panel-${node.id}`);
                        if (oldPanel) oldPanel.remove();
                        node.multipreviewPanel = null;
                        // Create new panel
                        createControlPanel(node);
                    }
                    monitorInputs(node);
                }, 50);
            };
            
            // Monitor input connections
            monitorInputs(node);
            
            // Update button states when node updates
            const originalOnExecuted = node.onExecuted;
            node.onExecuted = function(message) {
                if (originalOnExecuted) {
                    originalOnExecuted.call(this, message);
                }
                updateButtonStates(node);
            };
        }
    }
});

/**
 * Create the control panel with numbered buttons based on input count
 */
function createControlPanel(node) {
    // Get number of inputs
    const inputs = node.inputs || [];
    if (inputs.length === 0) return; // No inputs, don't create panel
    
    // Create container div
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
    
    // Initialize buttons object if needed
    node.multipreviewState.buttons = {};
    
    // Create buttons for each input pin
    inputs.forEach((input, index) => {
        const pinNumber = index + 1;
        const pinLabel = input.name || `pin_${index}`;
        
        const button = document.createElement("button");
        button.id = `multipreview-btn-${node.id}-${pinNumber}`;
        button.textContent = pinNumber.toString();
        button.dataset.pinNumber = pinNumber;
        button.dataset.pinLabel = pinLabel;
        
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
        
        // Disable by default
        button.disabled = true;
        
        button.addEventListener("click", (e) => {
            e.preventDefault();
            if (!button.disabled) {
                selectPin(node, pinNumber);
            }
        });
        
        // Hover effect for enabled buttons
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
            enabled: false,
            active: false,
            label: pinLabel,
        };
        
        container.appendChild(button);
    });
    
    // Add the panel to the node
    if (!node.multipreviewPanel) {
        node.multipreviewPanel = container;
        if (node.onDrawBackground) {
            const originalOnDrawBackground = node.onDrawBackground;
            node.onDrawBackground = function(ctx) {
                originalOnDrawBackground.call(this, ctx);
            };
        }
    }
}

/**
 * Monitor input connections and update button states
 */
function monitorInputs(node) {
    // Check for existing input monitors
    const checkInputs = () => {
        const inputs = node.inputs || [];
        
        inputs.forEach((input, index) => {
            const pinNumber = index + 1;
            const hasInput = input.link !== null && input.link !== undefined;
            
            // Update button state
            const buttonState = node.multipreviewState.buttons[pinNumber];
            if (buttonState) {
                updateButtonState(node, pinNumber, hasInput);
            }
        });
    };
    
    // Check inputs initially
    checkInputs();
}

/**
 * Update individual button state
 */
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
        
        if (isActive) {
            button.style.background = "#4a90e2";
            button.style.borderColor = "#5a9fef";
        } else {
            button.style.background = "#3a3a3a";
            button.style.borderColor = "#555";
        }
    } else {
        button.disabled = true;
        button.style.background = "#3a3a3a";
        button.style.borderColor = "#555";
        button.style.color = "#888";
        button.style.cursor = "not-allowed";
    }
}

/**
 * Handle pin selection
 */
function selectPin(node, pinNumber) {
    const previousSelected = node.multipreviewState.selectedPin;
    node.multipreviewState.selectedPin = pinNumber;
    
    // Update all button states
    Object.entries(node.multipreviewState.buttons).forEach(([num, buttonState]) => {
        if (buttonState && buttonState.enabled) {
            if (parseInt(num) === pinNumber) {
                buttonState.element.style.background = "#4a90e2";
                buttonState.element.style.borderColor = "#5a9fef";
            } else {
                buttonState.element.style.background = "#3a3a3a";
                buttonState.element.style.borderColor = "#555";
            }
        }
    });
    
    // Trigger any custom behavior if needed
    if (node.onPinSelected) {
        node.onPinSelected(pinNumber);
    }
}

/**
 * Update all button states
 */
function updateButtonStates(node) {
    if (!node.multipreviewState) return;
    
    const inputs = node.inputs || [];
    
    inputs.forEach((input, index) => {
        const pinNumber = index + 1;
        const hasInput = input.link !== null && input.link !== undefined;
        
        updateButtonState(node, pinNumber, hasInput);
    });
}
