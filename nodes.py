import json
from nodes import PreviewImage


class MultiPreview(PreviewImage):
    """MultiPreview v25 phase2-fix8-fix3-base.

    Phase 2 scope:
    - keep the fixed node name/display name: MultiPreview
    - inherit ComfyUI core PreviewImage
    - support two IMAGE inputs: image1, image2
    - save each connected pin through PreviewImage.save_images()
    - draw/switch previews on the frontend canvas using pin-specific metadata

    Important fix3 note:
    ComfyUI aggregates every value under the returned `ui` dict by calling
    `extend()`. Therefore custom scalar/object UI payloads must be wrapped in
    a list. Returning a raw dict/string makes the frontend receive keys or
    characters instead of the intended payload.
    """

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "optional": {
                "image1": ("IMAGE",),
                "image2": ("IMAGE",),
            },
            "hidden": {
                "prompt": "PROMPT",
                "extra_pnginfo": "EXTRA_PNGINFO",
            },
        }

    RETURN_TYPES = ()
    FUNCTION = "preview"
    OUTPUT_NODE = True
    CATEGORY = "image"
    DESCRIPTION = "PreviewImage-based multi-pin preview node. v25 phase2-fix8-fix3-base: image1/image2 + button switching."

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

    def preview(self, image1=None, image2=None, prompt=None, extra_pnginfo=None):
        if image1 is None and image2 is None:
            raise ValueError("MultiPreview requires at least one connected IMAGE input.")

        pin_images = {
            "1": self._save_pin_images(image1, 1, prompt, extra_pnginfo),
            "2": self._save_pin_images(image2, 2, prompt, extra_pnginfo),
        }

        # NOTE:
        # Do not return standard `images` here. If ui.images is returned,
        # ComfyUI's built-in preview renderer and MultiPreview's switchable
        # canvas can both draw, causing duplicate previews.
        #
        # Non-standard UI payloads are wrapped in lists because ComfyUI merges
        # UI values with list.extend().
        return {
            "ui": {
                "mp_images": [pin_images],
                "mp_images_json": [json.dumps(pin_images)],
                "mp_version": ["v25-phase2-fix8-fix3-base"],
            }
        }


NODE_CLASS_MAPPINGS = {
    "MultiPreview": MultiPreview,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "MultiPreview": "MultiPreview",
}
