import json
from nodes import PreviewImage


MAX_PINS = 32


class MultiPreview(PreviewImage):
    """MultiPreview v25 phase3 dynamic pins.

    - Node name/display name: MultiPreview
    - Inherits ComfyUI core PreviewImage
    - Frontend shows dynamic imageN pins/buttons
    - Backend exposes image1..image{MAX_PINS} so dynamically added pins can execute
    - Uses PreviewImage.save_images()
    - Does not return ui.images; frontend follows the working v25-phase3 JS base
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
    DESCRIPTION = "PreviewImage-compatible dynamic multi-pin preview node. v25 phase3."

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
            raise ValueError("MultiPreview requires at least one connected IMAGE input.")

        return {
            "ui": {
                "mp_images": [pin_images],
                "mp_images_json": [json.dumps(pin_images)],
                "mp_version": ["v25-phase3-dynamic-pins"],
            }
        }


NODE_CLASS_MAPPINGS = {
    "MultiPreview": MultiPreview,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "MultiPreview": "MultiPreview",
}
