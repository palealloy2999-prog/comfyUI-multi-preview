"""
MultiPreviewNode - Display multiple images with dynamic pin count
Supports flexible optional image inputs for preview-only display.
"""


class MultiPreviewNode:
    """
    A preview-only node that displays a single image from multiple inputs.
    Users can switch between connected images using UI buttons.
    Dynamically grows input pins as needed.
    """
    
    @classmethod
    def INPUT_TYPES(cls):
        # Define base inputs - image1 is required
        # image2-20 are optional and can be extended by JS at runtime
        inputs = {
            "required": {
                "image1": ("IMAGE",),
            },
            "optional": {
                f"image{i}": ("IMAGE",) for i in range(2, 21)
            },
        }
        return inputs
    
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

