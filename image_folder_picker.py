"""
Image Folder Picker Node for ComfyUI
Allows browsing a folder and selecting an image from thumbnails
Supports 3 tabs for loading 3 different images
"""

import os
import hashlib
import torch
import numpy as np
from PIL import Image, ImageOps, ImageSequence
import folder_paths


class ImageFolderPicker:
    """
    A ComfyUI node that displays images from folders as selectable thumbnails.
    Has 3 tabs, each outputting a separate image.
    """
    
    VALID_EXTENSIONS = {'.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.tiff', '.tif'}
    
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "folder1": ("STRING", {
                    "default": "",
                    "multiline": False,
                    "placeholder": "Folder path for Tab 1"
                }),
                "folder2": ("STRING", {
                    "default": "",
                    "multiline": False,
                    "placeholder": "Folder path for Tab 2"
                }),
                "folder3": ("STRING", {
                    "default": "",
                    "multiline": False,
                    "placeholder": "Folder path for Tab 3"
                }),
            },
            "optional": {
                "folder1_input": ("STRING", {"forceInput": True}),
                "folder2_input": ("STRING", {"forceInput": True}),
                "folder3_input": ("STRING", {"forceInput": True}),
                "selected_image1": ("STRING", {"default": ""}),
                "selected_image2": ("STRING", {"default": ""}),
                "selected_image3": ("STRING", {"default": ""}),
            },
            "hidden": {
                "unique_id": "UNIQUE_ID",
            }
        }
    
    RETURN_TYPES = ("IMAGE", "IMAGE", "IMAGE")
    RETURN_NAMES = ("image1", "image2", "image3")
    FUNCTION = "load_selected_images"
    CATEGORY = "image"
    DESCRIPTION = "Browse folders and pick images from thumbnails. Has 3 tabs, each outputting a separate image."
    
    def load_image(self, folder, selected_image):
        """Load a single image and return tensor."""
        if not selected_image or not folder:
            return torch.zeros((1, 64, 64, 3), dtype=torch.float32)
        
        image_path = os.path.join(folder, selected_image)
        
        if not os.path.exists(image_path):
            return torch.zeros((1, 64, 64, 3), dtype=torch.float32)
        
        try:
            img = Image.open(image_path)
            
            if hasattr(img, 'n_frames') and img.n_frames > 1:
                img = img.convert('RGBA')
            
            img = ImageOps.exif_transpose(img)
            
            if img.mode != 'RGB':
                img = img.convert('RGB')
            
            image_np = np.array(img).astype(np.float32) / 255.0
            image_tensor = torch.from_numpy(image_np).unsqueeze(0)
            
            return image_tensor
        except Exception as e:
            print(f"[ImageFolderPicker] Error loading {image_path}: {e}")
            return torch.zeros((1, 64, 64, 3), dtype=torch.float32)
    
    def load_selected_images(self, folder1, folder2, folder3, 
                             folder1_input=None, folder2_input=None, folder3_input=None,
                             selected_image1="", selected_image2="", selected_image3="",
                             unique_id=None):
        """Load all selected images. folder*_input overrides folder* when connected."""
        # Use input connections if provided, otherwise use widget values
        f1 = folder1_input if folder1_input else folder1
        f2 = folder2_input if folder2_input else folder2
        f3 = folder3_input if folder3_input else folder3
        
        image1 = self.load_image(f1, selected_image1)
        image2 = self.load_image(f2, selected_image2)
        image3 = self.load_image(f3, selected_image3)
        
        return (image1, image2, image3)
    
    @classmethod
    def IS_CHANGED(cls, folder1="", folder2="", folder3="",
                   folder1_input=None, folder2_input=None, folder3_input=None,
                   selected_image1="", selected_image2="", selected_image3="", **kwargs):
        """Return hash for cache invalidation."""
        # Use input connections if provided
        f1 = folder1_input if folder1_input else folder1
        f2 = folder2_input if folder2_input else folder2
        f3 = folder3_input if folder3_input else folder3
        
        parts = []
        
        for folder, selected in [(f1, selected_image1), (f2, selected_image2), (f3, selected_image3)]:
            if selected and folder:
                image_path = os.path.join(folder, selected)
                if os.path.exists(image_path):
                    stat = os.stat(image_path)
                    parts.append(f"{image_path}_{stat.st_mtime}_{stat.st_size}")
        
        if parts:
            return "_".join(parts)
        return float("NaN")
    
    @classmethod
    def VALIDATE_INPUTS(cls, folder1="", folder2="", folder3="",
                        folder1_input=None, folder2_input=None, folder3_input=None,
                        selected_image1="", selected_image2="", selected_image3="", **kwargs):
        """Validate inputs - we allow missing images (they return empty tensor)."""
        # Always return True - missing images will just return blank tensors
        # This allows the node to work even if paths are temporarily invalid
        return True
