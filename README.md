# ComfyUI Image Folder Picker 📁

A custom node for ComfyUI that allows you to browse a folder of images and select one from a thumbnail gallery directly within the node interface.

## Features

- **Folder Browser**: Text input with folder dialog button to select image directories
- **Thumbnail Gallery**: Visual grid of image thumbnails rendered directly in the node
- **Click to Select**: Click any thumbnail to select it as the output image
- **Indexable Gallery**: Arrow navigation to browse through large image collections
- **Cached Thumbnails**: Thumbnails are stored in a `.thumbs` subfolder for fast loading in different sizes
- **Image Count**: Displays total number of images in the selected folder
- **Zoom In preview**: Double click to open a preview of the image in a larger window
- **Folder support**: Works with local folders on your machine

## Installation

1. Navigate to your ComfyUI `custom_nodes` folder
2. Clone or copy this folder: `ComfyUI-ImageFolderPicker`
3. Restart ComfyUI

## Usage

1. Add the **Image Folder Picker 📁** node from the `image` category
2. Click **Browse Folder** to select a folder containing images
3. Thumbnails will load and display in the node
4. Click any thumbnail to select that image
5. The selected image and its alpha mask are output from the node

## Outputs

| Output | Type | Description |
|--------|------|-------------|
| `image` | IMAGE | The selected image as a tensor |
| `mask` | MASK | Alpha channel extracted as mask (white = transparent areas) |
| `image_path` | STRING | Full path to the selected image file |
| `image_count` | INT | Total number of images in the folder |

## Supported Image Formats

- JPEG (.jpg, .jpeg)
- PNG (.png)
- WebP (.webp)
- GIF (.gif) - first frame only
- BMP (.bmp)
- TIFF (.tiff, .tif)

## Thumbnail Caching

Thumbnails are automatically generated and cached in a `.thumbs` subfolder within your image folder. This speeds up subsequent loads. Click the **Refresh** button to regenerate thumbnails if your images have changed.

## Screenshots
![Image Folder Picker Node](example.png)

## License

MIT License
