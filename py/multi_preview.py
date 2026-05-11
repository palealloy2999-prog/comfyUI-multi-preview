"""
MultiPreviewNode - Display multiple images with truly dynamic pins

ComfyUI の PreviewImage と同じパターンで画像を一時保存し、
JS 側に { images: [...] } 形式で返す。
"""

import numpy as np
from PIL import Image
import folder_paths
import os
import time


class MultiPreviewNode:
    """
    複数の画像入力を受け取り、ボタンで切り替えて1枚ずつプレビューするノード。
    入力ピンは JS 側で動的に追加される（Python 定義は image1 のみ）。
    """

    def __init__(self):
        self.output_dir = folder_paths.get_temp_directory()
        self.type = "temp"
        self.prefix_append = "_multipreview"
        self.compress_level = 1

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image1": ("IMAGE",),
            },
            "optional": {},
        }

    RETURN_TYPES = ()
    RETURN_NAMES = ()
    FUNCTION = "preview_images"
    CATEGORY = "image"
    OUTPUT_NODE = True

    def preview_images(self, image1, **kwargs):
        """
        受け取った全画像を一時ディレクトリに保存し、
        { images: [ {filename, subfolder, type}, ... ] } を返す。
        JS の onExecuted(output) で output.images として受け取れる。
        リストの順番が image1, image2, ... に対応する。
        """
        # image1 と kwargs の image2, image3, ... をまとめる
        all_images = [image1]
        index = 2
        while f"image{index}" in kwargs:
            all_images.append(kwargs[f"image{index}"])
            index += 1

        saved = []
        for i, image_tensor in enumerate(all_images):
            # テンソル → PIL Image
            # image_tensor shape: [B, H, W, C], float 0-1
            img_np = (image_tensor[0].cpu().numpy() * 255).astype(np.uint8)
            pil_img = Image.fromarray(img_np)

            # ファイル名にタイムスタンプとインデックスを含める
            ts = int(time.time() * 1000)
            filename = f"multipreview_{ts}_{i+1}.png"
            filepath = os.path.join(self.output_dir, filename)
            pil_img.save(filepath, compress_level=self.compress_level)

            saved.append({
                "filename": filename,
                "subfolder": "",
                "type": self.type,
            })

        return {"ui": {"images": saved}}
