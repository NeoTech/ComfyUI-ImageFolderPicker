"""
Image Folder Picker Node for ComfyUI
Allows browsing a folder and selecting an image from thumbnails
Supports 5 tabs for loading 5 different images
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
    Has 5 tabs, each outputting a separate image.
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
                "folder4": ("STRING", {
                    "default": "",
                    "multiline": False,
                    "placeholder": "Folder path for Tab 4"
                }),
                "folder5": ("STRING", {
                    "default": "",
                    "multiline": False,
                    "placeholder": "Folder path for Tab 5"
                }),
            },
            "optional": {
                "folder1_input": ("STRING", {"forceInput": True}),
                "folder2_input": ("STRING", {"forceInput": True}),
                "folder3_input": ("STRING", {"forceInput": True}),
                "folder4_input": ("STRING", {"forceInput": True}),
                "folder5_input": ("STRING", {"forceInput": True}),
                "selected_image1": ("STRING", {"default": ""}),
                "selected_image2": ("STRING", {"default": ""}),
                "selected_image3": ("STRING", {"default": ""}),
                "selected_image4": ("STRING", {"default": ""}),
                "selected_image5": ("STRING", {"default": ""}),
                "folderOverride1": ("STRING", {"default": ""}),
                "folderOverride2": ("STRING", {"default": ""}),
                "folderOverride3": ("STRING", {"default": ""}),
                "folderOverride4": ("STRING", {"default": ""}),
                "folderOverride5": ("STRING", {"default": ""}),
            },
            "hidden": {
                "unique_id": "UNIQUE_ID",
            }
        }
    
    RETURN_TYPES = ("IMAGE", "IMAGE", "IMAGE", "IMAGE", "IMAGE", "MASK", "MASK", "MASK", "MASK", "MASK")
    RETURN_NAMES = ("image1", "image2", "image3", "image4", "image5", "mask1", "mask2", "mask3", "mask4", "mask5")
    FUNCTION = "load_selected_images"
    CATEGORY = "image"
    DESCRIPTION = "Browse folders and pick images from thumbnails. Has 5 tabs, each outputting a separate image and its alpha channel as a mask."
    
    def load_image(self, folder, selected_image):
        """Load a single image and return (image_tensor, mask_tensor) tuple.
        
        - image_tensor: (1, H, W, 3) RGB float32
        - mask_tensor: (1, H, W) float32, inverted alpha (1.0=transparent/masked)
        """
        if not selected_image or not folder:
            # Return placeholder image and mask
            return (
                torch.zeros((1, 64, 64, 3), dtype=torch.float32),
                torch.zeros((1, 64, 64), dtype=torch.float32)
            )
        
        image_path = os.path.join(folder, selected_image)
        
        if not os.path.exists(image_path):
            return (
                torch.zeros((1, 64, 64, 3), dtype=torch.float32),
                torch.zeros((1, 64, 64), dtype=torch.float32)
            )
        
        try:
            img = Image.open(image_path)
            
            # For animated images (GIF), just use first frame
            if hasattr(img, 'n_frames') and img.n_frames > 1:
                img.seek(0)
            
            # Apply EXIF orientation
            img = ImageOps.exif_transpose(img)
            
            # Extract alpha channel before converting to RGB
            has_alpha = 'A' in img.getbands()
            if has_alpha:
                alpha_np = np.array(img.getchannel('A')).astype(np.float32) / 255.0
                # Invert alpha: ComfyUI mask convention is 1.0=transparent/masked
                mask = 1.0 - torch.from_numpy(alpha_np)
            elif img.mode == 'P' and 'transparency' in img.info:
                # Handle palette images with transparency
                alpha_np = np.array(img.convert('RGBA').getchannel('A')).astype(np.float32) / 255.0
                mask = 1.0 - torch.from_numpy(alpha_np)
            else:
                # No alpha channel - will create zero mask after we know dimensions
                mask = None
            
            # Convert to RGB for image output
            if img.mode != 'RGB':
                img = img.convert('RGB')
            
            image_np = np.array(img).astype(np.float32) / 255.0
            image_tensor = torch.from_numpy(image_np).unsqueeze(0)  # (1, H, W, 3)
            
            # Create fallback mask with same dimensions if no alpha
            if mask is None:
                h, w = image_np.shape[:2]
                mask = torch.zeros((h, w), dtype=torch.float32)
            
            # Add batch dimension to mask
            mask_tensor = mask.unsqueeze(0)  # (1, H, W)
            
            return (image_tensor, mask_tensor)
            
        except Exception as e:
            print(f"[ImageFolderPicker] Error loading {image_path}: {e}")
            return (
                torch.zeros((1, 64, 64, 3), dtype=torch.float32),
                torch.zeros((1, 64, 64), dtype=torch.float32)
            )
    
    def load_selected_images(self, folder1, folder2, folder3, folder4, folder5,
                             folder1_input=None, folder2_input=None, folder3_input=None,
                             folder4_input=None, folder5_input=None,
                             selected_image1="", selected_image2="", selected_image3="",
                             selected_image4="", selected_image5="",
                             folderOverride1="", folderOverride2="", folderOverride3="",
                             folderOverride4="", folderOverride5="",
                             unique_id=None):
        """Load all selected images.
        
        Priority: folderOverride* > folder*_input > folder*
        
        Returns: (image1, image2, image3, image4, image5, mask1, mask2, mask3, mask4, mask5)
        """
        # Folder resolution: folderOverride takes priority (set when navigating subfolders),
        # then connected input, then widget value
        f1 = folderOverride1 if folderOverride1 else (folder1_input if folder1_input else folder1)
        f2 = folderOverride2 if folderOverride2 else (folder2_input if folder2_input else folder2)
        f3 = folderOverride3 if folderOverride3 else (folder3_input if folder3_input else folder3)
        f4 = folderOverride4 if folderOverride4 else (folder4_input if folder4_input else folder4)
        f5 = folderOverride5 if folderOverride5 else (folder5_input if folder5_input else folder5)
        
        image1, mask1 = self.load_image(f1, selected_image1)
        image2, mask2 = self.load_image(f2, selected_image2)
        image3, mask3 = self.load_image(f3, selected_image3)
        image4, mask4 = self.load_image(f4, selected_image4)
        image5, mask5 = self.load_image(f5, selected_image5)
        
        return (image1, image2, image3, image4, image5, mask1, mask2, mask3, mask4, mask5)
    
    @classmethod
    def IS_CHANGED(cls, folder1="", folder2="", folder3="", folder4="", folder5="",
                   folder1_input=None, folder2_input=None, folder3_input=None,
                   folder4_input=None, folder5_input=None,
                   selected_image1="", selected_image2="", selected_image3="",
                   selected_image4="", selected_image5="",
                   folderOverride1="", folderOverride2="", folderOverride3="",
                   folderOverride4="", folderOverride5="", **kwargs):
        """Return hash for cache invalidation."""
        # Folder resolution: folderOverride > input > widget
        f1 = folderOverride1 if folderOverride1 else (folder1_input if folder1_input else folder1)
        f2 = folderOverride2 if folderOverride2 else (folder2_input if folder2_input else folder2)
        f3 = folderOverride3 if folderOverride3 else (folder3_input if folder3_input else folder3)
        f4 = folderOverride4 if folderOverride4 else (folder4_input if folder4_input else folder4)
        f5 = folderOverride5 if folderOverride5 else (folder5_input if folder5_input else folder5)
        
        parts = []
        
        for folder, selected in [(f1, selected_image1), (f2, selected_image2), (f3, selected_image3), (f4, selected_image4), (f5, selected_image5)]:
            if selected and folder:
                image_path = os.path.join(folder, selected)
                if os.path.exists(image_path):
                    stat = os.stat(image_path)
                    parts.append(f"{image_path}_{stat.st_mtime}_{stat.st_size}")
        
        if parts:
            return "_".join(parts)
        return float("NaN")
    
    @classmethod
    def VALIDATE_INPUTS(cls, folder1="", folder2="", folder3="", folder4="", folder5="",
                        folder1_input=None, folder2_input=None, folder3_input=None,
                        folder4_input=None, folder5_input=None,
                        selected_image1="", selected_image2="", selected_image3="",
                        selected_image4="", selected_image5="",
                        folderOverride1="", folderOverride2="", folderOverride3="",
                        folderOverride4="", folderOverride5="", **kwargs):
        """Validate inputs - we allow missing images (they return empty tensor)."""
        # Always return True - missing images will just return blank tensors
        # This allows the node to work even if paths are temporarily invalid
        return True
