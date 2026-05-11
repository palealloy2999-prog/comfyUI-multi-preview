WEB_DIRECTORY = "./web"
 
from .py.multi_preview import MultiPreviewNode
 
NODE_CLASS_MAPPINGS = {
    "MultiPreview": MultiPreviewNode,
}
 
NODE_DISPLAY_NAME_MAPPINGS = {
    "MultiPreview": "Multi Preview",
}
 
__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS"]
 