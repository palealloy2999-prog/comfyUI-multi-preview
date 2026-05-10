/**
 * Multi Preview Node JavaScript Extension
 * Provides UI enhancements for the MultiPreview node
 */

import { app } from "../../scripts/app.js";

app.registerExtension({
    name: "comfyui.multipreview",
    async setup() {
        // Add custom node implementation if needed
    },
    
    async addCustomNodeDefs(defs, app) {
        // Register custom node definitions
    },
    
    async loadedGraphNode(node, app) {
        if (node.type === "MultiPreview") {
            // Add custom rendering or behavior for MultiPreview nodes
            node.onDrawForeground = function(ctx) {
                if (this.flags.collapsed) return;
                // Draw custom preview if needed
            };
        }
    }
});
