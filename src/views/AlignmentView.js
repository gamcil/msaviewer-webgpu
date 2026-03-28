/*
View for the alignment itself
*/

import { AlignmentOverlayPainter } from "./helpers/AlignmentOverlayPainter.js";

function writeRenderUniformBuffer(
    device,
    buffer,
    scrollPxX,
    scrollPxY,
    totalCols,
    totalRows,
    gridPxX,
    gridPxY,
    canvasWidth,
    canvasHeight,
    windowColStart,
    windowRowStart,
    windowCols,
    windowRows
) {
    const data = new Uint32Array([
        scrollPxX,
        scrollPxY,
        totalCols,
        totalRows,
        gridPxX,
        gridPxY,
        canvasWidth,
        canvasHeight,
        windowColStart,
        windowRowStart,
        windowCols,
        windowRows,
    ]);
    device.queue.writeBuffer(buffer, 0, data);
}

export class AlignmentView {
    constructor({
        root,
        renderer,
        uniformBuffer,
        device,
        format,
        getCellWidth,
        getCellHeight,
    }) {
        this.root = root;
        this.renderer = renderer;
        this.uniformBuffer = uniformBuffer;
        this.device = device;
        this.format = format;
        this.getCellWidth = getCellWidth;
        this.getCellHeight = getCellHeight;
        this.renderBindGroup = null;

        this.scroller = document.createElement("div");
        this.scroller.className = "msa-alignment-scroller";
        
        this.spacer = document.createElement("div");
        this.spacer.className = "msa-alignment-spacer";

        this.canvas = document.createElement("canvas");
        this.canvas.className = "msa-alignment-canvas";
        this.context = this.canvas.getContext("webgpu");
        this.context.configure({ device: this.device, format: this.format });

        this.motifOverlay = document.createElement("canvas");
        this.motifOverlay.className = "msa-alignment-motif-canvas";
        this.motifContext = this.motifOverlay.getContext("2d");
        
        this.overlay = document.createElement("canvas");
        this.overlay.className = "msa-alignment-overlay-canvas";
        this.overlayContext = this.overlay.getContext("2d");
        // this.overlayContext.configure({ device: this.device, format: this.format });

        this.scroller.appendChild(this.spacer);
        this.root.appendChild(this.scroller);
        this.root.appendChild(this.canvas);
        this.root.appendChild(this.motifOverlay);
        this.root.appendChild(this.overlay);
        this.overlayPainter = new AlignmentOverlayPainter({
            root: this.root,
            motifOverlay: this.motifOverlay,
            motifContext: this.motifContext,
            overlay: this.overlay,
            overlayContext: this.overlayContext,
        });
    }
    getRenderedCellWidthCss() {
        const dpr = window.devicePixelRatio || 1;
        return Math.max(1, Math.round(this.getCellWidth() * dpr)) / dpr;
    }
    getRenderedCellHeightCss() {
        const dpr = window.devicePixelRatio || 1;
        return Math.max(1, Math.round(this.getCellHeight() * dpr)) / dpr;
    }
    setBindGroup(bindGroup) {
        this.renderBindGroup = bindGroup;
    }
    syncRenderState({ totalCols, totalRows, windowColStart = 0, windowRowStart = 0, windowCols = 0, windowRows = 0 }) {
        const dpr = window.devicePixelRatio || 1;
        const cellWidthCss = this.getRenderedCellWidthCss();
        const cellHeightCss = this.getRenderedCellHeightCss();
        const gridPxX = Math.max(1, Math.round(cellWidthCss * dpr));
        const gridPxY = Math.max(1, Math.round(cellHeightCss * dpr));
        const localScrollLeft = this.scroller.scrollLeft - windowColStart * cellWidthCss;
        const localScrollTop = this.scroller.scrollTop - windowRowStart * cellHeightCss;
        writeRenderUniformBuffer(
            this.device,
            this.uniformBuffer,
            Math.round(localScrollLeft * dpr),
            Math.round(localScrollTop * dpr),
            totalCols,
            totalRows,
            gridPxX,
            gridPxY,
            this.canvas.width,
            this.canvas.height,
            windowColStart,
            windowRowStart,
            windowCols,
            windowRows,
        );
    }
    getVisibleColumnRange() {
        const scrollLeft = this.scroller.scrollLeft;
        const viewportWidth = this.scroller.clientWidth;
        const cellWidth = this.getRenderedCellWidthCss();
        const colStart = Math.floor(scrollLeft / cellWidth);
        const colEnd = Math.min(this.totalCols, Math.ceil((scrollLeft + viewportWidth) / cellWidth));
        return [colStart, colEnd];
    }
    setOverlayState({
        hoveredCell = null,
        selectionMode = "column",
        selectionRanges = [],
        previewRange = null,
        columnVisibility = undefined,
    }) {
        this.overlayPainter.setSelectionState({
            hoveredCell,
            selectionMode,
            selectionRanges,
            previewRange,
            columnVisibility,
        });
        this.renderOverlays();
    }
    getVisibleRowRange() {
        const scrollTop = this.scroller.scrollTop;
        const viewportHeight = this.scroller.clientHeight;
        const cellHeight = this.getRenderedCellHeightCss();
        const rowStart = Math.floor(scrollTop / cellHeight);
        const rowEnd = Math.min(this.totalRows, Math.ceil((scrollTop + viewportHeight) / cellHeight));
        return [rowStart, rowEnd];
    }
    setMotifState({ motifHitsByRow = null } = {}) {
        this.overlayPainter.setMotifState({ motifHitsByRow });
        this.renderOverlays();
    }
    renderMotifOverlay() {
        const dpr = window.devicePixelRatio || 1;
        const cellWidthCss = this.getRenderedCellWidthCss();
        const cellHeightCss = this.getRenderedCellHeightCss();
        const [colStart, colEnd] = this.getVisibleColumnRange();
        const [rowStart, rowEnd] = this.getVisibleRowRange();
        this.overlayPainter.drawMotifOverlay({
            dpr,
            cellWidthCss,
            cellHeightCss,
            colStart,
            colEnd,
            rowStart,
            rowEnd,
            scrollLeft: this.scroller.scrollLeft,
            scrollTop: this.scroller.scrollTop,
        });
    }
    renderSelectionOverlay() {
        const dpr = window.devicePixelRatio || 1;
        const cellWidthCss = this.getRenderedCellWidthCss();
        const cellHeightCss = this.getRenderedCellHeightCss();
        const [colStart, colEnd] = this.getVisibleColumnRange();
        const [rowStart, rowEnd] = this.getVisibleRowRange();
        this.overlayPainter.drawOverlay({
            dpr,
            cellWidthCss,
            cellHeightCss,
            colStart,
            colEnd,
            rowStart,
            rowEnd,
            scrollLeft: this.scroller.scrollLeft,
            scrollTop: this.scroller.scrollTop,
        });
    }
    renderOverlays() {
        this.renderMotifOverlay();
        this.renderSelectionOverlay();
    }
    renderSurface() {
        if (!this.renderBindGroup) return;
        this.renderer.render(this.context, this.renderBindGroup);
    }
    syncSurfaceSize() {
        const viewportWidth = Math.max(1, this.scroller.clientWidth);
        const viewportHeight = Math.max(1, this.scroller.clientHeight);
        this.canvas.style.width = `${viewportWidth}px`;
        this.canvas.style.height = `${viewportHeight}px`;
        this.motifOverlay.style.width = `${viewportWidth}px`;
        this.motifOverlay.style.height = `${viewportHeight}px`;
        this.overlay.style.width = `${viewportWidth}px`;
        this.overlay.style.height = `${viewportHeight}px`;

        const width = Math.max(1, Math.floor(viewportWidth * window.devicePixelRatio));
        const height = Math.max(1, Math.floor(viewportHeight * window.devicePixelRatio));
        if (this.canvas.width !== width || this.canvas.height !== height) {
            this.canvas.width = width;
            this.canvas.height = height;
            this.motifOverlay.width = width;
            this.motifOverlay.height = height;
            this.overlay.width = width;
            this.overlay.height = height;
        }
        this.renderOverlays();
    }
    setAlignmentSize(totalCols, totalRows, columnVisibility = null) {
        this.totalCols = columnVisibility?.visibleCount ?? totalCols;
        this.totalRows = totalRows;
        this.overlayPainter.setColumnVisibility(columnVisibility);
        const width = this.totalCols * this.getRenderedCellWidthCss();
        const height = totalRows * this.getRenderedCellHeightCss();
        this.spacer.style.width = `${width}px`;
        this.spacer.style.height = `${height}px`;
    }
    scrollTo(left, top) {
        this.scroller.scrollLeft = left;
        this.scroller.scrollTop = top;
    }
}
