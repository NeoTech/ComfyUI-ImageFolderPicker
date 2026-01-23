"""
Image Folder Picker Node for ComfyUI
Allows browsing a folder and selecting an image from thumbnails
"""

import os
import hashlib
import torch
import numpy as np
from PIL import Image, ImageOps, ImageSequence
import folder_paths


class ImageFolderPicker:
    """
    A ComfyUI node that displays images from a folder as selectable thumbnails.
    Outputs the selected image and its alpha channel as a mask.
    """
    
    VALID_EXTENSIONS = {'.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.tiff', '.tif'}
    
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "folder": ("STRING", {
                    "default": "",
                    "multiline": False,
                    "placeholder": "Enter full folder path (e.g. C:\\Images)"
                }),
            },
            "optional": {
                "selected_image": ("STRING", {
                    "default": "",
                    "multiline": False,
                }),
            },
            "hidden": {
                "unique_id": "UNIQUE_ID",
            }
        }
    
    RETURN_TYPES = ("IMAGE", "MASK", "STRING", "INT")
    RETURN_NAMES = ("image", "mask", "image_path", "image_count")
    FUNCTION = "load_selected_image"
    CATEGORY = "image"
    DESCRIPTION = "Browse a folder and pick an image from thumbnails. Outputs the selected image and its alpha channel as mask."
    
    def load_selected_image(self, folder, selected_image, unique_id=None):
        """Load the selected image and extract its alpha channel as mask."""
        
        # Count images in folder
        image_count = 0
        if folder and os.path.isdir(folder):
            image_count = len([f for f in os.listdir(folder) 
                             if os.path.splitext(f)[1].lower() in self.VALID_EXTENSIONS])
        
        # Handle no selection
        if not selected_image or not folder:
            # Return empty tensors if no image selected
            empty_image = torch.zeros((1, 64, 64, 3), dtype=torch.float32)
            empty_mask = torch.zeros((1, 64, 64), dtype=torch.float32)
            return (empty_image, empty_mask, "", image_count)
        
        image_path = os.path.join(folder, selected_image)
        
        if not os.path.exists(image_path):
            raise ValueError(f"Image not found: {image_path}")
        
        # Load image using PIL
        img = Image.open(image_path)
        
        # Handle animated images (GIF) - take first frame
        if hasattr(img, 'n_frames') and img.n_frames > 1:
            img = img.convert('RGBA')
        
        # Preserve EXIF orientation
        img = ImageOps.exif_transpose(img)
        
        # Extract mask from alpha channel if present
        if img.mode == 'RGBA':
            # Get alpha channel as mask (inverted: white = masked area)
            alpha = img.split()[3]
            mask = 1.0 - (np.array(alpha).astype(np.float32) / 255.0)
            mask = torch.from_numpy(mask).unsqueeze(0)
        else:
            # No alpha channel - create empty mask
            mask = torch.zeros((1, img.height, img.width), dtype=torch.float32)
        
        # Convert image to RGB
        if img.mode != 'RGB':
            img = img.convert('RGB')
        
        # Convert to tensor [B, H, W, C] format
        image_np = np.array(img).astype(np.float32) / 255.0
        image_tensor = torch.from_numpy(image_np).unsqueeze(0)
        
        return (image_tensor, mask, image_path, image_count)
    
    @classmethod
    def IS_CHANGED(cls, folder="", selected_image="", **kwargs):
        """Return hash of selected image for cache invalidation."""
        if not selected_image or not folder:
            return float("NaN")
        
        image_path = os.path.join(folder, selected_image)
        
        if os.path.exists(image_path):
            # Hash file modification time and size for efficiency
            stat = os.stat(image_path)
            return f"{image_path}_{stat.st_mtime}_{stat.st_size}"
        
        return float("NaN")
    
    @classmethod
    def VALIDATE_INPUTS(cls, folder="", selected_image="", **kwargs):
        """Validate that the selected image exists."""
        if selected_image and folder:
            path = os.path.join(folder, selected_image)
            if not os.path.exists(path):
                return f"Image not found: {path}"
        return True
