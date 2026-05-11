"""
MultiPreviewNode - Display multiple images with dynamic pin count
Supports flexible optional image inputs for preview-only display.
"""


class FlexibleOptionalImageType(dict):
    """
    Special type for flexible optional inputs.
    Allows ComfyUI to dynamically accept image inputs.
    """
    
    def __init__(self):
        super().__init__()
        self.type = "IMAGE"
    
    def __getitem__(self, key):
        # Always return IMAGE type for any key
        return (self.type,)
    
    def __contains__(self, key):
        # Always return True for any key
        return True


class MultiPreviewNode:
    """
    A preview-only node that displays a single image from multiple inputs.
    Users can switch between connected images using UI buttons.
    Dynamically grows input pins as needed.
    """
    
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image1": ("IMAGE",),
            },
            "optional": FlexibleOptionalImageType(),
        }
    
    RETURN_TYPES = ()
    RETURN_NAMES = ()
    FUNCTION = "preview_images"
    CATEGORY = "image"
    OUTPUT_NODE = True
    
    def preview_images(self, image1, **kwargs):
        """
        Preview images. This is a display-only node.
        Actual image display is handled by the JS UI extension.
        """
        return None

