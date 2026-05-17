from server import PromptServer

import json
from nodes import PreviewImage


MAX_PINS = 32


class MultiPreview(PreviewImage):
    """MultiPreview v25 phase8 custom event fix1 fix2."""

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
    DESCRIPTION = "MultiPreview parent. Queue prompt is patched to inject internal per-pin receivers."

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

        if not pin_images:
            return {"ui": {"mp_noop": ["1"], "mp_version": ["v25-phase8-custom-event-fix1"]}}

        return {
            "ui": {
                "mp_images": [pin_images],
                "mp_images_json": [json.dumps(pin_images)],
                "mp_version": ["v25-phase8-custom-event-fix1"],
            }
        }


class MultiPreviewReceiver(PreviewImage):
    """Visible receiver fallback."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("IMAGE",),
            },
            "hidden": {
                "prompt": "PROMPT",
                "extra_pnginfo": "EXTRA_PNGINFO",
                "unique_id": "UNIQUE_ID",
            },
        }

    RETURN_TYPES = ()
    FUNCTION = "receive"
    OUTPUT_NODE = True
    CATEGORY = "image"
    DESCRIPTION = "Visible receiver fallback for MultiPreview."

    def receive(self, image, prompt=None, extra_pnginfo=None, unique_id=None):
        receiver_id = int(unique_id) if unique_id is not None else 0

        result = self.save_images(
            image,
            filename_prefix=f"MultiPreviewReceiver_{receiver_id}",
            prompt=prompt,
            extra_pnginfo=extra_pnginfo,
        )
        images = result.get("ui", {}).get("images", [])

        payload = {
            "receiver_id": receiver_id,
            "images": images,
        }

        return {
            "ui": {
                "mp_receiver": [payload],
                "mp_receiver_json": [json.dumps(payload)],
                "mp_version": ["v25-phase8-custom-event-fix1"],
            }
        }


class MultiPreviewInternalReceiver(PreviewImage):
    """Internal receiver injected into the execution prompt by JS."""

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
    DESCRIPTION = "Internal receiver injected by MultiPreview JS."

    def receive(self, image, parent_id=0, pin=1, prompt=None, extra_pnginfo=None):
        parent_id = int(parent_id)
        pin = int(pin)

        result = self.save_images(
            image,
            filename_prefix=f"MultiPreviewInternalReceiver_parent{parent_id}_pin{pin}",
            prompt=prompt,
            extra_pnginfo=extra_pnginfo,
        )
        images = result.get("ui", {}).get("images", [])

        payload = {
            "parent_id": parent_id,
            "pin": pin,
            "images": images,
        }

        # Notify frontend immediately when this internal receiver has saved
        # the preview image. This is the primary update path.
        PromptServer.instance.send_sync("multi_preview_receiver", payload)
        print(f"[MultiPreview] custom event sent parent={parent_id} pin={pin} images={len(images)}")

        return {
            "ui": {
                "mp_receiver": [payload],
                "mp_receiver_json": [json.dumps(payload)],
                "mp_version": ["v25-phase8-custom-event-fix1"],
            }
        }


NODE_CLASS_MAPPINGS = {
    "MultiPreview": MultiPreview,
    "MultiPreviewReceiver": MultiPreviewReceiver,
    "MultiPreviewInternalReceiver": MultiPreviewInternalReceiver,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "MultiPreview": "MultiPreview",
    "MultiPreviewReceiver": "MultiPreviewReceiver",
    "MultiPreviewInternalReceiver": "MultiPreviewInternalReceiver",
}
