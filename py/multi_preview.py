"""
MultiPreviewNode - Display multiple images with a grid preview interface
"""


class MultiPreviewNode:
    """
    A node that displays multiple preview images in a grid layout.
    This is a preview-only node that accepts multiple image inputs
    and displays them with a control panel in the UI.
    """
    
    def __init__(self):
        pass
    
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image1": ("IMAGE",),
            },
            "optional": {
                "image2": ("IMAGE",),
                "image3": ("IMAGE",),
                "image4": ("IMAGE",),
                "image5": ("IMAGE",),
                "image6": ("IMAGE",),
                "image7": ("IMAGE",),
                "image8": ("IMAGE",),
            },
        }
    
    RETURN_TYPES = ()
    RETURN_NAMES = ()
    FUNCTION = "preview_images"
    CATEGORY = "image"
    OUTPUT_NODE = True
    
    def preview_images(self, image1, **kwargs):
        """
        Preview multiple images. This function does not return anything
        as it is a preview-only node. Image display is handled by the UI extension.
        """
        return None
