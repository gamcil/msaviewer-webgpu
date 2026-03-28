/*
Minimap
*/
import { SizedCanvas2D } from "./helpers/SizedCanvas2D.js";
import { MinimapInteractionController } from "./helpers/MinimapInteractionController.js";
import { drawSelectionUnion } from "./renderers/selectionUnionRenderer.js";

export class MinimapView {
    constructor({ root }) {
        this.root = root;
        this.viewportRect = null;
        this.selectionGeometry = { rowIntervals: new Map(), totalRows: 0, totalCols: 0 };
        this.imageData = null;
        this.selectionOverlayDirty = true;
        
        this.offscreen = document.createElement("canvas");
        this.offscreenContext = this.offscreen.getContext("2d", { alpha: false });
        this.selectionOverlay = document.createElement("canvas");
        this.selectionOverlayContext = this.selectionOverlay.getContext("2d");

        this.track = document.createElement("div");
        this.track.className = "msa-minimap";
        this.track.style.width = "100%";
        this.track.style.height = "100%";
        this.track.style.position = "relative";
        
        this.minimap = document.createElement("canvas");
        this.minimap.className = "msa-minimap-canvas";
        this.minimap.style.width = "100%";
        this.minimap.style.height = "100%";
        this.minimap.style.display = "block";

        this.minimapOverlay = document.createElement("canvas");
        this.minimapOverlay.className = "msa-minimap-overlay";
        this.minimapOverlay.style.position = "absolute";
        this.minimapOverlay.style.inset = "0";
        this.minimapOverlay.style.width = "100%";
        this.minimapOverlay.style.height = "100%";
        this.minimapOverlay.style.display = "block";
        
        this.onViewportRequest = null;
        this.resizeFrameHandle = null;
        
        this.track.appendChild(this.minimap);
        this.track.appendChild(this.minimapOverlay);
        this.root.appendChild(this.track);

        this.minimapContext = this.minimap.getContext("2d");
        this.overlayContext = this.minimapOverlay.getContext("2d");
        const scheduleResizeRedraw = () => {
            if (this.resizeFrameHandle != null) return;
            this.resizeFrameHandle = requestAnimationFrame(() => {
                this.resizeFrameHandle = null;
                this.selectionOverlayDirty = true;
                this.refreshRendering();
            });
        };
        this.minimapSizedCanvas = new SizedCanvas2D({
            root: this.track,
            canvas: this.minimap,
            getCssHeight: () => this.track.clientHeight || 0,
            onResize: scheduleResizeRedraw,
        });
        this.overlaySizedCanvas = new SizedCanvas2D({
            root: this.track,
            canvas: this.minimapOverlay,
            getCssHeight: () => this.track.clientHeight || 0,
            onResize: scheduleResizeRedraw,
        });
        this.interactionController = new MinimapInteractionController({
            element: this.minimapOverlay,
            getViewportRect: () => this.viewportRect,
            getLocalCoordinates: (clientX, clientY) => this.getMinimapLocalCoordinates(clientX, clientY),
            getViewportSize: () => this.getViewportPixelSize(),
            onViewportRequest: (request) => this.onViewportRequest?.(request),
        });
    }
    
    getMinimapLocalCoordinates(x, y) {
        const bounds = this.minimapOverlay.getBoundingClientRect();
        const overlayWidth = this.minimapOverlay.width || 1;
        const overlayHeight = this.minimapOverlay.height || 1;
        const pointerX = (x - bounds.left) * (overlayWidth / bounds.width);
        const pointerY = (y - bounds.top) * (overlayHeight / bounds.height);
        return { x: pointerX, y: pointerY };
    }

    getViewportPixelSize() {
        const baseSize = this.minimapSizedCanvas.ensureSize();
        this.overlaySizedCanvas.ensureSize();
        return {
            width: baseSize.width,
            height: baseSize.height,
        };
    }
     
    setImageData(pixels, width, height) {
        this.offscreen.width = width;
        this.offscreen.height = height;
        this.imageData = new ImageData(pixels, width, height);
        this.refreshRendering();
    }
    
    setViewportRect({ x, y, width, height }) {
        this.viewportRect = { x, y, width, height };
        this.drawOverlay();
    }

