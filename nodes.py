import json
from nodes import PreviewImage


MAX_PINS = 32


class MultiPreview(PreviewImage):
    """MultiPreview v25 phase5 visible receiver test.

    Parent node:
    - Keeps the existing dynamic-pin preview behavior.
    - Can also receive per-pin images from visible MultiPreviewReceiver nodes.
    - Empty execution is allowed so the parent can exist as UI-only during receiver tests.
    """

    @classmethod
    def INPUT_TYPES(cls):
        optional = {}
        for index in range(1, MAX_PINS + 1):
            optional[f"image{index}"] = ("IMAGE",)

        return {
            "optional": optional,
            "hidden": {
                "prompt": "PROMPT",
                "extra_pnginfo": "EXTRA_PNGINFO",
            },
        }

    RETURN_TYPES = ()
    FUNCTION = "preview"
    OUTPUT_NODE = True
    CATEGORY = "image"
    DESCRIPTION = "MultiPreview parent. Can preview normal inputs or receive images from visible receivers."

    def _save_pin_images(self, images, pin_index, prompt=None, extra_pnginfo=None):
        if images is None:
            return []

        result = self.save_images(
            images,
            filename_prefix=f"MultiPreview_pin{pin_index}",
            prompt=prompt,
            extra_pnginfo=extra_pnginfo,
        )
        return result.get("ui", {}).get("images", [])

    def preview(self, prompt=None, extra_pnginfo=None, **kwargs):
        pin_images = {}

        for index in range(1, MAX_PINS + 1):
            key = f"image{index}"
            images = kwargs.get(key, None)
            saved_images = self._save_pin_images(images, index, prompt, extra_pnginfo)
            if saved_images:
                pin_images[str(index)] = saved_images

        # In receiver-test mode the parent may have no IMAGE inputs.
        # Return a no-op UI payload instead of throwing.
        if not pin_images:
            return {"ui": {"mp_noop": ["1"], "mp_version": ["v25-phase5-visible-receiver-test"]}}

        return {
            "ui": {
                "mp_images": [pin_images],
                "mp_images_json": [json.dumps(pin_images)],
                "mp_version": ["v25-phase5-visible-receiver-test"],
            }
        }


class MultiPreviewReceiver(PreviewImage):
    """Visible receiver node for testing immediate per-pin updates."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("IMAGE",),
                "parent_id": ("INT", {"default": 0, "min": 0, "max": 999999999, "step": 1}),
                "pin": ("INT", {"default": 1, "min": 1, "max": MAX_PINS, "step": 1}),
            },
            "hidden": {
                "prompt": "PROMPT",
                "extra_pnginfo": "EXTRA_PNGINFO",
            },
        }

    RETURN_TYPES = ()
    FUNCTION = "receive"
    OUTPUT_NODE = True
    CATEGORY = "image"
    DESCRIPTION = "Visible receiver for MultiPreview immediate per-pin update tests."

    def receive(self, image, parent_id=0, pin=1, prompt=None, extra_pnginfo=None):
        result = self.save_images(
            image,
            filename_prefix=f"MultiPreviewReceiver_parent{parent_id}_pin{pin}",
            prompt=prompt,
            extra_pnginfo=extra_pnginfo,
        )
        images = result.get("ui", {}).get("images", [])

        payload = {
            "parent_id": int(parent_id),
            "pin": int(pin),
            "images": images,
        }

        return {
            "ui": {
                "mp_receiver": [payload],
                "mp_receiver_json": [json.dumps(payload)],
                "mp_version": ["v25-phase5-visible-receiver-test"],
            }
        }


NODE_CLASS_MAPPINGS = {
    "MultiPreview": MultiPreview,
    "MultiPreviewReceiver": MultiPreviewReceiver,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "MultiPreview": "MultiPreview",
    "MultiPreviewReceiver": "MultiPreviewReceiver",
}
