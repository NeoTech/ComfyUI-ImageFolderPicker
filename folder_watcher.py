"""
Folder Watcher Manager for ComfyUI-ImageFolderPicker
Uses watchdog to monitor folders for changes and pushes updates via WebSocket
"""

import os
import threading
import time
from typing import Dict, Optional, Set

try:
    from watchdog.observers import Observer
    from watchdog.events import FileSystemEventHandler, FileSystemEvent
    WATCHDOG_AVAILABLE = True
except ImportError:
    WATCHDOG_AVAILABLE = False
    Observer = None
    FileSystemEventHandler = object
    FileSystemEvent = None

# Valid image extensions to monitor
VALID_EXTENSIONS = {'.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.tiff', '.tif'}


class ImageFolderHandler(FileSystemEventHandler):
    """Handles file system events for a watched folder."""
    
    def __init__(self, folder_path: str, manager: 'FolderWatcherManager'):
        super().__init__()
        self.folder_path = folder_path
        self.manager = manager
        self._last_event_time = 0
        self._pending_notify = False
        self._debounce_lock = threading.Lock()
    
    def _is_valid_image(self, path: str) -> bool:
        """Check if the file is a valid image type."""
        ext = os.path.splitext(path)[1].lower()
        return ext in VALID_EXTENSIONS
    
    def _should_process(self, event: 'FileSystemEvent') -> bool:
        """Determine if this event should trigger a notification."""
        if event.is_directory:
            return True  # Directory changes may affect subfolder list
        return self._is_valid_image(event.src_path)
    
    def on_any_event(self, event: 'FileSystemEvent'):
        """Handle any file system event with debouncing."""
        if not self._should_process(event):
            return
        
        with self._debounce_lock:
            current_time = time.time()
            # Debounce: ignore events within 300ms of last event
            if current_time - self._last_event_time < 0.3:
                return
            self._last_event_time = current_time
        
        # Schedule notification (with additional debounce via timer)
        self.manager._schedule_notification(self.folder_path)


class FolderWatcherManager:
    """
    Singleton manager for folder watching.
    Handles multiple folders with reference counting.
    """
    
    _instance: Optional['FolderWatcherManager'] = None
    _lock = threading.Lock()
    
    def __init__(self):
        if not WATCHDOG_AVAILABLE:
            print("[ImageFolderPicker] Warning: watchdog not installed, folder monitoring disabled")
            self.observer = None
            return
        
        self.observer = Observer()
        self._watches: Dict[str, object] = {}  # folder_path -> watch object
        self._handlers: Dict[str, ImageFolderHandler] = {}  # folder_path -> handler
        self._ref_counts: Dict[str, int] = {}  # folder_path -> reference count
        self._watch_lock = threading.Lock()
        
        # Notification debouncing
        self._pending_notifications: Set[str] = set()
        self._notify_timer: Optional[threading.Timer] = None
        self._notify_lock = threading.Lock()
        
        # Start the observer thread
        self.observer.start()
    
    @classmethod
    def get_instance(cls) -> 'FolderWatcherManager':
        """Get or create the singleton instance."""
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = cls()
        return cls._instance
    
    def watch_folder(self, folder_path: str) -> bool:
        """
        Start watching a folder. Uses reference counting for multiple watchers.
        Returns True if successfully watching, False otherwise.
        """
        if not WATCHDOG_AVAILABLE or self.observer is None:
            return False
        
        # Normalize path
        folder_path = os.path.normpath(os.path.abspath(folder_path))
        
        if not os.path.isdir(folder_path):
            return False
        
        with self._watch_lock:
            if folder_path in self._watches:
                # Already watching - increment ref count
                self._ref_counts[folder_path] = self._ref_counts.get(folder_path, 1) + 1
                return True
            
            try:
                handler = ImageFolderHandler(folder_path, self)
                watch = self.observer.schedule(handler, folder_path, recursive=False)
                self._watches[folder_path] = watch
                self._handlers[folder_path] = handler
                self._ref_counts[folder_path] = 1
                return True
            except Exception as e:
                print(f"[ImageFolderPicker] Failed to watch {folder_path}: {e}")
                return False
    
    def unwatch_folder(self, folder_path: str) -> bool:
        """
        Stop watching a folder. Decrements reference count.
        Returns True if still watching (other refs), False if fully unwatched.
        """
        if not WATCHDOG_AVAILABLE or self.observer is None:
            return False
        
        folder_path = os.path.normpath(os.path.abspath(folder_path))
        
        with self._watch_lock:
            if folder_path not in self._watches:
                return False
            
            self._ref_counts[folder_path] = self._ref_counts.get(folder_path, 1) - 1
            
            if self._ref_counts[folder_path] <= 0:
                # No more references - stop watching
                try:
                    self.observer.unschedule(self._watches[folder_path])
                except Exception as e:
                    print(f"[ImageFolderPicker] Error unwatching {folder_path}: {e}")
                
                del self._watches[folder_path]
                del self._handlers[folder_path]
                del self._ref_counts[folder_path]
                return False
            
            return True  # Still watching (other references)
    
    def is_watching(self, folder_path: str) -> bool:
        """Check if a folder is currently being watched."""
        folder_path = os.path.normpath(os.path.abspath(folder_path))
        return folder_path in self._watches
    
    def get_watched_folders(self) -> list:
        """Get list of all currently watched folders."""
        with self._watch_lock:
            return list(self._watches.keys())
    
    def _schedule_notification(self, folder_path: str):
        """Schedule a debounced notification for a folder change."""
        with self._notify_lock:
            self._pending_notifications.add(folder_path)
            
            # Cancel existing timer
            if self._notify_timer is not None:
                self._notify_timer.cancel()
            
            # Schedule new timer (500ms debounce)
            self._notify_timer = threading.Timer(0.5, self._send_notifications)
            self._notify_timer.start()
    
    def _send_notifications(self):
        """Send all pending notifications via WebSocket."""
        with self._notify_lock:
            folders = list(self._pending_notifications)
            self._pending_notifications.clear()
            self._notify_timer = None
        
        if not folders:
            return
        
        try:
            from server import PromptServer
            
            for folder in folders:
                PromptServer.instance.send_sync(
                    "imagefolderpicker.folder_changed",
                    {"folder": folder}
                )
        except Exception as e:
            print(f"[ImageFolderPicker] Error sending notification: {e}")
    
    def shutdown(self):
        """Stop the observer and clean up."""
        if self.observer is not None:
            self.observer.stop()
            self.observer.join(timeout=5)


# Cleanup on module unload
import atexit

def _cleanup():
    if FolderWatcherManager._instance is not None:
        FolderWatcherManager._instance.shutdown()

atexit.register(_cleanup)
