/**
 * Image Folder Picker - Frontend Extension for ComfyUI
 * Displays folder images as selectable thumbnails with 3 tabs
 */

import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

// Pause folder watching during workflow execution
let _executionInProgress = false;

// Helper to redraw all ImageFolderPicker nodes
function _redrawAllIFPNodes() {
    for (const node of app.graph?._nodes || []) {
        if (node.type === "ImageFolderPicker") {
            node.setDirtyCanvas(true);
        }
    }
}

api.addEventListener("execution_start", async () => {
    _executionInProgress = true;
    _redrawAllIFPNodes();
    try {
        await api.fetchApi("/imagefolderpicker/pause", { method: "POST" });
    } catch (e) { /* ignore */ }
});

api.addEventListener("executing", async (event) => {
    // When node_id is null, execution has finished
    if (event.detail === null && _executionInProgress) {
        _executionInProgress = false;
        _redrawAllIFPNodes();
        try {
            await api.fetchApi("/imagefolderpicker/resume", { method: "POST" });
        } catch (e) { /* ignore */ }
    }
});

// Listen for folder change events from Python (via WebSocket)
api.addEventListener("imagefolderpicker.folder_changed", (event) => {
    const changedFolder = event.detail?.folder;
    if (!changedFolder) return;
    
    // Find all ImageFolderPicker nodes and refresh those watching this folder
    for (const node of app.graph._nodes || []) {
        if (node.type !== "ImageFolderPicker") continue;
        
        for (let i = 0; i < 5; i++) {
            try {
                const watchedFolder = node.getFolderPath?.(i);
                // Normalize paths for comparison (handle slashes)
                const normalizedWatched = watchedFolder?.replace(/\\/g, '/').toLowerCase() || '';
                const normalizedChanged = changedFolder.replace(/\\/g, '/').toLowerCase();
                
                if (normalizedWatched === normalizedChanged) {
                    node.loadImages(i);
                }
            } catch (e) {
                // Ignore errors for nodes that aren't fully initialized
            }
        }
    }
});

// Thumbnail size options
const THUMBNAIL_SIZES = [64, 128, 192, 256, 320];
const DEFAULT_THUMBNAIL_SIZE = 128;

const THUMBNAIL_PADDING = 6;
const TAB_HEIGHT = 26;
const NAV_HEIGHT = 40; // Height for navigation area (buttons are 36px tall)
const CONTROLS_HEIGHT = 30;
const PATH_BAR_HEIGHT = 26;
const INFO_HEIGHT = 24; // Height for filename + resolution text below thumbnail

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
        <div style="background: repeating-conic-gradient(#999 0% 25%, #ccc 0% 50%) 50% / 20px 20px;
                    border: 3px solid #4a9eff; border-radius: 4px; display: inline-block;
                    max-width: 90vw; max-height: 90vh;">
            <img src="${imageSrc}" style="max-width: 90vw; max-height: 90vh; object-fit: contain; 
                 display: block;" />
        </div>
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

// Delete confirmation modal
let deleteConfirmOverlay = null;

