"""
MultiPreviewNode - Display multiple images in a grid preview
"""

import numpy as np
from PIL import Image
import io


class MultiPreviewNode:
    """
    A node that displays multiple preview images in a grid layout
    """
    
    def __init__(self):
        self.outputs = ["IMAGE"]
        self.output_node = True
    
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
                "image9": ("IMAGE",),
                "columns": ("INT", {"default": 3, "min": 1, "max": 9}),
            }
        }
    
    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("image",)
    FUNCTION = "preview_images"
    CATEGORY = "image"
    OUTPUT_NODE = True
    
    def preview_images(self, image1, image2=None, image3=None, image4=None, 
                      image5=None, image6=None, image7=None, image8=None, 
                      image9=None, columns=3):
        """
        Combine and display multiple preview images
        """
        images = []
        
        # Collect all images that were provided
        for img in [image1, image2, image3, image4, image5, image6, image7, image8, image9]:
            if img is not None:
                images.append(img)
        
        if not images:
            raise ValueError("At least image1 must be provided")
        
        # Convert tensors to PIL images if needed
        pil_images = []
        for img_tensor in images:
            if isinstance(img_tensor, np.ndarray):
                # Assuming tensor is in range [0, 1] with shape (H, W, C)
                if img_tensor.dtype == np.float32 or img_tensor.dtype == np.float64:
                    img_array = (img_tensor * 255).astype(np.uint8)
                else:
                    img_array = img_tensor.astype(np.uint8)
                
                # Handle different channel configurations
                if len(img_array.shape) == 3:
                    if img_array.shape[2] == 4:
                        pil_img = Image.fromarray(img_array, mode='RGBA')
                    elif img_array.shape[2] == 3:
                        pil_img = Image.fromarray(img_array, mode='RGB')
                    elif img_array.shape[2] == 1:
                        pil_img = Image.fromarray(img_array[:, :, 0], mode='L')
                    else:
                        pil_img = Image.fromarray(img_array)
                else:
                    pil_img = Image.fromarray(img_array)
            else:
                pil_img = img_tensor
            
            pil_images.append(pil_img)
        
        # Get dimensions of first image
        first_width, first_height = pil_images[0].size
        
        # Calculate grid dimensions
        num_images = len(pil_images)
        rows = (num_images + columns - 1) // columns
        
        # Create canvas for grid
        canvas_width = first_width * columns
        canvas_height = first_height * rows
        
        # Create blank canvas
        canvas = Image.new('RGB', (canvas_width, canvas_height), color='black')
        
        # Paste images into grid
        for idx, pil_img in enumerate(pil_images):
            # Resize if needed to match first image
            if pil_img.size != (first_width, first_height):
                pil_img = pil_img.resize((first_width, first_height), Image.LANCZOS)
            
            # Convert to RGB if necessary
            if pil_img.mode != 'RGB':
                if pil_img.mode == 'RGBA':
                    rgb_img = Image.new('RGB', pil_img.size, (0, 0, 0))
                    rgb_img.paste(pil_img, mask=pil_img.split()[3])
                    pil_img = rgb_img
                else:
                    pil_img = pil_img.convert('RGB')
            
            row = idx // columns
            col = idx % columns
            x = col * first_width
            y = row * first_height
            canvas.paste(pil_img, (x, y))
        
        # Convert back to tensor
        canvas_array = np.array(canvas).astype(np.float32) / 255.0
        canvas_tensor = canvas_array[np.newaxis, ...]
        
        return (canvas_tensor,)
