"""
ComfyUI Image Folder Picker Node

A custom node that allows browsing a folder of images and selecting one 
from a thumbnail gallery directly in the node UI.
"""

from .image_folder_picker import ImageFolderPicker
from .server_routes import register_routes

# Register API routes
register_routes()

NODE_CLASS_MAPPINGS = {
    "ImageFolderPicker": ImageFolderPicker,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "ImageFolderPicker": "Image Folder Picker 📁",
}

# Auto-load JavaScript from web/js folder
WEB_DIRECTORY = "./web/js"

__all__ = ['NODE_CLASS_MAPPINGS', 'NODE_DISPLAY_NAME_MAPPINGS', 'WEB_DIRECTORY']