function showDeleteConfirmation(filename, onConfirm, onCancel) {
    // Create overlay if doesn't exist
    if (!deleteConfirmOverlay) {
        deleteConfirmOverlay = document.createElement('div');
        deleteConfirmOverlay.id = 'ifp-delete-confirm-overlay';
        deleteConfirmOverlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100vw;
            height: 100vh;
            background: rgba(0, 0, 0, 0.85);
            z-index: 99999;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
        `;
        document.body.appendChild(deleteConfirmOverlay);
    }
    
    deleteConfirmOverlay.innerHTML = `
        <div style="background: #2a2020; border: 2px solid #c44; border-radius: 8px; padding: 24px 32px;
                    max-width: 400px; text-align: center; font-family: Arial, sans-serif;">
            <div style="font-size: 48px; margin-bottom: 16px;">🗑️</div>
            <div style="color: #ff6666; font-size: 18px; font-weight: bold; margin-bottom: 12px;">
                Delete File?
            </div>
            <div style="color: #ccc; font-size: 14px; margin-bottom: 8px; word-break: break-all;">
                ${filename}
            </div>
            <div style="color: #f88; font-size: 13px; margin-bottom: 24px;">
                ⚠️ This action cannot be undone!
            </div>
            <div style="display: flex; gap: 16px; justify-content: center;">
                <button id="ifp-delete-cancel" style="padding: 10px 24px; font-size: 14px; cursor: pointer;
                        background: #444; color: #ccc; border: 1px solid #666; border-radius: 4px;">
                    Cancel
                </button>
                <button id="ifp-delete-confirm" style="padding: 10px 24px; font-size: 14px; cursor: pointer;
                        background: #a33; color: #fff; border: 1px solid #c44; border-radius: 4px;
                        font-weight: bold;">
                    Delete
                </button>
            </div>
        </div>
    `;
    
    deleteConfirmOverlay.style.display = 'flex';
    
    const cleanup = () => {
        deleteConfirmOverlay.style.display = 'none';
        document.removeEventListener('keydown', keyHandler);
    };
    
    const keyHandler = (e) => {
        if (e.key === 'Escape') {
            cleanup();
            onCancel?.();
        }
    };
    
    document.getElementById('ifp-delete-cancel').onclick = () => {
        cleanup();
        onCancel?.();
    };
    
    document.getElementById('ifp-delete-confirm').onclick = () => {
        cleanup();
        onConfirm?.();
    };
    
    document.addEventListener('keydown', keyHandler);
}

app.registerExtension({
    name: "Comfy.ImageFolderPicker",
    
    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        if (nodeData.name !== "ImageFolderPicker") return;
        
        const onNodeCreated = nodeType.prototype.onNodeCreated;
        
        nodeType.prototype.onNodeCreated = function() {
            const result = onNodeCreated?.apply(this, arguments);
            
            // Current active tab (0, 1, 2)
            this.activeTab = 0;
            
            // Thumbnail size (global setting)
            this.thumbnailSize = DEFAULT_THUMBNAIL_SIZE;
            
            // Hide folder navigation toggle
            this.hideFolders = false;
            
            // Size picker menu state
            this.showSizeMenu = false;
            
            // State for each tab
            this.tabState = [
                { images: [], subfolders: [], parentFolder: '', thumbnailCache: {}, selectedIndex: -1, currentPage: 0, isLoading: false, sortOrder: 'name', folderOverride: '' },
                { images: [], subfolders: [], parentFolder: '', thumbnailCache: {}, selectedIndex: -1, currentPage: 0, isLoading: false, sortOrder: 'name', folderOverride: '' },
                { images: [], subfolders: [], parentFolder: '', thumbnailCache: {}, selectedIndex: -1, currentPage: 0, isLoading: false, sortOrder: 'name', folderOverride: '' },
                { images: [], subfolders: [], parentFolder: '', thumbnailCache: {}, selectedIndex: -1, currentPage: 0, isLoading: false, sortOrder: 'name', folderOverride: '' },
                { images: [], subfolders: [], parentFolder: '', thumbnailCache: {}, selectedIndex: -1, currentPage: 0, isLoading: false, sortOrder: 'name', folderOverride: '' }
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
                this.widgets?.find(w => w.name === "folder3"),
                this.widgets?.find(w => w.name === "folder4"),
                this.widgets?.find(w => w.name === "folder5")
            ];
            
            this.selectedWidgets = [
                this.widgets?.find(w => w.name === "selected_image1"),
                this.widgets?.find(w => w.name === "selected_image2"),
                this.widgets?.find(w => w.name === "selected_image3"),
                this.widgets?.find(w => w.name === "selected_image4"),
                this.widgets?.find(w => w.name === "selected_image5")
            ];
            
            // Store references to folderOverride widgets (for syncing with tabState.folderOverride)
            this.folderOverrideWidgets = [
                this.widgets?.find(w => w.name === "folderOverride1"),
                this.widgets?.find(w => w.name === "folderOverride2"),
                this.widgets?.find(w => w.name === "folderOverride3"),
                this.widgets?.find(w => w.name === "folderOverride4"),
                this.widgets?.find(w => w.name === "folderOverride5")
            ];
            
            // Hide all widgets visually - we draw our own UI
            // IMPORTANT: Don't change w.type to "hidden" as that prevents serialization!
            if (this.widgets) {
                for (const w of this.widgets) {
                    w.computeSize = () => [0, -4];
                    w.computedHeight = 0;
                }
            }
            
            this.setDirtyCanvas(true);
        };
        
        // Handle connection changes - auto-load when folder input gets connected
        const origOnConnectionsChange = nodeType.prototype.onConnectionsChange;
        nodeType.prototype.onConnectionsChange = function(type, slotIndex, isConnected, link, ioSlot) {
            origOnConnectionsChange?.apply(this, arguments);
            
            // Check if this is an input connection (type 1 = input)
            if (type === 1 && isConnected && ioSlot?.name) {
                // Check if it's a folder input
                const match = ioSlot.name.match(/^folder(\d+)_input$/);
                if (match) {
                    const tabIdx = parseInt(match[1]) - 1;
                    // Clear folder override and load after a short delay (let connection settle)
                    setTimeout(() => {
                        const state = this.tabState[tabIdx];
                        if (state) {
                            state.folderOverride = '';
                            const fow = this.folderOverrideWidgets?.[tabIdx];
                            if (fow) fow.value = '';
                        }
                        this.loadImages(tabIdx);
                    }, 100);
                }
            }
        };
        
        nodeType.prototype.getState = function() {
            return this.tabState?.[this.activeTab] || { images: [], thumbnailCache: {}, selectedIndex: -1, currentPage: 0, isLoading: false };
        };
        
        // Helper to get folder path - checks folderOverride first (for subfolder navigation), then connected input, then widget value
        // Helper function to extract string value from a node
        function getNodeStringValue(node, slotIdx) {
            if (!node) return null;
            
            // Try to get the output value - check widgets first
            // For String/primitive nodes, look for a value widget
            const valueWidget = node.widgets?.find(w => 
                w.name === "value" || w.name === "text" || w.name === "string"
            );
            if (valueWidget?.value) {
                return valueWidget.value;
            }
            
            // Also check if origin node has getOutputData (executed value)
            if (typeof node.getOutputData === 'function') {
                const data = node.getOutputData(slotIdx);
                if (data) return data;
            }
            
            return null;
        }
        
        // Helper function to trace value through a subgraph's output
        function getSubgraphOutputValue(subgraphNode, outputSlotIdx) {
            // Check if this is actually a subgraph node
            if (!subgraphNode?.isSubgraphNode?.() || !subgraphNode.subgraph) {
                return null;
            }
            
            const subgraph = subgraphNode.subgraph;
            
            // Try to find the subgraph's output definition for this slot
            // Subgraph outputs have linkIds that point to internal links
            const subgraphOutput = subgraph.outputs?.[outputSlotIdx];
            
            if (subgraphOutput?.linkIds?.length > 0) {
                // Find the internal link that feeds this output
                const internalLinkId = subgraphOutput.linkIds[0];
                const internalLink = subgraph.links?.[internalLinkId] || 
                                     subgraph._links?.get?.(internalLinkId);
                
                if (internalLink) {
                    // Get the internal node that provides this output
                    const internalOriginNode = subgraph.getNodeById?.(internalLink.origin_id);
                    if (internalOriginNode) {
                        // Recursively check if it's also a subgraph
                        if (internalOriginNode.isSubgraphNode?.()) {
                            return getSubgraphOutputValue(internalOriginNode, internalLink.origin_slot);
                        }
                        return getNodeStringValue(internalOriginNode, internalLink.origin_slot);
                    }
                }
            }
            
            // Alternative approach: Find the SubgraphOutput node for this specific slot
            // and trace back from there
            if (subgraph.nodes) {
                for (const internalNode of subgraph.nodes) {
                    const nodeType = internalNode.type?.toLowerCase() || '';
                    
                    // Find the SubgraphOutput node that corresponds to our output slot
                    if (nodeType.includes('subgraphoutput') || nodeType.includes('graph/output')) {
                        // Check if this output node's slot index matches
                        const slotProperty = internalNode.properties?.slot ?? internalNode.properties?.index;
                        if (slotProperty === outputSlotIdx) {
                            // Trace back through the input of this SubgraphOutput node
                            if (internalNode.inputs?.[0]?.link != null) {
                                const linkId = internalNode.inputs[0].link;
                                const link = subgraph.links?.[linkId] || subgraph._links?.get?.(linkId);
                                if (link) {
                                    const sourceNode = subgraph.getNodeById?.(link.origin_id);
                                    if (sourceNode) {
                                        if (sourceNode.isSubgraphNode?.()) {
                                            return getSubgraphOutputValue(sourceNode, link.origin_slot);
                                        }
                                        return getNodeStringValue(sourceNode, link.origin_slot);
                                    }
                                }
                            }
                        }
                    }
                }
            }
            
            return null;
        }
        
        nodeType.prototype.getFolderPath = function(tabIdx) {
            // Check for folder override (used when navigating into subfolders)
            const state = this.tabState[tabIdx];
            if (state?.folderOverride) {
                return state.folderOverride;
            }
            
            // Check if there's a connected input for this tab
            const inputName = `folder${tabIdx + 1}_input`;
            const inputIdx = this.inputs?.findIndex(inp => inp.name === inputName);
            
            if (inputIdx >= 0 && this.inputs[inputIdx]?.link != null) {
                // There's a connection - get the value from connected node
                const linkId = this.inputs[inputIdx].link;
                const link = app.graph.links[linkId];
                if (link) {
                    // Use resolve() to handle subgraphs/virtual connections properly
                    let originNode = null;
                    let originSlot = link.origin_slot;
                    
                    if (typeof link.resolve === 'function') {
                        // Modern ComfyUI with subgraph support
                        const resolved = link.resolve(app.graph);
                        if (resolved) {
                            // resolved can have subgraphInput (for subgraph inputs) or output (for regular/subgraph outputs)
                            const resolvedInfo = resolved.subgraphInput ?? resolved.output;
                            if (resolvedInfo?.node) {
                                originNode = resolvedInfo.node;
                                // Only use resolvedInfo.slot if it's defined, otherwise keep original link.origin_slot
                                if (resolvedInfo.slot !== undefined) {
                                    originSlot = resolvedInfo.slot;
                                }
                            }
                        }
                    }
                    
                    // Fallback to direct node lookup if resolve didn't work
                    if (!originNode) {
                        originNode = app.graph.getNodeById(link.origin_id);
                    }
                    
                    if (originNode) {
                        // First, check if this is a subgraph node (acting as a storage bin)
                        if (originNode.isSubgraphNode?.()) {
                            const subgraphValue = getSubgraphOutputValue(originNode, originSlot);
                            if (subgraphValue) {
                                return subgraphValue;
                            }
                        }
                        
                        // Regular node - get value directly
                        const value = getNodeStringValue(originNode, originSlot);
                        if (value) {
                            return value;
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
                state.subfolders = [];
                state.parentFolder = '';
                this.setDirtyCanvas(true);
                return;
            }
            
            state.isLoading = true;
            this.setDirtyCanvas(true);
            
            try {
                const resp = await api.fetchApi(`/imagefolderpicker/list?folder=${encodeURIComponent(folder)}&sort=${encodeURIComponent(sortOrder)}`);
                if (resp.ok) {
                    const data = await resp.json();
                    state.images = data.images || [];
                    state.subfolders = data.subfolders || [];
                    state.parentFolder = data.parent || '';
                    state.thumbnailCache = {};
                    
                    // Restore selection if exists and jump to correct page
                    const sel = this.selectedWidgets?.[tabIdx]?.value;
                    if (sel) {
                        const idx = state.images.findIndex(i => i.filename === sel);
                        state.selectedIndex = idx >= 0 ? idx : -1;
                        
                        // Jump to page containing selected image
                        if (idx >= 0) {
                            const L = this.getLayout();
                            const totalFolders = this.hideFolders ? 0 : (state.subfolders?.length || 0);
                            const itemIndex = totalFolders + idx; // Position in combined list
                            state.currentPage = Math.floor(itemIndex / L.perPage);
                        } else {
                            state.currentPage = 0;
                        }
                    } else {
                        state.selectedIndex = -1;
                        state.currentPage = 0;
                    }
                    
                    this.loadThumbnails(tabIdx);
                    
                    // Register this folder for file watching (auto-refresh on changes)
                    this.watchFolder(folder);
                } else {
                    state.images = [];
                    state.subfolders = [];
                }
            } catch (e) {
                console.error("[ImageFolderPicker] Load error:", e);
                state.images = [];
                state.subfolders = [];
            }
            
            state.isLoading = false;
            this.setDirtyCanvas(true);
        };
        
        nodeType.prototype.watchFolder = async function(folder) {
            if (!folder) return;
            
            try {
                await api.fetchApi("/imagefolderpicker/watch", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ folder })
                });
            } catch (e) {
                // Silently fail - watching is optional enhancement
            }
        };
        
        nodeType.prototype.unwatchFolder = async function(folder) {
            if (!folder) return;
            
            try {
                await api.fetchApi("/imagefolderpicker/unwatch", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ folder })
                });
            } catch (e) {
                // Silently fail
            }
        };
        
        nodeType.prototype.deleteImage = async function(folder, filename) {
            if (!folder || !filename) return;
            
            try {
                const resp = await api.fetchApi("/imagefolderpicker/delete", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ folder, filename })
                });
                
                if (resp.ok) {
                    // Clear selection if deleted image was selected
                    const state = this.tabState[this.activeTab];
                    const deletedIdx = state.images.findIndex(img => img.filename === filename);
                    if (deletedIdx === state.selectedIndex) {
                        state.selectedIndex = -1;
                        const sw = this.selectedWidgets?.[this.activeTab];
                        if (sw) sw.value = "";
                    } else if (deletedIdx < state.selectedIndex) {
                        // Adjust selection index if deleted image was before selected
                        state.selectedIndex--;
                    }
                    
                    // Reload images
                    this.loadImages(this.activeTab);
                } else {
                    const data = await resp.json();
                    console.error("[ImageFolderPicker] Delete failed:", data.error);
                }
            } catch (e) {
                console.error("[ImageFolderPicker] Delete error:", e);
            }
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
            const cellHeight = thumbSize + INFO_HEIGHT + THUMBNAIL_PADDING;
            const cols = Math.max(1, Math.floor(w / (thumbSize + THUMBNAIL_PADDING)));
            const rows = Math.max(1, Math.floor(galleryHeight / cellHeight));
            const perPage = cols * rows;
            
            const state = this.getState();
            // Total items = subfolders + images (respect hideFolders setting)
            const totalFolders = this.hideFolders ? 0 : (state.subfolders?.length || 0);
            const totalImages = state.images?.length || 0;
            const totalItems = totalFolders + totalImages;
            const pages = Math.max(1, Math.ceil(totalItems / perPage));
            
            return { top, contentTop, navY, galleryHeight, cols, rows, perPage, pages, w, thumbSize, totalFolders, totalImages, totalItems };
        };
        
        // Drawing
        const origDraw = nodeType.prototype.onDrawForeground;
        nodeType.prototype.onDrawForeground = function(ctx) {
            origDraw?.apply(this, arguments);
            if (this.flags.collapsed) return;
            
            const L = this.getLayout();
            const state = this.getState();
            
            // === TABS ===
            const tabW = (this.size[0] - 16) / 5;
            this._tabs = [];
            for (let i = 0; i < 5; i++) {
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
            
            // "Go Up" button (navigate to parent folder) - only show if folders visible
            const upBtnW = 24;
            if (!this.hideFolders) {
                this._goUpBtn = { x: 8, y: pathBarY, w: upBtnW, h: 20 };
                const hasParent = state.parentFolder && state.parentFolder.length > 0;
                ctx.fillStyle = hasParent ? "#4a5a4a" : "#2a2a2a";
                ctx.fillRect(this._goUpBtn.x, this._goUpBtn.y, this._goUpBtn.w, this._goUpBtn.h);
                ctx.strokeStyle = hasParent ? "#6a8a6a" : "#444";
                ctx.lineWidth = 1;
                ctx.strokeRect(this._goUpBtn.x, this._goUpBtn.y, this._goUpBtn.w, this._goUpBtn.h);
                ctx.fillStyle = hasParent ? "#cfc" : "#666";
                ctx.font = "12px Arial";
                ctx.textAlign = "center";
                ctx.fillText("↑", this._goUpBtn.x + upBtnW/2, this._goUpBtn.y + 15);
            } else {
                this._goUpBtn = null;
            }
            
            // Sort by Name button (Az)
            const sortBtnW = 28;
            const sortStartX = this.hideFolders ? 8 : (8 + upBtnW + 6);
            this._sortNameBtn = { x: sortStartX, y: pathBarY, w: sortBtnW, h: 20 };
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
            this._sortDateDescBtn = { x: sortStartX + sortBtnW + 4, y: pathBarY, w: sortBtnW, h: 20 };
            ctx.fillStyle = sortOrder === 'date_desc' ? "#4a6f9a" : "#333";
            ctx.fillRect(this._sortDateDescBtn.x, this._sortDateDescBtn.y, this._sortDateDescBtn.w, this._sortDateDescBtn.h);
            ctx.strokeStyle = sortOrder === 'date_desc' ? "#6a9fca" : "#555";
            ctx.strokeRect(this._sortDateDescBtn.x, this._sortDateDescBtn.y, this._sortDateDescBtn.w, this._sortDateDescBtn.h);
            ctx.fillStyle = sortOrder === 'date_desc' ? "#fff" : "#999";
            ctx.fillText("📅↓", this._sortDateDescBtn.x + sortBtnW/2, this._sortDateDescBtn.y + 14);
            
            // Sort by Date Asc button (oldest first)
            this._sortDateAscBtn = { x: sortStartX + (sortBtnW + 4) * 2, y: pathBarY, w: sortBtnW, h: 20 };
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
            ctx.fillStyle = this.showSizeMenu ? "#4a4a4a" : "#333";
            ctx.fillRect(this._thumbSizeBtn.x, this._thumbSizeBtn.y, this._thumbSizeBtn.w, this._thumbSizeBtn.h);
            ctx.strokeStyle = this.showSizeMenu ? "#6a9fca" : "#555";
            ctx.strokeRect(this._thumbSizeBtn.x, this._thumbSizeBtn.y, this._thumbSizeBtn.w, this._thumbSizeBtn.h);
            ctx.fillStyle = "#ccc";
            ctx.font = "10px Arial";
            ctx.textAlign = "center";
            ctx.fillText(`${thumbSize}px ▼`, this._thumbSizeBtn.x + sizeBtnW/2, this._thumbSizeBtn.y + 14);
            
            // Folder visibility toggle button (next to size button)
            const folderBtnW = 24;
            this._folderToggleBtn = { x: this._thumbSizeBtn.x - folderBtnW - 6, y: pathBarY, w: folderBtnW, h: 20 };
            ctx.fillStyle = this.hideFolders ? "#5a3a3a" : "#3a5a3a";
            ctx.fillRect(this._folderToggleBtn.x, this._folderToggleBtn.y, this._folderToggleBtn.w, this._folderToggleBtn.h);
            ctx.strokeStyle = this.hideFolders ? "#8a5a5a" : "#5a8a5a";
            ctx.lineWidth = 1;
            ctx.strokeRect(this._folderToggleBtn.x, this._folderToggleBtn.y, this._folderToggleBtn.w, this._folderToggleBtn.h);
            ctx.fillStyle = this.hideFolders ? "#c99" : "#9c9";
            ctx.font = "11px Arial";
            ctx.textAlign = "center";
            ctx.fillText(this.hideFolders ? "📁" : "📂", this._folderToggleBtn.x + folderBtnW/2, this._folderToggleBtn.y + 15);
            
            // Jump to selected button (next to folder toggle)
            const jumpBtnW = 24;
            const hasSelection = state.selectedIndex >= 0;
            this._jumpToSelectedBtn = { x: this._folderToggleBtn.x - jumpBtnW - 6, y: pathBarY, w: jumpBtnW, h: 20 };
            ctx.fillStyle = hasSelection ? "#3a4a5a" : "#2a2a2a";
            ctx.fillRect(this._jumpToSelectedBtn.x, this._jumpToSelectedBtn.y, this._jumpToSelectedBtn.w, this._jumpToSelectedBtn.h);
            ctx.strokeStyle = hasSelection ? "#5a7a9a" : "#444";
            ctx.lineWidth = 1;
            ctx.strokeRect(this._jumpToSelectedBtn.x, this._jumpToSelectedBtn.y, this._jumpToSelectedBtn.w, this._jumpToSelectedBtn.h);
            ctx.fillStyle = hasSelection ? "#9cf" : "#666";
            ctx.font = "11px Arial";
            ctx.textAlign = "center";
            ctx.fillText("📍", this._jumpToSelectedBtn.x + jumpBtnW/2, this._jumpToSelectedBtn.y + 15);
            
            // === GALLERY ===
            ctx.fillStyle = "#1a1a1a";
            ctx.fillRect(8, L.contentTop, this.size[0] - 16, L.galleryHeight);
            
            if (state.isLoading) {
                ctx.fillStyle = "#888";
                ctx.font = "13px Arial";
                ctx.textAlign = "center";
                ctx.fillText("Loading...", this.size[0]/2, L.contentTop + 40);
            } else if (L.totalItems === 0) {
                ctx.fillStyle = "#666";
                ctx.font = "12px Arial";
                ctx.textAlign = "center";
                ctx.fillText("No images or folders", this.size[0]/2, L.contentTop + 40);
            } else {
                // Clamp page
                if (state.currentPage >= L.pages) state.currentPage = L.pages - 1;
                if (state.currentPage < 0) state.currentPage = 0;
                
                const start = state.currentPage * L.perPage;
                const end = Math.min(start + L.perPage, L.totalItems);
                
                const cellHeight = L.thumbSize + INFO_HEIGHT + THUMBNAIL_PADDING;
                
                // Reset delete buttons array for click detection
                this._deleteButtons = [];
                
                // Combined items: subfolders first, then images
                for (let i = start; i < end; i++) {
                    const pi = i - start;
                    const col = pi % L.cols;
                    const row = Math.floor(pi / L.cols);
                    const x = 8 + THUMBNAIL_PADDING + col * (L.thumbSize + THUMBNAIL_PADDING);
                    const y = L.contentTop + THUMBNAIL_PADDING + row * cellHeight;
                    
                    const isFolder = i < L.totalFolders;
                    
                    if (isFolder) {
                        // Draw folder
                        const folderData = state.subfolders[i];
                        
                        // Folder background
                        ctx.fillStyle = "#3a3a2a";
                        ctx.fillRect(x, y, L.thumbSize, L.thumbSize);
                        
                        // Folder icon (simple folder shape)
                        const iconSize = Math.min(L.thumbSize * 0.6, 60);
                        const iconX = x + (L.thumbSize - iconSize) / 2;
                        const iconY = y + (L.thumbSize - iconSize) / 2;
                        
                        // Folder tab
                        ctx.fillStyle = "#c9a227";
                        ctx.beginPath();
                        ctx.moveTo(iconX, iconY + iconSize * 0.15);
                        ctx.lineTo(iconX + iconSize * 0.35, iconY + iconSize * 0.15);
                        ctx.lineTo(iconX + iconSize * 0.45, iconY);
                        ctx.lineTo(iconX + iconSize * 0.45, iconY + iconSize * 0.15);
                        ctx.lineTo(iconX, iconY + iconSize * 0.15);
                        ctx.fill();
                        
                        // Folder body
                        ctx.fillStyle = "#dab02f";
                        ctx.fillRect(iconX, iconY + iconSize * 0.15, iconSize, iconSize * 0.85);
                        
                        // Folder name (truncated)
                        ctx.fillStyle = "#ddd";
                        ctx.font = "9px Arial";
                        ctx.textAlign = "center";
                        let fname = folderData.name;
                        const maxW = L.thumbSize - 4;
                        while (ctx.measureText(fname).width > maxW && fname.length > 5) {
                            fname = fname.slice(0, -4) + "...";
                        }
                        ctx.fillText(fname, x + L.thumbSize/2, y + L.thumbSize + 10);
                        
                        // "Folder" label
                        ctx.fillStyle = "#997";
                        ctx.font = "8px Arial";
                        ctx.fillText("📁 Folder", x + L.thumbSize/2, y + L.thumbSize + 20);
                    } else {
                        // Draw image
                        const imgIdx = i - L.totalFolders;
                        const imgData = state.images[imgIdx];
                        
                        // Selection (only for images)
                        if (imgIdx === state.selectedIndex) {
                            ctx.fillStyle = "#a0a0a0";
                            ctx.fillRect(x - 3, y - 3, L.thumbSize + 6, L.thumbSize + INFO_HEIGHT + 6);
                        }
                        
                        ctx.fillStyle = "#333";
                        ctx.fillRect(x, y, L.thumbSize, L.thumbSize);
                        
                        const thumb = state.thumbnailCache[imgData.filename];
                        if (thumb && thumb !== false) {
                            const scale = Math.min(L.thumbSize / thumb.width, L.thumbSize / thumb.height);
                            const tw = thumb.width * scale;
                            const th = thumb.height * scale;
                            ctx.drawImage(thumb, x + (L.thumbSize - tw)/2, y + (L.thumbSize - th)/2, tw, th);
                        } else if (thumb === null) {
                            ctx.fillStyle = "#500";
                            ctx.fillRect(x, y, L.thumbSize, L.thumbSize);
                        }
                        
                        // Draw filename (truncated)
                        ctx.fillStyle = "#aaa";
                        ctx.font = "9px Arial";
                        ctx.textAlign = "center";
                        let fname = imgData.filename;
                        const maxW = L.thumbSize - 4;
                        while (ctx.measureText(fname).width > maxW && fname.length > 5) {
                            fname = fname.slice(0, -4) + "...";
                        }
                        ctx.fillText(fname, x + L.thumbSize/2, y + L.thumbSize + 10);
                        
                        // Draw resolution
                        if (imgData.width && imgData.height) {
                            ctx.fillStyle = "#777";
                            ctx.font = "8px Arial";
                            ctx.fillText(`${imgData.width}×${imgData.height}`, x + L.thumbSize/2, y + L.thumbSize + 20);
                        }
                        
                        // Draw delete button (red X in top-right corner)
                        const delBtnSize = 16;
                        const delBtnX = x + L.thumbSize - delBtnSize - 2;
                        const delBtnY = y + 2;
                        
                        // Store button rect for click detection
                        this._deleteButtons.push({
                            x: delBtnX,
                            y: delBtnY,
                            w: delBtnSize,
                            h: delBtnSize,
                            imgIdx: imgIdx,
                            filename: imgData.filename
                        });
                        
                        // Button background
                        ctx.fillStyle = "rgba(180, 40, 40, 0.85)";
                        ctx.beginPath();
                        ctx.roundRect(delBtnX, delBtnY, delBtnSize, delBtnSize, 3);
                        ctx.fill();
                        
                        // X symbol
                        ctx.fillStyle = "#fff";
                        ctx.font = "bold 11px Arial";
                        ctx.textAlign = "center";
                        ctx.textBaseline = "middle";
                        ctx.fillText("✕", delBtnX + delBtnSize/2, delBtnY + delBtnSize/2);
                        ctx.textBaseline = "alphabetic";
                    }
                }
            }
            
            // === NAVIGATION ===
            const cx = this.size[0] / 2;
            const navBtnW = 44;
            const navBtnH = 36;
            const navGap = 2;
            const canPrev = state.currentPage > 0;
            const canNext = state.currentPage < L.pages - 1;
            
            // Calculate positions from center outward
            // Left side: -100, -10, -5, -1
            // Right side: +1, +5, +10, +100
            const pageTextW = 50; // width reserved for page text
            
            // Left buttons (from center going left): -1, -5, -10, -100
            this._prevBtn = { x: cx - pageTextW/2 - navBtnW - navGap, y: L.navY, w: navBtnW, h: navBtnH };
            this._prev5Btn = { x: this._prevBtn.x - navBtnW - navGap, y: L.navY, w: navBtnW, h: navBtnH };
            this._prev10Btn = { x: this._prev5Btn.x - navBtnW - navGap, y: L.navY, w: navBtnW, h: navBtnH };
            this._prev100Btn = { x: this._prev10Btn.x - navBtnW - navGap, y: L.navY, w: navBtnW, h: navBtnH };
            
            // Right buttons (from center going right): +1, +5, +10, +100
            this._nextBtn = { x: cx + pageTextW/2 + navGap, y: L.navY, w: navBtnW, h: navBtnH };
            this._next5Btn = { x: this._nextBtn.x + navBtnW + navGap, y: L.navY, w: navBtnW, h: navBtnH };
            this._next10Btn = { x: this._next5Btn.x + navBtnW + navGap, y: L.navY, w: navBtnW, h: navBtnH };
            this._next100Btn = { x: this._next10Btn.x + navBtnW + navGap, y: L.navY, w: navBtnW, h: navBtnH };
            
            // Helper to draw nav button
            const drawNavBtn = (btn, label, enabled) => {
                ctx.fillStyle = enabled ? "#444" : "#2a2a2a";
                ctx.fillRect(btn.x, btn.y, btn.w, btn.h);
                ctx.fillStyle = enabled ? "#fff" : "#555";
                ctx.font = "11px Arial";
                ctx.textAlign = "center";
                ctx.textBaseline = "middle";
                ctx.fillText(label, btn.x + btn.w/2, btn.y + btn.h/2);
                ctx.textBaseline = "alphabetic";
            };
            
            // Draw left buttons
            drawNavBtn(this._prev100Btn, "◀100", canPrev);
            drawNavBtn(this._prev10Btn, "◀10", canPrev);
            drawNavBtn(this._prev5Btn, "◀5", canPrev);
            drawNavBtn(this._prevBtn, "◀1", canPrev);
            
            // Page indicator
            ctx.fillStyle = "#aaa";
            ctx.font = "11px Arial";
            ctx.textAlign = "center";
            ctx.fillText(`${state.currentPage + 1}/${L.pages}`, cx, L.navY + navBtnH/2 + 4);
            
            // Draw right buttons
            drawNavBtn(this._nextBtn, "1▶", canNext);
            drawNavBtn(this._next5Btn, "5▶", canNext);
            drawNavBtn(this._next10Btn, "10▶", canNext);
            drawNavBtn(this._next100Btn, "100▶", canNext);
            
            // Image count (show folders + images)
            ctx.fillStyle = "#666";
            ctx.font = "10px Arial";
            ctx.textAlign = "right";
            const countText = L.totalFolders > 0 
                ? `${L.totalFolders} 📁 ${L.totalImages} imgs` 
                : `${L.totalImages} imgs`;
            ctx.fillText(countText, this.size[0] - 10, L.navY + navBtnH/2 + 4);
            
            // === SIZE PICKER MENU (drawn last to overlay everything) ===
            if (this.showSizeMenu && this._thumbSizeBtn) {
                const menuX = this._thumbSizeBtn.x;
                const menuY = this._thumbSizeBtn.y + this._thumbSizeBtn.h + 2;
                const menuW = this._thumbSizeBtn.w;
                const itemH = 20;
                const menuH = THUMBNAIL_SIZES.length * itemH;
                
                // Store menu rect for click detection
                this._sizeMenuRect = { x: menuX, y: menuY, w: menuW, h: menuH };
                this._sizeMenuItems = [];
                
                // Menu background with border
                ctx.fillStyle = "#2a2a2a";
                ctx.fillRect(menuX, menuY, menuW, menuH);
                ctx.strokeStyle = "#6a9fca";
                ctx.lineWidth = 1;
                ctx.strokeRect(menuX, menuY, menuW, menuH);
                
                // Draw each size option
                for (let i = 0; i < THUMBNAIL_SIZES.length; i++) {
                    const size = THUMBNAIL_SIZES[i];
                    const itemY = menuY + i * itemH;
                    const isSelected = size === this.thumbnailSize;
                    
                    // Store item rect
                    this._sizeMenuItems.push({ x: menuX, y: itemY, w: menuW, h: itemH, size: size });
                    
                    // Highlight selected
                    if (isSelected) {
                        ctx.fillStyle = "#4a6f9a";
                        ctx.fillRect(menuX + 1, itemY, menuW - 2, itemH);
                    }
                    
                    // Item text
                    ctx.fillStyle = isSelected ? "#fff" : "#ccc";
                    ctx.font = "10px Arial";
                    ctx.textAlign = "center";
                    ctx.fillText(`${size}px`, menuX + menuW/2, itemY + 14);
                    
                    // Separator line (except last)
                    if (i < THUMBNAIL_SIZES.length - 1) {
                        ctx.strokeStyle = "#444";
                        ctx.beginPath();
                        ctx.moveTo(menuX + 4, itemY + itemH);
                        ctx.lineTo(menuX + menuW - 4, itemY + itemH);
                        ctx.stroke();
                    }
                }
            } else {
                this._sizeMenuRect = null;
                this._sizeMenuItems = null;
            }
            
            // === EXECUTION OVERLAY ===
            // Draw semi-transparent overlay when workflow is executing
            if (_executionInProgress) {
                ctx.save();
                ctx.fillStyle = "rgba(71, 71, 71, 0.6)";
                ctx.fillRect(0, L.top, this.size[0], this.size[1] - L.top);
                
                // Draw "Executing..." text
                ctx.fillStyle = "#ff6666";
                ctx.font = "bold 14px Arial";
                ctx.textAlign = "center";
                ctx.textBaseline = "middle";
                const centerY = L.top + (this.size[1] - L.top) / 2;
                ctx.fillText("⏳ Executing...", this.size[0] / 2, centerY);
                ctx.restore();
            }
        };
        
        // Mouse handling
        const origMouse = nodeType.prototype.onMouseDown;
        nodeType.prototype.onMouseDown = function(e, pos, canvas) {
            if (this.flags.collapsed) return origMouse?.apply(this, arguments);
            
            // Block interactions during execution
            if (_executionInProgress) return true;
            
            const [x, y] = pos;
            const L = this.getLayout();
            const state = this.getState();
            
            // Tab clicks
            if (this._tabs) {
                for (let i = 0; i < 5; i++) {
                    const t = this._tabs[i];
                    if (x >= t.x && x <= t.x + t.w && y >= t.y && y <= t.y + t.h) {
                        if (this.activeTab !== i) {
                            const prevTab = this.activeTab;
                            const prevFolder = this.getFolderPath(prevTab);
                            this.activeTab = i;
                            const newFolder = this.getFolderPath(i);
                            
                            // Unwatch previous folder, watch new folder (only active tab is watched)
                            if (prevFolder && prevFolder !== newFolder) {
                                this.unwatchFolder(prevFolder);
                            }
                            
                            // Debounced refresh on tab switch
                            if (this._tabSwitchTimer) clearTimeout(this._tabSwitchTimer);
                            this._tabSwitchTimer = setTimeout(() => {
                                this.loadImages(i);
                            }, 150);
                        }
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
                        // Clear folder override and auto-load
                        state.folderOverride = '';
                        const fow = this.folderOverrideWidgets?.[this.activeTab];
                        if (fow) fow.value = '';
                        this.loadImages(this.activeTab);
                        this.setDirtyCanvas(true);
                    }
                    return true;
                }
            }
            
            // Load button - clears folder override to reload from base path
            if (this._loadBtn) {
                const r = this._loadBtn;
                if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) {
                    // Clear folder override to reload from connected input or widget
                    state.folderOverride = '';
                    // Also clear the hidden folderOverride widget so Python gets the right value
                    const fow = this.folderOverrideWidgets?.[this.activeTab];
                    if (fow) fow.value = '';
                    this.loadImages(this.activeTab);
                    return true;
                }
            }
            
            // Go Up button (navigate to parent folder)
            if (this._goUpBtn) {
                const r = this._goUpBtn;
                if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) {
                    if (state.parentFolder && state.parentFolder.length > 0) {
                        // Set folder override for navigation
                        state.folderOverride = state.parentFolder;
                        // Update the hidden folderOverride widget so Python gets the right value
                        const fow = this.folderOverrideWidgets?.[this.activeTab];
                        if (fow) fow.value = state.parentFolder;
                        // Also update widget for non-connected case
                        const fw = this.folderWidgets?.[this.activeTab];
                        if (fw) {
                            fw.value = state.parentFolder;
                        }
                        // Clear selection and reload
                        state.selectedIndex = -1;
                        const sw = this.selectedWidgets?.[this.activeTab];
                        if (sw) sw.value = "";
                        this.loadImages(this.activeTab);
                    }
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
            
            // Folder visibility toggle button
            if (this._folderToggleBtn) {
                const r = this._folderToggleBtn;
                if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) {
                    this.hideFolders = !this.hideFolders;
                    // Reset to page 0 when toggling
                    state.currentPage = 0;
                    this.setDirtyCanvas(true);
                    return true;
                }
            }
            
            // Jump to selected button
            if (this._jumpToSelectedBtn) {
                const r = this._jumpToSelectedBtn;
                if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) {
                    if (state.selectedIndex >= 0) {
                        const totalFolders = this.hideFolders ? 0 : (state.subfolders?.length || 0);
                        const itemIndex = totalFolders + state.selectedIndex;
                        state.currentPage = Math.floor(itemIndex / L.perPage);
                        this.setDirtyCanvas(true);
                    }
                    return true;
                }
            }
            
            // Size menu item clicks (check first when menu is open)
            if (this.showSizeMenu && this._sizeMenuItems) {
                for (const item of this._sizeMenuItems) {
                    if (x >= item.x && x <= item.x + item.w && y >= item.y && y <= item.y + item.h) {
                        if (this.thumbnailSize !== item.size) {
                            this.thumbnailSize = item.size;
                            // Clear all thumbnail caches to reload with new size
                            for (let i = 0; i < 5; i++) {
                                this.tabState[i].thumbnailCache = {};
                                if (this.tabState[i].images.length > 0) {
                                    this.loadThumbnails(i);
                                }
                            }
                        }
                        this.showSizeMenu = false;
                        this.setDirtyCanvas(true);
                        return true;
                    }
                }
                // Click outside menu closes it
                if (this._sizeMenuRect) {
                    const mr = this._sizeMenuRect;
                    if (!(x >= mr.x && x <= mr.x + mr.w && y >= mr.y && y <= mr.y + mr.h)) {
                        // Not in menu - check if on button (toggle) or elsewhere (close)
                        const r = this._thumbSizeBtn;
                        if (!(x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h)) {
                            this.showSizeMenu = false;
                            this.setDirtyCanvas(true);
                            // Don't return - let other click handlers process
                        }
                    }
                }
            }
            
            // Thumbnail size button - toggle menu
            if (this._thumbSizeBtn) {
                const r = this._thumbSizeBtn;
                if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) {
                    this.showSizeMenu = !this.showSizeMenu;
                    this.setDirtyCanvas(true);
                    return true;
                }
            }
            
            // Navigation buttons helper
            const checkNavBtn = (btn, delta) => {
                if (!btn) return false;
                if (x >= btn.x && x <= btn.x + btn.w && y >= btn.y && y <= btn.y + btn.h) {
                    const newPage = state.currentPage + delta;
                    state.currentPage = Math.max(0, Math.min(L.pages - 1, newPage));
                    this.setDirtyCanvas(true);
                    return true;
                }
                return false;
            };
            
            // Check all navigation buttons
            if (checkNavBtn(this._prev100Btn, -100)) return true;
            if (checkNavBtn(this._prev10Btn, -10)) return true;
            if (checkNavBtn(this._prev5Btn, -5)) return true;
            if (checkNavBtn(this._prevBtn, -1)) return true;
            if (checkNavBtn(this._nextBtn, 1)) return true;
            if (checkNavBtn(this._next5Btn, 5)) return true;
            if (checkNavBtn(this._next10Btn, 10)) return true;
            if (checkNavBtn(this._next100Btn, 100)) return true;
            
            // Delete button clicks (check before thumbnail selection)
            if (this._deleteButtons) {
                for (const btn of this._deleteButtons) {
                    if (x >= btn.x && x <= btn.x + btn.w && y >= btn.y && y <= btn.y + btn.h) {
                        const folder = this.getFolderPath(this.activeTab);
                        const filename = btn.filename;
                        showDeleteConfirmation(filename, 
                            () => this.deleteImage(folder, filename),
                            () => { /* cancelled */ }
                        );
                        return true;
                    }
                }
            }
            
            // Thumbnail/folder clicks
            if (y >= L.contentTop && y < L.navY && L.totalItems > 0) {
                const start = state.currentPage * L.perPage;
                const end = Math.min(start + L.perPage, L.totalItems);
                const cellHeight = L.thumbSize + INFO_HEIGHT + THUMBNAIL_PADDING;
                
                for (let i = start; i < end; i++) {
                    const pi = i - start;
                    const col = pi % L.cols;
                    const row = Math.floor(pi / L.cols);
                    const tx = 8 + THUMBNAIL_PADDING + col * (L.thumbSize + THUMBNAIL_PADDING);
                    const ty = L.contentTop + THUMBNAIL_PADDING + row * cellHeight;
                    
                    if (x >= tx && x <= tx + L.thumbSize && y >= ty && y <= ty + L.thumbSize + INFO_HEIGHT) {
                        const isFolder = i < L.totalFolders;
                        
                        if (isFolder) {
                            // Single click on folder does nothing (use double-click to navigate)
                            return true;
                        } else {
                            // Image click - select it
                            const imgIdx = i - L.totalFolders;
                            state.selectedIndex = imgIdx;
                            const fn = state.images[imgIdx].filename;
                            const sw = this.selectedWidgets?.[this.activeTab];
                            if (sw) sw.value = fn;
                            this.setDirtyCanvas(true);
                            this.graph?.change();
                            return true;
                        }
                    }
                }
                return true;
            }
            
            return origMouse?.apply(this, arguments);
        };
        
        // Double-click handler for preview mode and folder navigation
        const origDblClick = nodeType.prototype.onDblClick;
        nodeType.prototype.onDblClick = function(e, pos, canvas) {
            if (this.flags.collapsed) return origDblClick?.apply(this, arguments);
            
            // Block interactions during execution
            if (_executionInProgress) return true;
            
            const [x, y] = pos;
            const L = this.getLayout();
            const state = this.getState();
            
            // Check if double-click is on a thumbnail or folder
            if (y >= L.contentTop && y < L.navY && L.totalItems > 0) {
                const start = state.currentPage * L.perPage;
                const end = Math.min(start + L.perPage, L.totalItems);
                const cellHeight = L.thumbSize + INFO_HEIGHT + THUMBNAIL_PADDING;
                
                for (let i = start; i < end; i++) {
                    const pi = i - start;
                    const col = pi % L.cols;
                    const row = Math.floor(pi / L.cols);
                    const tx = 8 + THUMBNAIL_PADDING + col * (L.thumbSize + THUMBNAIL_PADDING);
                    const ty = L.contentTop + THUMBNAIL_PADDING + row * cellHeight;
                    
                    if (x >= tx && x <= tx + L.thumbSize && y >= ty && y <= ty + L.thumbSize + INFO_HEIGHT) {
                        const isFolder = i < L.totalFolders;
                        
                        if (isFolder) {
                            // Double-click on folder - navigate into it
                            const folderData = state.subfolders[i];
                            if (folderData && folderData.path) {
                                // Set folder override for subfolder navigation
                                state.folderOverride = folderData.path;
                                // Update the hidden folderOverride widget so Python gets the right value
                                const fow = this.folderOverrideWidgets?.[this.activeTab];
                                if (fow) fow.value = folderData.path;
                                // Also update widget for non-connected case
                                const fw = this.folderWidgets?.[this.activeTab];
                                if (fw) {
                                    fw.value = folderData.path;
                                }
                                // Clear selection and reload
                                state.selectedIndex = -1;
                                const sw = this.selectedWidgets?.[this.activeTab];
                                if (sw) sw.value = "";
                                this.loadImages(this.activeTab);
                            }
                            return true;
                        } else {
                            // Double-click on image - show preview
                            const imgIdx = i - L.totalFolders;
                            const folder = this.getFolderPath(this.activeTab);
                            const filename = state.images[imgIdx].filename;
                            if (folder && filename) {
                                const imageSrc = `/imagefolderpicker/image?folder=${encodeURIComponent(folder)}&filename=${encodeURIComponent(filename)}`;
                                showPreviewOverlay(imageSrc, filename, () => {
                                    // Callback when closed - nothing needed
                                });
                            }
                            return true;
                        }
                    }
                }
            }
            
            return origDblClick?.apply(this, arguments);
        };
        
        // Mouse wheel
        const origWheel = nodeType.prototype.onMouseWheel;
        nodeType.prototype.onMouseWheel = function(e, pos) {
            if (this.flags.collapsed) return;
            
            // Block interactions during execution
            if (_executionInProgress) return;
            
            const L = this.getLayout();
            const state = this.getState();
            const y = pos[1];
            
            if (y >= L.contentTop && y < L.navY && L.totalItems > 0 && L.pages > 1) {
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
                sort: s.sortOrder,
                folderOverride: s.folderOverride || ''
            }));
        };
        
        // Configure
        const origConf = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function(o) {
            origConf?.apply(this, arguments);
            this.activeTab = o.ifp_tab ?? 0;
            this.thumbnailSize = o.ifp_thumbSize ?? DEFAULT_THUMBNAIL_SIZE;
            if (o.ifp_states) {
                for (let i = 0; i < 5; i++) {
                    if (o.ifp_states[i]) {
                        this.tabState[i].selectedIndex = o.ifp_states[i].sel ?? -1;
                        this.tabState[i].currentPage = o.ifp_states[i].page ?? 0;
                        this.tabState[i].sortOrder = o.ifp_states[i].sort ?? 'name';
                        this.tabState[i].folderOverride = o.ifp_states[i].folderOverride ?? '';
                    }
                }
            }
            // After widgets are set up, sync folderOverride widgets with state
            setTimeout(() => {
                this.setupWidgets();
                // Sync folderOverride widgets with tabState
                if (this.folderOverrideWidgets) {
                    for (let i = 0; i < 5; i++) {
                        const fow = this.folderOverrideWidgets[i];
                        if (fow && this.tabState[i].folderOverride) {
                            fow.value = this.tabState[i].folderOverride;
                        }
                    }
                }
            }, 100);
        };
    }
});
