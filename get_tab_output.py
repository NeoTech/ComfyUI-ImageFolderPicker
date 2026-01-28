"""
Get Tab Output Node for ComfyUI
Extracts a specific tab's output from ImageFolderPicker list outputs
"""

import torch

# Console logging for debug
def log(msg):
    print(f"[GetTabOutput] {msg}")


class GetTabOutput:
    """
    A ComfyUI node that extracts a specific tab's output from ImageFolderPicker.
    Takes list inputs (images, masks, filepaths) and returns single values for the selected tab.
    """
    
    INPUT_IS_LIST = True  # Critical: receive lists instead of auto-iteration
    
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "images": ("IMAGE",),
                "tab_number": ("INT", {
                    "default": 1,
                    "min": 1,
                    "max": 5,
                    "step": 1,
                    "display": "number"
                }),
            },
            "optional": {
                "masks": ("MASK",),
                "filepaths": ("STRING", {"forceInput": True}),
            },
        }
    
    RETURN_TYPES = ("IMAGE", "MASK", "STRING")
    RETURN_NAMES = ("image", "mask", "filepath")
    FUNCTION = "get_tab"
    CATEGORY = "image"
    DESCRIPTION = "Extract a specific tab's output from ImageFolderPicker. Select tab number (1-5) to get the corresponding image, mask, and filepath."
    
    def get_tab(self, images, tab_number, masks=None, filepaths=None):
        """
        Extract outputs for a specific tab.
        
        Args:
            images: List of IMAGE tensors from ImageFolderPicker
            tab_number: List with single INT value (because INPUT_IS_LIST=True)
            masks: Optional list of MASK tensors from ImageFolderPicker
            filepaths: Optional list of STRING paths from ImageFolderPicker
        
        Returns:
            tuple: (image, mask, filepath) for the selected tab
        """
        log("=" * 50)
        log(f"get_tab called")
        log(f"images type: {type(images)}, len: {len(images) if isinstance(images, list) else 'N/A'}")
        log(f"masks type: {type(masks)}, len: {len(masks) if isinstance(masks, list) else 'N/A'}")
        log(f"filepaths type: {type(filepaths)}, len: {len(filepaths) if isinstance(filepaths, list) else 'N/A'}")
        log(f"tab_number type: {type(tab_number)}, value: {tab_number}")
        
        # Extract tab_number from list (INPUT_IS_LIST makes all inputs lists)
        tab_num = tab_number[0] if isinstance(tab_number, list) else tab_number
        log(f"Extracted tab_num: {tab_num}")
        
        # Clamp tab_number to valid range (1-5)
        tab_num = max(1, min(5, tab_num))
        
        # Convert to 0-based index
        idx = tab_num - 1
        log(f"Extracting index {idx}")
        
        # Extract the specific image/mask/filepath from lists
        if isinstance(images, list) and len(images) > idx:
            image = images[idx]
            log(f"Extracted image from list, shape: {image.shape}")
        else:
            image = torch.zeros((1, 64, 64, 3), dtype=torch.float32)
            log(f"Using default image")
        
        if masks is not None and isinstance(masks, list) and len(masks) > idx:
            mask = masks[idx]
            log(f"Extracted mask from list, shape: {mask.shape}")
        else:
            mask = torch.zeros((1, 64, 64), dtype=torch.float32)
            log(f"Using default mask")
        
        if filepaths is not None and isinstance(filepaths, list) and len(filepaths) > idx:
            filepath = filepaths[idx]
            log(f"Extracted filepath from list: {filepath}")
        else:
            filepath = ""
            log(f"Using empty filepath")
        
        log(f"Returning - image shape: {image.shape}, mask shape: {mask.shape}, filepath: {filepath}")
        
        return (image, mask, filepath)
