"""
Expand All Tabs Node for ComfyUI
Expands ImageFolderPicker list outputs into individual outputs for all 5 tabs
"""

import torch


class ExpandAllTabs:
    """
    A ComfyUI node that expands ImageFolderPicker list outputs into 15 individual outputs.
    Takes list inputs and returns all 5 tabs as separate image/mask/filepath outputs.
    """
    
    INPUT_IS_LIST = True  # Critical: receive lists instead of auto-iteration
    
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "images": ("IMAGE",),
            },
            "optional": {
                "masks": ("MASK",),
                "filepaths": ("STRING", {"forceInput": True}),
            },
        }
    
    RETURN_TYPES = ("IMAGE", "IMAGE", "IMAGE", "IMAGE", "IMAGE", 
                    "MASK", "MASK", "MASK", "MASK", "MASK", 
                    "STRING", "STRING", "STRING", "STRING", "STRING")
    RETURN_NAMES = ("image1", "image2", "image3", "image4", "image5", 
                    "mask1", "mask2", "mask3", "mask4", "mask5", 
                    "filepath1", "filepath2", "filepath3", "filepath4", "filepath5")
    FUNCTION = "expand_tabs"
    CATEGORY = "image"
    DESCRIPTION = "Expand ImageFolderPicker list outputs into 15 individual outputs (5 images, 5 masks, 5 filepaths). Provides all tabs at once without needing multiple GetTabOutput nodes."
    
    def expand_tabs(self, images, masks=None, filepaths=None):
        """
        Expand list outputs into individual outputs for all 5 tabs.
        
        Args:
            images: List of IMAGE tensors from ImageFolderPicker
            masks: Optional list of MASK tensors from ImageFolderPicker
            filepaths: Optional list of STRING paths from ImageFolderPicker
        
        Returns:
            tuple: (image1-5, mask1-5, filepath1-5)
        """
        # Create default placeholder values
        default_image = torch.zeros((1, 64, 64, 3), dtype=torch.float32)
        default_mask = torch.zeros((1, 64, 64), dtype=torch.float32)
        default_filepath = ""
        
        # Extract or use defaults
        def get_or_default(lst, idx, default):
            if lst is None:
                return default
            if isinstance(lst, list):
                return lst[idx] if idx < len(lst) else default
            else:
                return lst if idx == 0 else default
        
        # Extract all 5 tabs
        image1 = get_or_default(images, 0, default_image)
        image2 = get_or_default(images, 1, default_image)
        image3 = get_or_default(images, 2, default_image)
        image4 = get_or_default(images, 3, default_image)
        image5 = get_or_default(images, 4, default_image)
        
        mask1 = get_or_default(masks, 0, default_mask)
        mask2 = get_or_default(masks, 1, default_mask)
        mask3 = get_or_default(masks, 2, default_mask)
        mask4 = get_or_default(masks, 3, default_mask)
        mask5 = get_or_default(masks, 4, default_mask)
        
        filepath1 = get_or_default(filepaths, 0, default_filepath)
        filepath2 = get_or_default(filepaths, 1, default_filepath)
        filepath3 = get_or_default(filepaths, 2, default_filepath)
        filepath4 = get_or_default(filepaths, 3, default_filepath)
        filepath5 = get_or_default(filepaths, 4, default_filepath)
        
        return (image1, image2, image3, image4, image5,
                mask1, mask2, mask3, mask4, mask5,
                filepath1, filepath2, filepath3, filepath4, filepath5)