    setSelectionBands(selectionGeometry = { rowIntervals: new Map(), totalRows: 0, totalCols: 0 }) {
        this.selectionGeometry = selectionGeometry ?? { rowIntervals: new Map(), totalRows: 0, totalCols: 0 };
        this.selectionOverlayDirty = true;
        this.drawOverlay();
    }

    refreshRendering() {
        this.drawBase();
        this.drawOverlay();
    }
    
    clear() {
        this.imageData = null;
        this.viewportRect = null;
        this.selectionGeometry = { rowIntervals: new Map(), totalRows: 0, totalCols: 0 };
        this.selectionOverlayDirty = true;
        this.minimap.width = 0;
        this.minimap.height = 0;
        this.minimapOverlay.width = 0;
        this.minimapOverlay.height = 0;
        this.selectionOverlay.width = 0;
        this.selectionOverlay.height = 0;
    }

    drawSelectionUnion(context, width, height) {
        const { rowIntervals, totalRows, totalCols } = this.selectionGeometry ?? {};
        if (!(rowIntervals instanceof Map) || rowIntervals.size === 0 || totalRows <= 0 || totalCols <= 0) {
            return;
        }

        const rowHeightPx = height / totalRows;
        drawSelectionUnion({
            context,
            rowIntervals,
            getRowY: (row) => row * rowHeightPx,
            getRowHeight: () => rowHeightPx,
            getIntervalX: (interval) => (interval.colStart / totalCols) * width,
            getIntervalWidth: (interval) => ((interval.colEnd - interval.colStart) / totalCols) * width,
            washFillStyle: "rgba(255, 255, 255, 0.35)",
            fillStyle: "rgba(89, 211, 255, 0.22)",
            strokeStyle: "rgba(0, 122, 178, 0.7)",
            lineWidth: 1,
            lineDash: [],
        });
    }

    redrawSelectionOverlay(width, height) {
        if (!this.selectionOverlayContext) return;
        if (this.selectionOverlay.width !== width || this.selectionOverlay.height !== height) {
            this.selectionOverlay.width = width;
            this.selectionOverlay.height = height;
        }
        this.selectionOverlayContext.clearRect(0, 0, width, height);
        this.drawSelectionUnion(this.selectionOverlayContext, width, height);
        this.selectionOverlayDirty = false;
    }

    drawBase() {
        if (!this.minimapContext || !this.imageData) {
            return;
        }
        const { width, height } = this.minimapSizedCanvas.ensureSize();
        if (width <= 0 || height <= 0) {
            return;
        }
        this.minimapContext.clearRect(0, 0, width, height);
        this.minimapContext.imageSmoothingEnabled = true;
        this.offscreenContext.putImageData(this.imageData, 0, 0);
        this.minimapContext.drawImage(this.offscreen, 0, 0, width, height);
    }

    drawOverlay() {
        if (!this.overlayContext) {
            return;
        }
        const { width, height } = this.overlaySizedCanvas.ensureSize();
        if (width <= 0 || height <= 0) {
            return;
        }
        this.overlayContext.clearRect(0, 0, width, height);
        if (this.selectionOverlayDirty || this.selectionOverlay.width !== width || this.selectionOverlay.height !== height) {
            this.redrawSelectionOverlay(width, height);
        }
        if (this.selectionOverlay.width > 0 && this.selectionOverlay.height > 0) {
            this.overlayContext.drawImage(this.selectionOverlay, 0, 0);
        }
        if (!this.viewportRect) {
            return;
        }
        const { x, y, width: rectWidth, height: rectHeight } = this.viewportRect;
        this.overlayContext.strokeStyle = "rgb(0, 122, 178)";
        this.overlayContext.lineWidth = Math.max(1, Math.round((window.devicePixelRatio || 1)));
        this.overlayContext.fillStyle = "rgba(89, 211, 255, 0.5)";
        this.overlayContext.fillRect(x, y, rectWidth, rectHeight);
        this.overlayContext.strokeRect(x + 0.5, y + 0.5, Math.max(0, rectWidth - 1), Math.max(0, rectHeight - 1));
    }

    destroy() {
        if (this.resizeFrameHandle != null) {
            cancelAnimationFrame(this.resizeFrameHandle);
        }
        this.interactionController.destroy();
        this.minimapSizedCanvas.destroy();
        this.overlaySizedCanvas.destroy();
    }
}
