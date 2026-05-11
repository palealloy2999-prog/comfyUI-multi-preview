"""
MultiPreview custom nodes

Visible node:
- MultiPreview: parent UI node. It owns dynamic image pins and the browser-side preview switcher.

Internal prompt-only node:
- MultiPreviewReceiver: injected into the API prompt by the frontend for each connected pin.
  It is not created as a visible graph node.
"""

import os
import re
import time

import folder_paths
import numpy as np
from PIL import Image


class DynamicImageInputs(dict):
    """Accept image2, image3, ... that are added by the frontend."""

    @staticmethod
    def _is_dynamic_image_key(key):
        if not isinstance(key, str):
            return False
        if not key.startswith("image"):
            return False
        pin = key[5:]
        return pin.isdigit() and int(pin) >= 2

    def __contains__(self, key):
        return self._is_dynamic_image_key(key)

    def __getitem__(self, key):
        if self._is_dynamic_image_key(key):
            return ("IMAGE",)
        raise KeyError(key)

    def get(self, key, default=None):
        if self._is_dynamic_image_key(key):
            return ("IMAGE",)
        return default


class MultiPreviewNode:
    """Parent node. The visible preview UI is handled in JavaScript."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image1": ("IMAGE",),
            },
            "optional": DynamicImageInputs(),
        }

    RETURN_TYPES = ()
    RETURN_NAMES = ()
    FUNCTION = "noop"
    CATEGORY = "image"
    OUTPUT_NODE = True

    def noop(self, image1, **kwargs):
        # Do not return ui.images here. Otherwise ComfyUI shows the standard image grid.
        return {"ui": {}}


class MultiPreviewReceiverNode:
    """
    Prompt-only internal receiver.
    One receiver is injected per connected MultiPreview pin at queue time.
    """

    def __init__(self):
        self.output_dir = folder_paths.get_temp_directory()
        self.type = "temp"
        self.compress_level = 1

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("IMAGE",),
                "parent_id": ("STRING", {"default": ""}),
                "pin": ("INT", {"default": 1, "min": 1, "max": 9999, "step": 1}),
            }
        }

    RETURN_TYPES = ()
    RETURN_NAMES = ()
    FUNCTION = "receive"
    CATEGORY = "_internal/MultiPreview"
    OUTPUT_NODE = True

    @staticmethod
    def _safe_filename_part(value):
        text = str(value)
        return re.sub(r"[^0-9A-Za-z_-]", "_", text)

    def receive(self, image, parent_id, pin):
        img_np = np.clip(image[0].cpu().numpy(), 0, 1)
        img_np = (img_np * 255).astype(np.uint8)
        pil_img = Image.fromarray(img_np)

        timestamp = int(time.time() * 1000)
        safe_parent = self._safe_filename_part(parent_id)
        safe_pin = self._safe_filename_part(pin)
        filename = f"multipreview_{safe_parent}_{safe_pin}_{timestamp}.png"
        filepath = os.path.join(self.output_dir, filename)
        pil_img.save(filepath, compress_level=self.compress_level)

        return {
            "ui": {
                "mp_receiver": [
                    {
                        "parent_id": str(parent_id),
                        "pin": int(pin),
                        "filename": filename,
                        "subfolder": "",
                        "type": self.type,
                    }
                ]
            }
        }
