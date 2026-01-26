/**
 * Image Folder Picker - Frontend Extension for ComfyUI
 * Displays folder images as selectable thumbnails with 3 tabs
 */

import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

console.log("[ImageFolderPicker] Extension loading...");

// Thumbnail size options
const THUMBNAIL_SIZES = [128, 256, 346, 478, 512];
const DEFAULT_THUMBNAIL_SIZE = 128;

const THUMBNAIL_PADDING = 6;
const TAB_HEIGHT = 26;
const NAV_HEIGHT = 26;
const CONTROLS_HEIGHT = 30;
const PATH_BAR_HEIGHT = 26;

// Global preview overlay element
let previewOverlay = null;

function showPreviewOverlay(imageSrc, filename, onClose) {
    // Create overlay if doesn't exist
    if (!previewOverlay) {
        previewOverlay = document.createElement('div');
        previewOverlay.id = 'ifp-preview-overlay';
        previewOverlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100vw;
            height: 100vh;
            background: rgba(0, 0, 0, 0.92);
            z-index: 99999;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            cursor: pointer;
        `;
        document.body.appendChild(previewOverlay);
    }
    
    previewOverlay.innerHTML = `
        <div style="position: absolute; top: 15px; right: 20px; width: 36px; height: 36px; 
                    background: #c44; border-radius: 4px; display: flex; align-items: center; 
                    justify-content: center; cursor: pointer; font-size: 20px; color: white;
                    font-weight: bold;" id="ifp-close-btn">✕</div>
        <img src="${imageSrc}" style="max-width: 90vw; max-height: 85vh; object-fit: contain; 
             border: 3px solid #4a9eff; border-radius: 4px;" />
        <div style="color: #ccc; font-size: 14px; margin-top: 12px; font-family: Arial, sans-serif;">
            ${filename}
        </div>
    `;
    
    previewOverlay.style.display = 'flex';
    
    // Close handlers
    const closeHandler = (e) => {
        if (e.target === previewOverlay || e.target.id === 'ifp-close-btn' || e.target.closest('#ifp-close-btn')) {
            hidePreviewOverlay();
            onClose?.();
        }
    };
    
    const keyHandler = (e) => {
        if (e.key === 'Escape') {
            hidePreviewOverlay();
            onClose?.();
            document.removeEventListener('keydown', keyHandler);
        }
    };
    
    previewOverlay.onclick = closeHandler;
    document.addEventListener('keydown', keyHandler);
}

function hidePreviewOverlay() {
    if (previewOverlay) {
        previewOverlay.style.display = 'none';
        previewOverlay.onclick = null;
    }
}

app.registerExtension({
    name: "Comfy.ImageFolderPicker",
    
    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        if (nodeData.name !== "ImageFolderPicker") return;
        
        console.log("[ImageFolderPicker] Registering node definition");
        
        const onNodeCreated = nodeType.prototype.onNodeCreated;
        
        nodeType.prototype.onNodeCreated = function() {
            const result = onNodeCreated?.apply(this, arguments);
            
            // Current active tab (0, 1, 2)
            this.activeTab = 0;
            
            // Thumbnail size (global setting)
            this.thumbnailSize = DEFAULT_THUMBNAIL_SIZE;
            
            // State for each tab
            this.tabState = [
                { images: [], thumbnailCache: {}, selectedIndex: -1, currentPage: 0, isLoading: false, sortOrder: 'name' },
                { images: [], thumbnailCache: {}, selectedIndex: -1, currentPage: 0, isLoading: false, sortOrder: 'name' },
                { images: [], thumbnailCache: {}, selectedIndex: -1, currentPage: 0, isLoading: false, sortOrder: 'name' }
            ];
            
            // Set initial size - must be large enough
            this.size[0] = Math.max(this.size[0], 380);
            this.size[1] = Math.max(this.size[1], 500);
            
            // Setup after widgets are created
            setTimeout(() => this.setupWidgets(), 100);
            
            return result;
        };
        
        nodeType.prototype.setupWidgets = function() {
            if (this._widgetsSetup) return;
            this._widgetsSetup = true;
            
            // Store references to widgets
            this.folderWidgets = [
                this.widgets?.find(w => w.name === "folder1"),
                this.widgets?.find(w => w.name === "folder2"),
                this.widgets?.find(w => w.name === "folder3")
            ];
            
            this.selectedWidgets = [
                this.widgets?.find(w => w.name === "selected_image1"),
                this.widgets?.find(w => w.name === "selected_image2"),
                this.widgets?.find(w => w.name === "selected_image3")
            ];
            
            // Hide all widgets - we draw our own UI
            if (this.widgets) {
                for (const w of this.widgets) {
                    w.type = "hidden";
                    w.computeSize = () => [0, -4];
                }
            }
            
            this.setDirtyCanvas(true);
        };
        
        nodeType.prototype.getState = function() {
            return this.tabState?.[this.activeTab] || { images: [], thumbnailCache: {}, selectedIndex: -1, currentPage: 0, isLoading: false };
        };
        
        // Helper to get folder path - checks connected input first, then widget value
        nodeType.prototype.getFolderPath = function(tabIdx) {
            // Check if there's a connected input for this tab
            const inputName = `folder${tabIdx + 1}_input`;
            const inputIdx = this.inputs?.findIndex(inp => inp.name === inputName);
            
            if (inputIdx >= 0 && this.inputs[inputIdx]?.link != null) {
                // There's a connection - get the value from connected node
                const linkId = this.inputs[inputIdx].link;
                const link = app.graph.links[linkId];
                if (link) {
                    const originNode = app.graph.getNodeById(link.origin_id);
                    if (originNode) {
                        // Try to get the output value - check widgets first
                        const originOutput = originNode.outputs?.[link.origin_slot];
                        
                        // For String/primitive nodes, look for a value widget
                        const valueWidget = originNode.widgets?.find(w => 
                            w.name === "value" || w.name === "text" || w.name === "string"
                        );
                        if (valueWidget?.value) {
                            return valueWidget.value;
                        }
                        
                        // Also check if origin node has getOutputData (executed value)
                        if (typeof originNode.getOutputData === 'function') {
                            const data = originNode.getOutputData(link.origin_slot);
                            if (data) return data;
                        }
                    }
                }
            }
            
            // Fall back to widget value
            return this.folderWidgets?.[tabIdx]?.value || "";
        };
        
        nodeType.prototype.loadImages = async function(tabIdx) {
            const folder = this.getFolderPath(tabIdx);
            const state = this.tabState[tabIdx];
            const sortOrder = state.sortOrder || 'name';
            
            if (!folder) {
                state.images = [];
                this.setDirtyCanvas(true);
                return;
            }
            
            state.isLoading = true;
            state.currentPage = 0;
            this.setDirtyCanvas(true);
            
            try {
                const resp = await api.fetchApi(`/imagefolderpicker/list?folder=${encodeURIComponent(folder)}&sort=${encodeURIComponent(sortOrder)}`);
                if (resp.ok) {
                    const data = await resp.json();
                    state.images = data.images || [];
                    state.thumbnailCache = {};
                    
                    // Restore selection if exists
                    const sel = this.selectedWidgets?.[tabIdx]?.value;
                    if (sel) {
                        const idx = state.images.findIndex(i => i.filename === sel);
                        state.selectedIndex = idx >= 0 ? idx : -1;
                    }
                    
                    this.loadThumbnails(tabIdx);
                } else {
                    state.images = [];
                }
            } catch (e) {
                console.error("[ImageFolderPicker] Load error:", e);
                state.images = [];
            }
            
            state.isLoading = false;
            this.setDirtyCanvas(true);
        };
        
        nodeType.prototype.loadThumbnails = function(tabIdx) {
            const folder = this.getFolderPath(tabIdx);
            const state = this.tabState[tabIdx];
            const thumbSize = this.thumbnailSize || DEFAULT_THUMBNAIL_SIZE;
            if (!folder) return;
            
            const node = this;
            for (const img of state.images) {
                if (state.thumbnailCache[img.filename] !== undefined) continue;
                state.thumbnailCache[img.filename] = false;
                
                const image = new Image();
                image.onload = () => { state.thumbnailCache[img.filename] = image; node.setDirtyCanvas(true); };
                image.onerror = () => { state.thumbnailCache[img.filename] = null; node.setDirtyCanvas(true); };
                image.src = `/imagefolderpicker/thumbnail?folder=${encodeURIComponent(folder)}&filename=${encodeURIComponent(img.filename)}&size=${thumbSize}`;
            }
        };
        
        nodeType.prototype.getLayout = function() {
            // Calculate layout dimensions
            const thumbSize = this.thumbnailSize || DEFAULT_THUMBNAIL_SIZE;
            const outputH = (this.outputs?.length || 0) * 20 + 6;
            const top = 30 + outputH; // Header + outputs
            const contentTop = top + TAB_HEIGHT + PATH_BAR_HEIGHT + CONTROLS_HEIGHT;
            const navY = this.size[1] - NAV_HEIGHT - 4;
            const galleryHeight = navY - contentTop - 8;
            
            const w = this.size[0] - 16;
            const cols = Math.max(1, Math.floor(w / (thumbSize + THUMBNAIL_PADDING)));
            const rows = Math.max(1, Math.floor(galleryHeight / (thumbSize + THUMBNAIL_PADDING)));
            const perPage = cols * rows;
            
            const state = this.getState();
            const total = state.images?.length || 0;
            const pages = Math.max(1, Math.ceil(total / perPage));
            
            return { top, contentTop, navY, galleryHeight, cols, rows, perPage, pages, w, thumbSize };
        };
        
        // Drawing
        const origDraw = nodeType.prototype.onDrawForeground;
        nodeType.prototype.onDrawForeground = function(ctx) {
            origDraw?.apply(this, arguments);
            if (this.flags.collapsed) return;
            
            const L = this.getLayout();
            const state = this.getState();
            
            // === TABS ===
            const tabW = (this.size[0] - 16) / 3;
            this._tabs = [];
            for (let i = 0; i < 3; i++) {
                const x = 8 + i * tabW;
                const y = L.top;
                this._tabs.push({ x, y, w: tabW - 2, h: TAB_HEIGHT - 2 });
                
                ctx.fillStyle = i === this.activeTab ? "#3a5070" : "#282828";
                ctx.fillRect(x, y, tabW - 2, TAB_HEIGHT - 2);
                
                if (i === this.activeTab) {
                    ctx.strokeStyle = "#5090d0";
                    ctx.lineWidth = 2;
                    ctx.strokeRect(x, y, tabW - 2, TAB_HEIGHT - 2);
                }
                
                const hasImg = this.tabState[i].selectedIndex >= 0;
                ctx.fillStyle = i === this.activeTab ? "#fff" : "#999";
                ctx.font = "12px Arial";
                ctx.textAlign = "center";
                ctx.fillText(hasImg ? `Tab ${i+1} ✓` : `Tab ${i+1}`, x + tabW/2 - 1, y + 17);
            }
            
            // === FOLDER INPUT + LOAD BUTTON ===
            const ctrlY = L.top + TAB_HEIGHT + 4;
            const inputW = this.size[0] - 80;
            const btnW = 50;
            
            this._inputRect = { x: 8, y: ctrlY, w: inputW - 8, h: 22 };
            this._loadBtn = { x: inputW + 4, y: ctrlY, w: btnW, h: 22 };
            
            // Input bg
            ctx.fillStyle = "#222";
            ctx.fillRect(this._inputRect.x, this._inputRect.y, this._inputRect.w, this._inputRect.h);
            ctx.strokeStyle = "#444";
            ctx.lineWidth = 1;
            ctx.strokeRect(this._inputRect.x, this._inputRect.y, this._inputRect.w, this._inputRect.h);
            
            // Folder path (check connected input first)
            const folder = this.getFolderPath(this.activeTab);
            ctx.fillStyle = folder ? "#ccc" : "#666";
            ctx.font = "11px Arial";
            ctx.textAlign = "left";
            let txt = folder || "Click to set folder...";
            const maxTxtW = this._inputRect.w - 8;
            while (ctx.measureText(txt).width > maxTxtW && txt.length > 5) {
                txt = "..." + txt.slice(4);
            }
            ctx.fillText(txt, this._inputRect.x + 4, this._inputRect.y + 15);
            
            // Load button
            ctx.fillStyle = "#4a6f9a";
            ctx.fillRect(this._loadBtn.x, this._loadBtn.y, this._loadBtn.w, this._loadBtn.h);
            ctx.fillStyle = "#fff";
            ctx.textAlign = "center";
            ctx.fillText("Load", this._loadBtn.x + this._loadBtn.w/2, this._loadBtn.y + 15);
            
            // === PATH BAR WITH SORTING + SIZE ===
            const pathBarY = L.top + TAB_HEIGHT + CONTROLS_HEIGHT + 4;
            const sortOrder = state.sortOrder || 'name';
            
            // Sort by Name button (Az)
            const sortBtnW = 28;
            this._sortNameBtn = { x: 8, y: pathBarY, w: sortBtnW, h: 20 };
            ctx.fillStyle = sortOrder === 'name' ? "#4a6f9a" : "#333";
            ctx.fillRect(this._sortNameBtn.x, this._sortNameBtn.y, this._sortNameBtn.w, this._sortNameBtn.h);
            ctx.strokeStyle = sortOrder === 'name' ? "#6a9fca" : "#555";
            ctx.lineWidth = 1;
            ctx.strokeRect(this._sortNameBtn.x, this._sortNameBtn.y, this._sortNameBtn.w, this._sortNameBtn.h);
            ctx.fillStyle = sortOrder === 'name' ? "#fff" : "#999";
            ctx.font = "10px Arial";
            ctx.textAlign = "center";
            ctx.fillText("Az", this._sortNameBtn.x + sortBtnW/2, this._sortNameBtn.y + 14);
            
            // Sort by Date Desc button (newest first)
            this._sortDateDescBtn = { x: 8 + sortBtnW + 4, y: pathBarY, w: sortBtnW, h: 20 };
            ctx.fillStyle = sortOrder === 'date_desc' ? "#4a6f9a" : "#333";
            ctx.fillRect(this._sortDateDescBtn.x, this._sortDateDescBtn.y, this._sortDateDescBtn.w, this._sortDateDescBtn.h);
            ctx.strokeStyle = sortOrder === 'date_desc' ? "#6a9fca" : "#555";
            ctx.strokeRect(this._sortDateDescBtn.x, this._sortDateDescBtn.y, this._sortDateDescBtn.w, this._sortDateDescBtn.h);
            ctx.fillStyle = sortOrder === 'date_desc' ? "#fff" : "#999";
            ctx.fillText("📅↓", this._sortDateDescBtn.x + sortBtnW/2, this._sortDateDescBtn.y + 14);
            
            // Sort by Date Asc button (oldest first)
            this._sortDateAscBtn = { x: 8 + (sortBtnW + 4) * 2, y: pathBarY, w: sortBtnW, h: 20 };
            ctx.fillStyle = sortOrder === 'date_asc' ? "#4a6f9a" : "#333";
            ctx.fillRect(this._sortDateAscBtn.x, this._sortDateAscBtn.y, this._sortDateAscBtn.w, this._sortDateAscBtn.h);
            ctx.strokeStyle = sortOrder === 'date_asc' ? "#6a9fca" : "#555";
            ctx.strokeRect(this._sortDateAscBtn.x, this._sortDateAscBtn.y, this._sortDateAscBtn.w, this._sortDateAscBtn.h);
            ctx.fillStyle = sortOrder === 'date_asc' ? "#fff" : "#999";
            ctx.fillText("📅↑", this._sortDateAscBtn.x + sortBtnW/2, this._sortDateAscBtn.y + 14);
            
            // Thumbnail size selector (dropdown-like button)
            const thumbSize = this.thumbnailSize || DEFAULT_THUMBNAIL_SIZE;
            const sizeBtnW = 50;
            this._thumbSizeBtn = { x: this.size[0] - sizeBtnW - 12, y: pathBarY, w: sizeBtnW, h: 20 };
            ctx.fillStyle = "#333";
            ctx.fillRect(this._thumbSizeBtn.x, this._thumbSizeBtn.y, this._thumbSizeBtn.w, this._thumbSizeBtn.h);
            ctx.strokeStyle = "#555";
            ctx.strokeRect(this._thumbSizeBtn.x, this._thumbSizeBtn.y, this._thumbSizeBtn.w, this._thumbSizeBtn.h);
            ctx.fillStyle = "#ccc";
            ctx.font = "10px Arial";
            ctx.textAlign = "center";
            ctx.fillText(`${thumbSize}px`, this._thumbSizeBtn.x + sizeBtnW/2, this._thumbSizeBtn.y + 14);
            
            // === GALLERY ===
            ctx.fillStyle = "#1a1a1a";
            ctx.fillRect(8, L.contentTop, this.size[0] - 16, L.galleryHeight);
            
            if (state.isLoading) {
                ctx.fillStyle = "#888";
                ctx.font = "13px Arial";
                ctx.textAlign = "center";
                ctx.fillText("Loading...", this.size[0]/2, L.contentTop + 40);
            } else if (!state.images || state.images.length === 0) {
                ctx.fillStyle = "#666";
                ctx.font = "12px Arial";
                ctx.textAlign = "center";
                ctx.fillText("No images", this.size[0]/2, L.contentTop + 40);
            } else {
                // Clamp page
                if (state.currentPage >= L.pages) state.currentPage = L.pages - 1;
                if (state.currentPage < 0) state.currentPage = 0;
                
                const start = state.currentPage * L.perPage;
                const end = Math.min(start + L.perPage, state.images.length);
                
                for (let i = start; i < end; i++) {
                    const pi = i - start;
                    const col = pi % L.cols;
                    const row = Math.floor(pi / L.cols);
                    const x = 8 + THUMBNAIL_PADDING + col * (L.thumbSize + THUMBNAIL_PADDING);
                    const y = L.contentTop + THUMBNAIL_PADDING + row * (L.thumbSize + THUMBNAIL_PADDING);
                    
                    // Selection
                    if (i === state.selectedIndex) {
                        ctx.fillStyle = "#4a9eff";
                        ctx.fillRect(x - 3, y - 3, L.thumbSize + 6, L.thumbSize + 6);
                    }
                    
                    ctx.fillStyle = "#333";
                    ctx.fillRect(x, y, L.thumbSize, L.thumbSize);
                    
                    const thumb = state.thumbnailCache[state.images[i].filename];
                    if (thumb && thumb !== false) {
                        const scale = Math.min(L.thumbSize / thumb.width, L.thumbSize / thumb.height);
                        const tw = thumb.width * scale;
                        const th = thumb.height * scale;
                        ctx.drawImage(thumb, x + (L.thumbSize - tw)/2, y + (L.thumbSize - th)/2, tw, th);
                    } else if (thumb === null) {
                        ctx.fillStyle = "#500";
                        ctx.fillRect(x, y, L.thumbSize, L.thumbSize);
                    }
                }
            }
            
            // === NAVIGATION ===
            const cx = this.size[0] / 2;
            this._prevBtn = { x: cx - 60, y: L.navY, w: 28, h: 22 };
            this._nextBtn = { x: cx + 32, y: L.navY, w: 28, h: 22 };
            
            const canPrev = state.currentPage > 0;
            const canNext = state.currentPage < L.pages - 1;
            
            ctx.fillStyle = canPrev ? "#444" : "#2a2a2a";
            ctx.fillRect(this._prevBtn.x, this._prevBtn.y, this._prevBtn.w, this._prevBtn.h);
            ctx.fillStyle = canPrev ? "#fff" : "#555";
            ctx.font = "14px Arial";
            ctx.textAlign = "center";
            ctx.fillText("◀", this._prevBtn.x + 14, this._prevBtn.y + 16);
            
            ctx.fillStyle = "#aaa";
            ctx.font = "11px Arial";
            ctx.fillText(`${state.currentPage + 1}/${L.pages}`, cx, L.navY + 15);
            
            ctx.fillStyle = canNext ? "#444" : "#2a2a2a";
            ctx.fillRect(this._nextBtn.x, this._nextBtn.y, this._nextBtn.w, this._nextBtn.h);
            ctx.fillStyle = canNext ? "#fff" : "#555";
            ctx.font = "14px Arial";
            ctx.fillText("▶", this._nextBtn.x + 14, this._nextBtn.y + 16);
            
            // Image count
            ctx.fillStyle = "#666";
            ctx.font = "10px Arial";
            ctx.textAlign = "right";
            ctx.fillText(`${state.images?.length || 0} imgs`, this.size[0] - 10, L.navY + 15);
        };
        
        // Mouse handling
        const origMouse = nodeType.prototype.onMouseDown;
        nodeType.prototype.onMouseDown = function(e, pos, canvas) {
            if (this.flags.collapsed) return origMouse?.apply(this, arguments);
            
            const [x, y] = pos;
            const L = this.getLayout();
            const state = this.getState();
            
            // Tab clicks
            if (this._tabs) {
                for (let i = 0; i < 3; i++) {
                    const t = this._tabs[i];
                    if (x >= t.x && x <= t.x + t.w && y >= t.y && y <= t.y + t.h) {
                        this.activeTab = i;
                        this.setDirtyCanvas(true);
                        return true;
                    }
                }
            }
            
            // Input click
            if (this._inputRect) {
                const r = this._inputRect;
                if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) {
                    const fw = this.folderWidgets?.[this.activeTab];
                    const val = prompt("Enter folder path:", fw?.value || "");
                    if (val !== null && fw) {
                        fw.value = val;
                        this.setDirtyCanvas(true);
                    }
                    return true;
                }
            }
            
            // Load button
            if (this._loadBtn) {
                const r = this._loadBtn;
                if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) {
                    this.loadImages(this.activeTab);
                    return true;
                }
            }
            
            // Sort buttons
            if (this._sortNameBtn) {
                const r = this._sortNameBtn;
                if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) {
                    if (state.sortOrder !== 'name') {
                        state.sortOrder = 'name';
                        this.loadImages(this.activeTab);
                    }
                    return true;
                }
            }
            if (this._sortDateDescBtn) {
                const r = this._sortDateDescBtn;
                if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) {
                    if (state.sortOrder !== 'date_desc') {
                        state.sortOrder = 'date_desc';
                        this.loadImages(this.activeTab);
                    }
                    return true;
                }
            }
            if (this._sortDateAscBtn) {
                const r = this._sortDateAscBtn;
                if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) {
                    if (state.sortOrder !== 'date_asc') {
                        state.sortOrder = 'date_asc';
                        this.loadImages(this.activeTab);
                    }
                    return true;
                }
            }
            
            // Thumbnail size button - cycle through sizes
            if (this._thumbSizeBtn) {
                const r = this._thumbSizeBtn;
                if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) {
                    const currentIdx = THUMBNAIL_SIZES.indexOf(this.thumbnailSize);
                    const nextIdx = (currentIdx + 1) % THUMBNAIL_SIZES.length;
                    this.thumbnailSize = THUMBNAIL_SIZES[nextIdx];
                    // Clear all thumbnail caches to reload with new size
                    for (let i = 0; i < 3; i++) {
                        this.tabState[i].thumbnailCache = {};
                        if (this.tabState[i].images.length > 0) {
                            this.loadThumbnails(i);
                        }
                    }
                    this.setDirtyCanvas(true);
                    return true;
                }
            }
            
            // Prev/Next
            if (this._prevBtn) {
                const r = this._prevBtn;
                if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) {
                    if (state.currentPage > 0) { state.currentPage--; this.setDirtyCanvas(true); }
                    return true;
                }
            }
            if (this._nextBtn) {
                const r = this._nextBtn;
                if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) {
                    if (state.currentPage < L.pages - 1) { state.currentPage++; this.setDirtyCanvas(true); }
                    return true;
                }
            }
            
            // Thumbnail clicks
            if (y >= L.contentTop && y < L.navY && state.images?.length > 0) {
                const start = state.currentPage * L.perPage;
                const end = Math.min(start + L.perPage, state.images.length);
                
                for (let i = start; i < end; i++) {
                    const pi = i - start;
                    const col = pi % L.cols;
                    const row = Math.floor(pi / L.cols);
                    const tx = 8 + THUMBNAIL_PADDING + col * (L.thumbSize + THUMBNAIL_PADDING);
                    const ty = L.contentTop + THUMBNAIL_PADDING + row * (L.thumbSize + THUMBNAIL_PADDING);
                    
                    if (x >= tx && x <= tx + L.thumbSize && y >= ty && y <= ty + L.thumbSize) {
                        state.selectedIndex = i;
                        const fn = state.images[i].filename;
                        const sw = this.selectedWidgets?.[this.activeTab];
                        if (sw) sw.value = fn;
                        this.setDirtyCanvas(true);
                        this.graph?.change();
                        return true;
                    }
                }
                return true;
            }
            
            return origMouse?.apply(this, arguments);
        };
        
        // Double-click handler for preview mode
        const origDblClick = nodeType.prototype.onDblClick;
        nodeType.prototype.onDblClick = function(e, pos, canvas) {
            if (this.flags.collapsed) return origDblClick?.apply(this, arguments);
            
            const [x, y] = pos;
            const L = this.getLayout();
            const state = this.getState();
            
            // Check if double-click is on a thumbnail
            if (y >= L.contentTop && y < L.navY && state.images?.length > 0) {
                const start = state.currentPage * L.perPage;
                const end = Math.min(start + L.perPage, state.images.length);
                
                for (let i = start; i < end; i++) {
                    const pi = i - start;
                    const col = pi % L.cols;
                    const row = Math.floor(pi / L.cols);
                    const tx = 8 + THUMBNAIL_PADDING + col * (L.thumbSize + THUMBNAIL_PADDING);
                    const ty = L.contentTop + THUMBNAIL_PADDING + row * (L.thumbSize + THUMBNAIL_PADDING);
                    
                    if (x >= tx && x <= tx + L.thumbSize && y >= ty && y <= ty + L.thumbSize) {
                        // Show preview using DOM overlay
                        const folder = this.getFolderPath(this.activeTab);
                        const filename = state.images[i].filename;
                        if (folder && filename) {
                            const imageSrc = `/imagefolderpicker/thumbnail?folder=${encodeURIComponent(folder)}&filename=${encodeURIComponent(filename)}&size=512`;
                            showPreviewOverlay(imageSrc, filename, () => {
                                // Callback when closed - nothing needed
                            });
                        }
                        return true;
                    }
                }
            }
            
            return origDblClick?.apply(this, arguments);
        };
        
        // Mouse wheel
        const origWheel = nodeType.prototype.onMouseWheel;
        nodeType.prototype.onMouseWheel = function(e, pos) {
            if (this.flags.collapsed) return;
            
            const L = this.getLayout();
            const state = this.getState();
            const y = pos[1];
            
            if (y >= L.contentTop && y < L.navY && state.images?.length > 0 && L.pages > 1) {
                const d = e.deltaY > 0 ? 1 : -1;
                state.currentPage = Math.max(0, Math.min(L.pages - 1, state.currentPage + d));
                this.setDirtyCanvas(true);
                e.stopPropagation?.();
                e.preventDefault?.();
                e.stopped = true;
                return true;
            }
            
            return origWheel?.apply(this, arguments);
        };
        
        // Serialize
        const origSer = nodeType.prototype.onSerialize;
        nodeType.prototype.onSerialize = function(o) {
            origSer?.apply(this, arguments);
            o.ifp_tab = this.activeTab;
            o.ifp_thumbSize = this.thumbnailSize;
            o.ifp_states = this.tabState.map(s => ({ 
                sel: s.selectedIndex, 
                page: s.currentPage,
                sort: s.sortOrder 
            }));
        };
        
        // Configure
        const origConf = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function(o) {
            origConf?.apply(this, arguments);
            this.activeTab = o.ifp_tab ?? 0;
            this.thumbnailSize = o.ifp_thumbSize ?? DEFAULT_THUMBNAIL_SIZE;
            if (o.ifp_states) {
                for (let i = 0; i < 3; i++) {
                    if (o.ifp_states[i]) {
                        this.tabState[i].selectedIndex = o.ifp_states[i].sel ?? -1;
                        this.tabState[i].currentPage = o.ifp_states[i].page ?? 0;
                        this.tabState[i].sortOrder = o.ifp_states[i].sort ?? 'name';
                    }
                }
            }
            setTimeout(() => this.setupWidgets(), 100);
        };
    }
});

console.log("[ImageFolderPicker] Extension registered");
