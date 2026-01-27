"""
Server routes for Image Folder Picker node.
Provides API endpoints for listing folder contents and serving thumbnails.
"""

import os
import hashlib
from io import BytesIO
from PIL import Image

VALID_EXTENSIONS = {'.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.tiff', '.tif'}
THUMBNAIL_SIZE = (128, 128)
THUMBNAIL_SIZES = {128, 256, 346, 478, 512}  # Allowed thumbnail sizes
THUMBS_FOLDER = '.thumbs'


def get_thumbnail_path(folder, filename, size=128):
    """Get the path where a thumbnail should be stored."""
    thumbs_dir = os.path.join(folder, THUMBS_FOLDER)
    
    # Create hash of original filename for thumbnail name
    name, ext = os.path.splitext(filename)
    # Include size in filename for different sizes
    size_suffix = f"_{size}" if size != 128 else ""
    thumb_filename = f"{name}_thumb{size_suffix}.jpg"
    
    return thumbs_dir, os.path.join(thumbs_dir, thumb_filename)


def create_checker_background(size, checker_size=8):
    """Create a checkered background image for transparency indication."""
    width, height = size
    background = Image.new('RGB', (width, height))
    
    # Light and dark checker colors (typical Photoshop-style)
    light = (204, 204, 204)  # #cccccc
    dark = (153, 153, 153)   # #999999
    
    for y in range(0, height, checker_size):
        for x in range(0, width, checker_size):
            # Determine checker color based on position
            is_light = ((x // checker_size) + (y // checker_size)) % 2 == 0
            color = light if is_light else dark
            
            # Fill the checker square
            for dy in range(min(checker_size, height - y)):
                for dx in range(min(checker_size, width - x)):
                    background.putpixel((x + dx, y + dy), color)
    
    return background


def generate_thumbnail(image_path, thumb_path, size=128):
    """Generate a thumbnail for an image and save it."""
    try:
        # Create thumbnails directory if needed
        thumbs_dir = os.path.dirname(thumb_path)
        os.makedirs(thumbs_dir, exist_ok=True)
        
        thumb_size = (size, size)
        
        # Open and create thumbnail
        with Image.open(image_path) as img:
            # Handle EXIF orientation
            from PIL import ImageOps
            img = ImageOps.exif_transpose(img)
            
            # Create thumbnail maintaining aspect ratio first
            img.thumbnail(thumb_size, Image.Resampling.LANCZOS)
            
            # Handle transparency with checkered background
            if img.mode in ('RGBA', 'LA') or (img.mode == 'P' and 'transparency' in img.info):
                # Convert palette images to RGBA
                if img.mode == 'P':
                    img = img.convert('RGBA')
                elif img.mode == 'LA':
                    img = img.convert('RGBA')
                
                # Create checkered background at thumbnail size
                checker_size = max(4, size // 16)  # Scale checker size with thumbnail
                background = create_checker_background(img.size, checker_size)
                
                # Composite image over checkered background
                background.paste(img, mask=img.split()[-1])
                img = background
            elif img.mode != 'RGB':
                img = img.convert('RGB')
            
            # Save as JPEG
            img.save(thumb_path, 'JPEG', quality=85)
            
        return True
    except Exception as e:
        print(f"[ImageFolderPicker] Error generating thumbnail for {image_path}: {e}")
        return False


def is_thumbnail_valid(image_path, thumb_path):
    """Check if thumbnail exists and is up-to-date."""
    if not os.path.exists(thumb_path):
        return False
    
    # Check if original is newer than thumbnail
    image_mtime = os.path.getmtime(image_path)
    thumb_mtime = os.path.getmtime(thumb_path)
    
    return thumb_mtime >= image_mtime


def register_routes():
    """Register API routes with ComfyUI server."""
    try:
        from aiohttp import web
        from server import PromptServer
    except ImportError:
        print("[ImageFolderPicker] Could not import server modules")
        return
    
    routes = PromptServer.instance.routes
    
    @routes.get("/imagefolderpicker/list")
    async def list_folder_images(request):
        """List all images and subfolders in a folder with optional sorting."""
        folder = request.rel_url.query.get("folder", "")
        sort_by = request.rel_url.query.get("sort", "name")  # name, date_asc, date_desc
        
        if not folder:
            return web.json_response({"error": "No folder specified"}, status=400)
        
        if not os.path.isdir(folder):
            return web.json_response({"error": "Invalid folder path"}, status=400)
        
        images = []
        subfolders = []
        
        try:
            for filename in os.listdir(folder):
                file_path = os.path.join(folder, filename)
                
                # Check for subfolders (skip hidden folders)
                if os.path.isdir(file_path) and not filename.startswith('.'):
                    stat = os.stat(file_path)
                    subfolders.append({
                        "name": filename,
                        "path": file_path,
                        "modified": stat.st_mtime,
                        "type": "folder"
                    })
                    continue
                
                ext = os.path.splitext(filename)[1].lower()
                if ext in VALID_EXTENSIONS:
                    if os.path.isfile(file_path):
                        stat = os.stat(file_path)
                        # Get image dimensions
                        width, height = 0, 0
                        try:
                            with Image.open(file_path) as img:
                                width, height = img.size
                        except:
                            pass
                        images.append({
                            "filename": filename,
                            "size": stat.st_size,
                            "modified": stat.st_mtime,
                            "width": width,
                            "height": height,
                            "type": "image"
                        })
            
            # Sort subfolders by name
            subfolders.sort(key=lambda x: x["name"].lower())
            
            # Sort images based on parameter
            if sort_by == "date_asc":
                images.sort(key=lambda x: x["modified"])
            elif sort_by == "date_desc":
                images.sort(key=lambda x: x["modified"], reverse=True)
            else:  # Default: name (alphabetical)
                images.sort(key=lambda x: x["filename"].lower())
            
            # Get parent folder path
            parent = os.path.dirname(folder)
            if parent == folder:  # At root
                parent = ""
                
        except PermissionError:
            return web.json_response({"error": "Permission denied"}, status=403)
        except Exception as e:
            return web.json_response({"error": str(e)}, status=500)
        
        return web.json_response({
            "folder": folder,
            "parent": parent,
            "subfolders": subfolders,
            "images": images,
            "count": len(images),
            "sort": sort_by
        })
    
    @routes.get("/imagefolderpicker/thumbnail")
    async def get_thumbnail(request):
        """Get or generate a thumbnail for an image."""
        folder = request.rel_url.query.get("folder", "")
        filename = request.rel_url.query.get("filename", "")
        size_str = request.rel_url.query.get("size", "128")
        
        # Parse and validate size
        try:
            size = int(size_str)
            if size not in THUMBNAIL_SIZES:
                size = 128  # Default to 128 if invalid
        except ValueError:
            size = 128
        
        if not folder or not filename:
            return web.json_response({"error": "Missing folder or filename"}, status=400)
        
        image_path = os.path.join(folder, filename)
        
        if not os.path.exists(image_path):
            return web.json_response({"error": "Image not found"}, status=404)
        
        # Security check - ensure filename doesn't escape folder
        real_folder = os.path.realpath(folder)
        real_image = os.path.realpath(image_path)
        if not real_image.startswith(real_folder):
            return web.json_response({"error": "Invalid path"}, status=403)
        
        # Get thumbnail path with size
        _, thumb_path = get_thumbnail_path(folder, filename, size)
        
        # Generate thumbnail if needed
        if not is_thumbnail_valid(image_path, thumb_path):
            if not generate_thumbnail(image_path, thumb_path, size):
                # Fallback: return original image resized on-the-fly
                try:
                    with Image.open(image_path) as img:
                        from PIL import ImageOps
                        img = ImageOps.exif_transpose(img)
                        if img.mode != 'RGB':
                            img = img.convert('RGB')
                        img.thumbnail((size, size), Image.Resampling.LANCZOS)
                        
                        buffer = BytesIO()
                        img.save(buffer, 'JPEG', quality=85)
                        buffer.seek(0)
                        
                        return web.Response(
                            body=buffer.read(),
                            content_type='image/jpeg'
                        )
                except Exception as e:
                    return web.json_response({"error": str(e)}, status=500)
        
        # Return cached thumbnail
        try:
            with open(thumb_path, 'rb') as f:
                return web.Response(
                    body=f.read(),
                    content_type='image/jpeg'
                )
        except Exception as e:
            return web.json_response({"error": str(e)}, status=500)
    
    @routes.post("/imagefolderpicker/refresh")
    async def refresh_thumbnails(request):
        """Regenerate all thumbnails in a folder."""
        try:
            data = await request.json()
            folder = data.get("folder", "")
        except:
            return web.json_response({"error": "Invalid request"}, status=400)
        
        if not folder or not os.path.isdir(folder):
            return web.json_response({"error": "Invalid folder"}, status=400)
        
        regenerated = 0
        errors = 0
        
        for filename in os.listdir(folder):
            ext = os.path.splitext(filename)[1].lower()
            if ext in VALID_EXTENSIONS:
                image_path = os.path.join(folder, filename)
                _, thumb_path = get_thumbnail_path(folder, filename)
                
                if generate_thumbnail(image_path, thumb_path):
                    regenerated += 1
                else:
                    errors += 1
        
        return web.json_response({
            "regenerated": regenerated,
            "errors": errors
        })
    
    @routes.get("/imagefolderpicker/browse")
    async def browse_folders(request):
        """Browse folders on the system for folder picker dialog."""
        import platform
        
        current = request.rel_url.query.get("path", "")
        
        # If no path, return drives on Windows or root folders on Unix
        if not current:
            if platform.system() == "Windows":
                import string
                drives = []
                for letter in string.ascii_uppercase:
                    drive = f"{letter}:\\"
                    if os.path.exists(drive):
                        drives.append({"name": drive, "path": drive, "type": "drive"})
                return web.json_response({"folders": drives, "current": "", "parent": ""})
            else:
                current = "/"
        
        # Normalize path
        current = os.path.normpath(current)
        
        if not os.path.isdir(current):
            return web.json_response({"error": "Invalid path"}, status=400)
        
        folders = []
        try:
            for name in sorted(os.listdir(current)):
                full_path = os.path.join(current, name)
                if os.path.isdir(full_path) and not name.startswith('.'):
                    folders.append({
                        "name": name,
                        "path": full_path,
                        "type": "folder"
                    })
        except PermissionError:
            return web.json_response({"error": "Permission denied"}, status=403)
        except Exception as e:
            return web.json_response({"error": str(e)}, status=500)
        
        # Get parent path
        parent = os.path.dirname(current)
        if parent == current:  # At root
            parent = ""
        
        # Count images in current folder
        image_count = 0
        try:
            for name in os.listdir(current):
                ext = os.path.splitext(name)[1].lower()
                if ext in VALID_EXTENSIONS:
                    image_count += 1
        except:
            pass
        
        return web.json_response({
            "folders": folders,
            "current": current,
            "parent": parent,
            "image_count": image_count
        })
    
    @routes.post("/imagefolderpicker/watch")
    async def watch_folder(request):
        """Start watching a folder for changes."""
        try:
            data = await request.json()
            folder = data.get("folder", "")
        except:
            return web.json_response({"error": "Invalid request"}, status=400)
        
        if not folder or not os.path.isdir(folder):
            return web.json_response({"error": "Invalid folder"}, status=400)
        
        try:
            from .folder_watcher import FolderWatcherManager
            manager = FolderWatcherManager.get_instance()
            success = manager.watch_folder(folder)
            return web.json_response({
                "status": "watching" if success else "unavailable",
                "folder": folder
            })
        except ImportError:
            return web.json_response({"status": "unavailable", "error": "watchdog not installed"})
        except Exception as e:
            return web.json_response({"status": "error", "error": str(e)}, status=500)
    
    @routes.post("/imagefolderpicker/unwatch")
    async def unwatch_folder(request):
        """Stop watching a folder."""
        try:
            data = await request.json()
            folder = data.get("folder", "")
        except:
            return web.json_response({"error": "Invalid request"}, status=400)
        
        if not folder:
            return web.json_response({"error": "No folder specified"}, status=400)
        
        try:
            from .folder_watcher import FolderWatcherManager
            manager = FolderWatcherManager.get_instance()
            still_watching = manager.unwatch_folder(folder)
            return web.json_response({
                "status": "still_watching" if still_watching else "unwatched",
                "folder": folder
            })
        except ImportError:
            return web.json_response({"status": "unavailable"})
        except Exception as e:
            return web.json_response({"status": "error", "error": str(e)}, status=500)
    
    @routes.get("/imagefolderpicker/watched")
    async def get_watched_folders(request):
        """Get list of currently watched folders."""
        try:
            from .folder_watcher import FolderWatcherManager
            manager = FolderWatcherManager.get_instance()
            folders = manager.get_watched_folders()
            return web.json_response({
                "folders": folders,
                "count": len(folders)
            })
        except ImportError:
            return web.json_response({"folders": [], "count": 0, "status": "unavailable"})
        except Exception as e:
            return web.json_response({"error": str(e)}, status=500)
    
    @routes.post("/imagefolderpicker/pause")
    async def pause_watcher(request):
        """Pause folder watching notifications (during workflow execution)."""
        try:
            from .folder_watcher import FolderWatcherManager
            manager = FolderWatcherManager.get_instance()
            manager.pause()
            return web.json_response({"status": "paused"})
        except ImportError:
            return web.json_response({"status": "unavailable"})
        except Exception as e:
            return web.json_response({"status": "error", "error": str(e)}, status=500)
    
    @routes.post("/imagefolderpicker/resume")
    async def resume_watcher(request):
        """Resume folder watching notifications after workflow execution."""
        try:
            from .folder_watcher import FolderWatcherManager
            manager = FolderWatcherManager.get_instance()
            manager.resume()
            return web.json_response({"status": "resumed"})
        except ImportError:
            return web.json_response({"status": "unavailable"})
        except Exception as e:
            return web.json_response({"status": "error", "error": str(e)}, status=500)
