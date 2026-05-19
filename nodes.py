import json
import logging
from server import PromptServer
from nodes import PreviewImage


VERSION = "v1.2.16"

# Keep this value in sync with MAX_PINS in web/multiPreview.js.
MAX_PINS = 32

logger = logging.getLogger(__name__)


class MultiPreview(PreviewImage):
    """MultiPreview v1.2.16.

    Parent node with dynamic image pins. During queueing, imageN dependencies
    are replaced by injected MultiPreviewInternalReceiver nodes on the frontend.
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
    DESCRIPTION = "MultiPreview parent with internal per-pin receiver injection."

    def _save_pin_images(self, images, pin_index, prompt=None, extra_pnginfo=None):
        if images is None:
            return []

        try:
            result = self.save_images(
                images,
                filename_prefix=f"MultiPreview_pin{pin_index}",
                prompt=prompt,
                extra_pnginfo=extra_pnginfo,
            )
        except Exception:
            logger.exception("MultiPreview failed to save images for pin %s", pin_index)
            raise

        return result.get("ui", {}).get("images", [])

    def preview(self, prompt=None, extra_pnginfo=None, **kwargs):
        pin_images = {}

        image_items = sorted(
            (
                (int(key[5:]), images)
                for key, images in kwargs.items()
                if key.startswith("image") and key[5:].isdigit() and images is not None
            ),
            key=lambda item: item[0],
        )

        for index, images in image_items:
            saved_images = self._save_pin_images(images, index, prompt, extra_pnginfo)
            if saved_images:
                pin_images[str(index)] = saved_images

        if not pin_images:
            raise RuntimeError("Required input is missing: images")

        # Return both object and JSON payloads for frontend compatibility across
        # ComfyUI frontend serialization paths.
        return {
            "ui": {
                "mp_images": [pin_images],
                "mp_images_json": [json.dumps(pin_images)],
                "mp_version": [VERSION],
            }
        }




class MultiPreviewAuto(MultiPreview):
    """Auto-updating MultiPreview without buttons or manual pin switching.

    It uses the same dynamic image pins and internal receiver mechanism as
    MultiPreview, but the frontend always displays the most recently updated
    pin and does not create pin buttons.
    """

    DESCRIPTION = "Auto-updating MultiPreview without pin buttons."


class MultiPreviewInternalReceiver(PreviewImage):
    """Internal receiver injected into the execution prompt by JS.

    This node is not meant to be placed manually.
    """

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
        try:
            parent_id = int(parent_id)
            pin = int(pin)
        except (TypeError, ValueError):
            logger.exception("MultiPreviewInternalReceiver received invalid parent_id or pin")
            raise

        try:
            result = self.save_images(
                image,
                filename_prefix=f"MultiPreviewInternalReceiver_parent{parent_id}_pin{pin}",
                prompt=prompt,
                extra_pnginfo=extra_pnginfo,
            )
        except Exception:
            logger.exception(
                "MultiPreviewInternalReceiver failed to save images for parent=%s pin=%s",
                parent_id,
                pin,
            )
            raise

        images = result.get("ui", {}).get("images", [])

        payload = {
            "parent_id": parent_id,
            "pin": pin,
            "images": images,
        }

        PromptServer.instance.send_sync("multi_preview_receiver", payload)

        # Return both object and JSON payloads for frontend compatibility across
        # ComfyUI frontend serialization paths.
        return {
            "ui": {
                "mp_receiver": [payload],
                "mp_receiver_json": [json.dumps(payload)],
                "mp_version": [VERSION],
            }
        }


NODE_CLASS_MAPPINGS = {
    "MultiPreview": MultiPreview,
    "MultiPreviewAuto": MultiPreviewAuto,
    "MultiPreviewInternalReceiver": MultiPreviewInternalReceiver,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "MultiPreview": "MultiPreview",
    "MultiPreviewAuto": "MultiPreview Auto",
    "MultiPreviewInternalReceiver": "MultiPreviewInternalReceiver",
}
