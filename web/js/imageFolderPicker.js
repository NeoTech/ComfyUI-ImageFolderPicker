/**
 * Image Folder Picker - Frontend Extension for ComfyUI
 * Displays folder images as selectable thumbnails with pagination
 */

import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

console.log("[ImageFolderPicker] Extension loading...");

const THUMBNAIL_SIZE = 80;
const THUMBNAIL_PADDING = 6;
const GALLERY_MARGIN = 8;
const WIDGET_HEIGHT = 26;
const HEADER_HEIGHT = 30;
const NAV_HEIGHT = 28; // Height for pagination controls

app.registerExtension({
    name: "Comfy.ImageFolderPicker",
    
    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        if (nodeData.name !== "ImageFolderPicker") return;
        
        console.log("[ImageFolderPicker] Registering node definition");
        
        const onNodeCreated = nodeType.prototype.onNodeCreated;
        
        nodeType.prototype.onNodeCreated = function() {
            const result = onNodeCreated?.apply(this, arguments);
            
            console.log("[ImageFolderPicker] Node created, initializing...");
            
            // Node state
            this.images = [];
            this.thumbnailCache = {};
            this.selectedIndex = -1;
            this.currentPage = 0;
            this.isLoading = false;
            
            // Set initial size
            this.size = [340, 400];
            this.resizable = true;
            
            // Setup after widgets are created
            setTimeout(() => {
                this.setupWidgets();
            }, 50);
            
            return result;
        };
        
        // Setup widgets
        nodeType.prototype.setupWidgets = function() {
            console.log("[ImageFolderPicker] Setting up widgets");
            
            if (this._widgetsSetup) return;
            this._widgetsSetup = true;
            
            // Find widgets
            this.folderWidget = this.widgets?.find(w => w.name === "folder");
            this.selectedWidget = this.widgets?.find(w => w.name === "selected_image");
            
            // Hide selected_image widget visually but keep it in array for serialization
            if (this.selectedWidget) {
                this.selectedWidget.type = "hidden";
                this.selectedWidget.computeSize = () => [0, -4]; // Minimal size
            }
            
            // Add Load button
            this.addWidget("button", "📂 Load Images", null, () => {
                this.loadFolderImages();
            });
            
            // Load images if folder already has a value
            if (this.folderWidget?.value) {
                this.loadFolderImages();
            }
            
            this.setDirtyCanvas(true);
        };
        
        // Load images from folder via API
        nodeType.prototype.loadFolderImages = async function(forceRefresh = false) {
            const folder = this.folderWidget?.value;
            console.log("[ImageFolderPicker] Loading folder:", folder);
            
            if (!folder) {
                this.images = [];
                this.setDirtyCanvas(true);
                return;
            }
            
            this.isLoading = true;
            this.currentPage = 0;
            this.setDirtyCanvas(true);
            
            try {
                if (forceRefresh) {
                    await api.fetchApi("/imagefolderpicker/refresh", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ folder })
                    });
                }
                
                const response = await api.fetchApi(
                    `/imagefolderpicker/list?folder=${encodeURIComponent(folder)}`
                );
                
                if (response.ok) {
                    const data = await response.json();
                    this.images = data.images || [];
                    console.log("[ImageFolderPicker] Loaded", this.images.length, "images");
                    
                    this.thumbnailCache = {};
                    
                    // Restore selection
                    const currentSelected = this.selectedWidget?.value;
                    if (currentSelected) {
                        const idx = this.images.findIndex(img => img.filename === currentSelected);
                        this.selectedIndex = idx >= 0 ? idx : -1;
                        // Go to page containing selected image
                        if (this.selectedIndex >= 0) {
                            const layout = this.getGalleryLayout();
                            this.currentPage = Math.floor(this.selectedIndex / layout.imagesPerPage);
                        }
                    }
                    
                    this.preloadThumbnails();
                } else {
                    console.error("[ImageFolderPicker] Failed to load folder");
                    this.images = [];
                }
            } catch (e) {
                console.error("[ImageFolderPicker] Error loading folder:", e);
                this.images = [];
            }
            
            this.isLoading = false;
            this.setDirtyCanvas(true);
        };
        
        // Preload thumbnail images
        nodeType.prototype.preloadThumbnails = function() {
            const folder = this.folderWidget?.value;
            if (!folder) return;
            
            const node = this;
            for (const imgData of this.images) {
                if (this.thumbnailCache[imgData.filename] !== undefined) continue;
                
                this.thumbnailCache[imgData.filename] = false;
                
                const img = new Image();
                img.onload = function() {
                    node.thumbnailCache[imgData.filename] = img;
                    node.setDirtyCanvas(true);
                };
                img.onerror = function() {
                    node.thumbnailCache[imgData.filename] = null;
                    node.setDirtyCanvas(true);
                };
                img.src = `/imagefolderpicker/thumbnail?folder=${encodeURIComponent(folder)}&filename=${encodeURIComponent(imgData.filename)}`;
            }
        };
        
        // Get gallery top position
        nodeType.prototype.getGalleryTop = function() {
            const outputCount = this.outputs?.length || 0;
            const outputHeight = outputCount > 0 ? 20 + outputCount * 20 : 20;
            
            let visibleWidgets = 0;
            if (this.widgets) {
                for (const w of this.widgets) {
                    if (w.type !== "hidden") {
                        visibleWidgets++;
                    }
                }
            }
            
            return HEADER_HEIGHT + outputHeight + (visibleWidgets * WIDGET_HEIGHT) + GALLERY_MARGIN;
        };
        
        // Calculate gallery layout with pagination
        nodeType.prototype.getGalleryLayout = function() {
            const galleryTop = this.getGalleryTop();
            const availableWidth = this.size[0] - THUMBNAIL_PADDING * 2;
            const availableHeight = this.size[1] - galleryTop - NAV_HEIGHT - THUMBNAIL_PADDING;
            
            // Calculate how many columns and rows fit
            const cols = Math.max(1, Math.floor(availableWidth / (THUMBNAIL_SIZE + THUMBNAIL_PADDING)));
            const rows = Math.max(1, Math.floor(availableHeight / (THUMBNAIL_SIZE + THUMBNAIL_PADDING)));
            const imagesPerPage = cols * rows;
            
            const totalImages = this.images?.length || 0;
            const totalPages = Math.max(1, Math.ceil(totalImages / imagesPerPage));
            
            return { 
                cols, 
                rows, 
                imagesPerPage, 
                totalPages, 
                galleryTop, 
                availableWidth, 
                availableHeight 
            };
        };
        
        // Navigation methods
        nodeType.prototype.prevPage = function() {
            if (this.currentPage > 0) {
                this.currentPage--;
                this.setDirtyCanvas(true);
            }
        };
        
        nodeType.prototype.nextPage = function() {
            const layout = this.getGalleryLayout();
            if (this.currentPage < layout.totalPages - 1) {
                this.currentPage++;
                this.setDirtyCanvas(true);
            }
        };
        
        // Custom drawing
        const onDrawForeground = nodeType.prototype.onDrawForeground;
        nodeType.prototype.onDrawForeground = function(ctx) {
            if (onDrawForeground) {
                onDrawForeground.apply(this, arguments);
            }
            
            if (this.flags.collapsed) return;
            
            const layout = this.getGalleryLayout();
            const galleryTop = layout.galleryTop;
            const navY = this.size[1] - NAV_HEIGHT;
            
            // Draw gallery background
            ctx.fillStyle = "#1a1a1a";
            ctx.fillRect(
                THUMBNAIL_PADDING, 
                galleryTop, 
                this.size[0] - THUMBNAIL_PADDING * 2, 
                navY - galleryTop - THUMBNAIL_PADDING
            );
            
            // Loading indicator
            if (this.isLoading) {
                ctx.fillStyle = "#888";
                ctx.font = "14px Arial";
                ctx.textAlign = "center";
                ctx.fillText("Loading...", this.size[0] / 2, galleryTop + 50);
                this.drawNavigation(ctx, layout, navY);
                return;
            }
            
            // No images message
            if (!this.images || this.images.length === 0) {
                ctx.fillStyle = "#666";
                ctx.font = "12px Arial";
                ctx.textAlign = "center";
                ctx.fillText(
                    this.folderWidget?.value ? "No images found" : "Enter folder path and click Load",
                    this.size[0] / 2, 
                    galleryTop + 50
                );
                this.drawNavigation(ctx, layout, navY);
                return;
            }
            
            // Ensure currentPage is valid
            if (this.currentPage >= layout.totalPages) {
                this.currentPage = layout.totalPages - 1;
            }
            if (this.currentPage < 0) {
                this.currentPage = 0;
            }
            
            // Draw thumbnails for current page
            const startIdx = this.currentPage * layout.imagesPerPage;
            const endIdx = Math.min(startIdx + layout.imagesPerPage, this.images.length);
            
            for (let i = startIdx; i < endIdx; i++) {
                const imgData = this.images[i];
                const pageIdx = i - startIdx;
                const col = pageIdx % layout.cols;
                const row = Math.floor(pageIdx / layout.cols);
                
                const x = THUMBNAIL_PADDING + col * (THUMBNAIL_SIZE + THUMBNAIL_PADDING);
                const y = galleryTop + THUMBNAIL_PADDING + row * (THUMBNAIL_SIZE + THUMBNAIL_PADDING);
                
                // Draw selection highlight
                if (i === this.selectedIndex) {
                    ctx.fillStyle = "#4a9eff";
                    ctx.fillRect(x - 3, y - 3, THUMBNAIL_SIZE + 6, THUMBNAIL_SIZE + 6);
                }
                
                // Draw thumbnail background
                ctx.fillStyle = "#333";
                ctx.fillRect(x, y, THUMBNAIL_SIZE, THUMBNAIL_SIZE);
                
                // Draw thumbnail image
                const thumb = this.thumbnailCache[imgData.filename];
                if (thumb && thumb !== false) {
                    const scale = Math.min(
                        THUMBNAIL_SIZE / thumb.width,
                        THUMBNAIL_SIZE / thumb.height
                    );
                    const w = thumb.width * scale;
                    const h = thumb.height * scale;
                    const dx = x + (THUMBNAIL_SIZE - w) / 2;
                    const dy = y + (THUMBNAIL_SIZE - h) / 2;
                    
                    ctx.drawImage(thumb, dx, dy, w, h);
                } else if (thumb === null) {
                    ctx.fillStyle = "#600";
                    ctx.fillRect(x, y, THUMBNAIL_SIZE, THUMBNAIL_SIZE);
                    ctx.fillStyle = "#fff";
                    ctx.font = "10px Arial";
                    ctx.textAlign = "center";
                    ctx.fillText("Error", x + THUMBNAIL_SIZE / 2, y + THUMBNAIL_SIZE / 2 + 4);
                } else {
                    ctx.fillStyle = "#555";
                    ctx.font = "10px Arial";
                    ctx.textAlign = "center";
                    ctx.fillText("...", x + THUMBNAIL_SIZE / 2, y + THUMBNAIL_SIZE / 2 + 4);
                }
            }
            
            // Draw navigation
            this.drawNavigation(ctx, layout, navY);
        };
        
        // Draw navigation controls
        nodeType.prototype.drawNavigation = function(ctx, layout, navY) {
            const centerX = this.size[0] / 2;
            const buttonWidth = 30;
            const buttonHeight = 22;
            
            // Store button positions for click detection
            this._prevButtonRect = {
                x: centerX - 80,
                y: navY + 2,
                w: buttonWidth,
                h: buttonHeight
            };
            this._nextButtonRect = {
                x: centerX + 50,
                y: navY + 2,
                w: buttonWidth,
                h: buttonHeight
            };
            
            // Draw prev button
            const canPrev = this.currentPage > 0;
            ctx.fillStyle = canPrev ? "#444" : "#2a2a2a";
            ctx.fillRect(this._prevButtonRect.x, this._prevButtonRect.y, buttonWidth, buttonHeight);
            ctx.fillStyle = canPrev ? "#fff" : "#555";
            ctx.font = "14px Arial";
            ctx.textAlign = "center";
            ctx.fillText("◀", this._prevButtonRect.x + buttonWidth / 2, this._prevButtonRect.y + 16);
            
            // Draw page indicator
            ctx.fillStyle = "#aaa";
            ctx.font = "12px Arial";
            ctx.textAlign = "center";
            const pageText = this.images?.length > 0 
                ? `${this.currentPage + 1} / ${layout.totalPages}`
                : "0 / 0";
            ctx.fillText(pageText, centerX, navY + 16);
            
            // Draw next button
            const canNext = this.currentPage < layout.totalPages - 1;
            ctx.fillStyle = canNext ? "#444" : "#2a2a2a";
            ctx.fillRect(this._nextButtonRect.x, this._nextButtonRect.y, buttonWidth, buttonHeight);
            ctx.fillStyle = canNext ? "#fff" : "#555";
            ctx.fillText("▶", this._nextButtonRect.x + buttonWidth / 2, this._nextButtonRect.y + 16);
            
            // Draw image count
            ctx.fillStyle = "#666";
            ctx.font = "10px Arial";
            ctx.textAlign = "right";
            ctx.fillText(
                `${this.images?.length || 0} images`,
                this.size[0] - THUMBNAIL_PADDING,
                navY + 16
            );
        };
        
        // Handle mouse clicks
        const onMouseDown = nodeType.prototype.onMouseDown;
        nodeType.prototype.onMouseDown = function(event, localPos, graphCanvas) {
            if (this.flags.collapsed) return false;
            
            const lx = localPos[0];
            const ly = localPos[1];
            
            const layout = this.getGalleryLayout();
            const galleryTop = layout.galleryTop;
            const navY = this.size[1] - NAV_HEIGHT;
            
            // Check navigation buttons
            if (this._prevButtonRect && ly >= this._prevButtonRect.y && ly <= this._prevButtonRect.y + this._prevButtonRect.h) {
                if (lx >= this._prevButtonRect.x && lx <= this._prevButtonRect.x + this._prevButtonRect.w) {
                    this.prevPage();
                    return true;
                }
                if (this._nextButtonRect && lx >= this._nextButtonRect.x && lx <= this._nextButtonRect.x + this._nextButtonRect.w) {
                    this.nextPage();
                    return true;
                }
            }
            
            // Check if in gallery area
            if (ly < galleryTop || ly > navY - THUMBNAIL_PADDING) {
                return onMouseDown?.apply(this, arguments);
            }
            
            if (!this.images || this.images.length === 0) {
                return onMouseDown?.apply(this, arguments);
            }
            
            // Find clicked thumbnail
            const startIdx = this.currentPage * layout.imagesPerPage;
            const endIdx = Math.min(startIdx + layout.imagesPerPage, this.images.length);
            
            for (let i = startIdx; i < endIdx; i++) {
                const pageIdx = i - startIdx;
                const col = pageIdx % layout.cols;
                const row = Math.floor(pageIdx / layout.cols);
                
                const x = THUMBNAIL_PADDING + col * (THUMBNAIL_SIZE + THUMBNAIL_PADDING);
                const y = galleryTop + THUMBNAIL_PADDING + row * (THUMBNAIL_SIZE + THUMBNAIL_PADDING);
                
                if (lx >= x && lx <= x + THUMBNAIL_SIZE && 
                    ly >= y && ly <= y + THUMBNAIL_SIZE) {
                    
                    this.selectedIndex = i;
                    const filename = this.images[i].filename;
                    
                    console.log("[ImageFolderPicker] Selected image:", filename);
                    
                    if (this.selectedWidget) {
                        this.selectedWidget.value = filename;
                    }
                    
                    this.setDirtyCanvas(true);
                    
                    if (this.graph) {
                        this.graph.change();
                    }
                    
                    return true;
                }
            }
            
            return true; // Consume to prevent node dragging
        };
        
        // Handle mouse wheel for page navigation
        const onMouseWheel = nodeType.prototype.onMouseWheel;
        nodeType.prototype.onMouseWheel = function(event, localPos, graphCanvas) {
            if (this.flags.collapsed) return false;
            
            const layout = this.getGalleryLayout();
            const galleryTop = layout.galleryTop;
            const ly = localPos ? localPos[1] : 0;
            
            // Check if in gallery area
            if (ly >= galleryTop && ly <= this.size[1] && this.images?.length > 0 && layout.totalPages > 1) {
                let delta = 0;
                if (event.deltaY !== undefined) {
                    delta = event.deltaY;
                } else if (event.wheelDelta !== undefined) {
                    delta = -event.wheelDelta;
                }
                
                if (delta > 0) {
                    this.nextPage();
                } else if (delta < 0) {
                    this.prevPage();
                }
                
                // Stop event propagation
                event.stopPropagation && event.stopPropagation();
                event.preventDefault && event.preventDefault();
                event.stopImmediatePropagation && event.stopImmediatePropagation();
                event.stopped = true;
                
                return true;
            }
            
            return onMouseWheel?.apply(this, arguments);
        };
        
        // Serialize state
        const onSerialize = nodeType.prototype.onSerialize;
        nodeType.prototype.onSerialize = function(info) {
            if (onSerialize) {
                onSerialize.apply(this, arguments);
            }
            
            info.ifp_selectedIndex = this.selectedIndex;
            info.ifp_currentPage = this.currentPage;
        };
        
        // Restore state
        const onConfigure = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function(info) {
            if (onConfigure) {
                onConfigure.apply(this, arguments);
            }
            
            this.selectedIndex = info.ifp_selectedIndex ?? -1;
            this.currentPage = info.ifp_currentPage ?? 0;
            
            setTimeout(() => {
                this.setupWidgets();
            }, 100);
        };
    }
});

console.log("[ImageFolderPicker] Extension registered");
