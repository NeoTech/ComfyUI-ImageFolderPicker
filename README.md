# ComfyUI Image Folder Picker 📁

A custom node for ComfyUI that allows you to browse a folder of images and select one from a thumbnail gallery directly within the node interface.

## Features

- **5 Independent Tabs**: Load up to 5 different images simultaneously from different folders
- **Folder Browser**: Text input with folder dialog button to select image directories
- **Thumbnail Gallery**: Visual grid of image thumbnails rendered directly in the node
- **Click to Select**: Click any thumbnail to select it as the output image
- **Indexable Gallery**: Arrow navigation to browse through large image collections
- **Cached Thumbnails**: Thumbnails are stored in a `.thumbs` subfolder for fast loading in different sizes
- **Image Count**: Displays total number of images in the selected folder
- **Full-Resolution Preview**: Double-click any image to open a full-resolution preview overlay
- **Preview Navigation**: Navigate between images in preview mode using arrow keys or on-screen buttons
- **Delete Images**: Delete button on each thumbnail (with confirmation dialog) to remove unwanted images
- **Subfolder Support**: Navigate into subfolders; toggle folder visibility with the 📁/📂 button
- **Jump to Selected**: Click 📍 button to jump to the page containing the currently selected image
- **Alpha Channel Output**: Each tab outputs both the image and its alpha channel as a mask
- **Auto-Refresh**: Folders are monitored for changes and thumbnails update automatically
- **Smart Watching**: Only the active tab's folder is monitored to minimize resource usage
- **Execution Pause**: Folder watching pauses during workflow execution to avoid interference

## Installation

1. Navigate to your ComfyUI `custom_nodes` folder
2. Clone or copy this folder: `ComfyUI-ImageFolderPicker`
3. Install optional dependency for auto-refresh: `pip install watchdog`
4. Restart ComfyUI

## Usage

1. Add the **Image Folder Picker 📁** node from the `image` category
2. Use the 5 tabs to configure different image sources
3. Click **Browse Folder** to select a folder containing images
4. Thumbnails will load and display in the node
5. Click any thumbnail to select that image
6. Each tab outputs its selected image and alpha mask

### Preview Mode

- **Double-click** any image thumbnail to open full-resolution preview
- Use **Left/Right arrow keys** or the **◀/▶ buttons** to navigate between images
- Press **Escape** or click outside the image to close the preview
- The image you're viewing when you close becomes the selected image

### Deleting Images

- Hover over any thumbnail to reveal the **🗑** delete button in the top-right corner
- Click the delete button to open a confirmation dialog
- Confirm deletion to permanently remove the file from disk
- The gallery refreshes automatically after deletion

### Navigation Controls

- **Sort buttons** (Az, 📅↓, 📅↑): Sort by name or date
- **📁/📂 button**: Toggle subfolder visibility
- **📍 button**: Jump to the page containing the selected image
- **Size dropdown**: Change thumbnail size (64-320px)
- **Page buttons**: Navigate by 1, 5, 10, or 100 pages

## Outputs

| Output | Type | Description |
|--------|------|-------------|
| `image1-5` | IMAGE | The selected images from each tab as tensors |
| `mask1-5` | MASK | Alpha channels extracted as masks (white = transparent areas) |

## Inputs

Each tab has both a widget input and an optional string input for the folder path:
- `folder1-5`: Widget text input for folder path
- `folder1-5_input`: Optional STRING input (overrides widget when connected)

- JPEG (.jpg, .jpeg)
- PNG (.png)
- WebP (.webp)
- GIF (.gif) - first frame only
- BMP (.bmp)
- TIFF (.tiff, .tif)

## Thumbnail Caching

Thumbnails are automatically generated and cached in a `.thumbs` subfolder within your image folder. This speeds up subsequent loads. Click the **Refresh** button to regenerate thumbnails if your images have changed.

## Auto-Refresh (Folder Watching)

When the optional `watchdog` library is installed, the node automatically monitors the active tab's folder for changes:

- **Real-time updates**: New, modified, or deleted images are detected automatically
- **Smart pausing**: Folder watching is paused during workflow execution to avoid interference
- **Efficient**: Only the currently active tab's folder is monitored
- **Debounced**: Rapid file changes are batched to avoid excessive refreshes

If `watchdog` is not installed, the node works normally but requires manual refresh.

## Screenshots
![Image Folder Picker Node](example.png)

## License

MIT License
