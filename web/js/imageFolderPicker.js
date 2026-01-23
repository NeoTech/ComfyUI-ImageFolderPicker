/**
 * Image Folder Picker - Frontend Extension for ComfyUI
 * Displays folder images as selectable thumbnails with 3 tabs
 */

import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

console.log("[ImageFolderPicker] Extension loading...");

const THUMBNAIL_SIZE = 80;
const THUMBNAIL_PADDING = 6;
const TAB_HEIGHT = 26;
const NAV_HEIGHT = 26;
const CONTROLS_HEIGHT = 30;

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
            
            // State for each tab
            this.tabState = [
                { images: [], thumbnailCache: {}, selectedIndex: -1, currentPage: 0, isLoading: false },
                { images: [], thumbnailCache: {}, selectedIndex: -1, currentPage: 0, isLoading: false },
                { images: [], thumbnailCache: {}, selectedIndex: -1, currentPage: 0, isLoading: false }
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
        
        nodeType.prototype.loadImages = async function(tabIdx) {
            const folder = this.folderWidgets?.[tabIdx]?.value;
            const state = this.tabState[tabIdx];
            
            if (!folder) {
                state.images = [];
                this.setDirtyCanvas(true);
                return;
            }
            
            state.isLoading = true;
            state.currentPage = 0;
            this.setDirtyCanvas(true);
            
            try {
                const resp = await api.fetchApi(`/imagefolderpicker/list?folder=${encodeURIComponent(folder)}`);
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
            const folder = this.folderWidgets?.[tabIdx]?.value;
            const state = this.tabState[tabIdx];
            if (!folder) return;
            
            const node = this;
            for (const img of state.images) {
                if (state.thumbnailCache[img.filename] !== undefined) continue;
                state.thumbnailCache[img.filename] = false;
                
                const image = new Image();
                image.onload = () => { state.thumbnailCache[img.filename] = image; node.setDirtyCanvas(true); };
                image.onerror = () => { state.thumbnailCache[img.filename] = null; node.setDirtyCanvas(true); };
                image.src = `/imagefolderpicker/thumbnail?folder=${encodeURIComponent(folder)}&filename=${encodeURIComponent(img.filename)}`;
            }
        };
        
        nodeType.prototype.getLayout = function() {
            // Calculate layout dimensions
            const outputH = (this.outputs?.length || 0) * 20 + 6;
            const top = 30 + outputH; // Header + outputs
            const contentTop = top + TAB_HEIGHT + CONTROLS_HEIGHT;
            const navY = this.size[1] - NAV_HEIGHT - 4;
            const galleryHeight = navY - contentTop - 8;
            
            const w = this.size[0] - 16;
            const cols = Math.max(1, Math.floor(w / (THUMBNAIL_SIZE + THUMBNAIL_PADDING)));
            const rows = Math.max(1, Math.floor(galleryHeight / (THUMBNAIL_SIZE + THUMBNAIL_PADDING)));
            const perPage = cols * rows;
            
            const state = this.getState();
            const total = state.images?.length || 0;
            const pages = Math.max(1, Math.ceil(total / perPage));
            
            return { top, contentTop, navY, galleryHeight, cols, rows, perPage, pages, w };
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
            
            // Folder path
            const folder = this.folderWidgets?.[this.activeTab]?.value || "";
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
                    const x = 8 + THUMBNAIL_PADDING + col * (THUMBNAIL_SIZE + THUMBNAIL_PADDING);
                    const y = L.contentTop + THUMBNAIL_PADDING + row * (THUMBNAIL_SIZE + THUMBNAIL_PADDING);
                    
                    // Selection
                    if (i === state.selectedIndex) {
                        ctx.fillStyle = "#4a9eff";
                        ctx.fillRect(x - 3, y - 3, THUMBNAIL_SIZE + 6, THUMBNAIL_SIZE + 6);
                    }
                    
                    ctx.fillStyle = "#333";
                    ctx.fillRect(x, y, THUMBNAIL_SIZE, THUMBNAIL_SIZE);
                    
                    const thumb = state.thumbnailCache[state.images[i].filename];
                    if (thumb && thumb !== false) {
                        const scale = Math.min(THUMBNAIL_SIZE / thumb.width, THUMBNAIL_SIZE / thumb.height);
                        const tw = thumb.width * scale;
                        const th = thumb.height * scale;
                        ctx.drawImage(thumb, x + (THUMBNAIL_SIZE - tw)/2, y + (THUMBNAIL_SIZE - th)/2, tw, th);
                    } else if (thumb === null) {
                        ctx.fillStyle = "#500";
                        ctx.fillRect(x, y, THUMBNAIL_SIZE, THUMBNAIL_SIZE);
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
                    const tx = 8 + THUMBNAIL_PADDING + col * (THUMBNAIL_SIZE + THUMBNAIL_PADDING);
                    const ty = L.contentTop + THUMBNAIL_PADDING + row * (THUMBNAIL_SIZE + THUMBNAIL_PADDING);
                    
                    if (x >= tx && x <= tx + THUMBNAIL_SIZE && y >= ty && y <= ty + THUMBNAIL_SIZE) {
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
            o.ifp_states = this.tabState.map(s => ({ sel: s.selectedIndex, page: s.currentPage }));
        };
        
        // Configure
        const origConf = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function(o) {
            origConf?.apply(this, arguments);
            this.activeTab = o.ifp_tab ?? 0;
            if (o.ifp_states) {
                for (let i = 0; i < 3; i++) {
                    if (o.ifp_states[i]) {
                        this.tabState[i].selectedIndex = o.ifp_states[i].sel ?? -1;
                        this.tabState[i].currentPage = o.ifp_states[i].page ?? 0;
                    }
                }
            }
            setTimeout(() => this.setupWidgets(), 100);
        };
    }
});

console.log("[ImageFolderPicker] Extension registered");
