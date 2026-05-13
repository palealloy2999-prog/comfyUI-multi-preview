WEB_DIRECTORY = "./web/js"

from .py.multi_preview import MultiPreviewNode, MultiPreviewReceiverNode

NODE_CLASS_MAPPINGS = {
    "MultiPreview": MultiPreviewNode,
    "MultiPreviewReceiver": MultiPreviewReceiverNode,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "MultiPreview": "MultiPreview",
    "MultiPreviewReceiver": "__internal__ MultiPreview Receiver",
}

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS"]
