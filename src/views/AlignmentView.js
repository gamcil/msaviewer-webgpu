/*
View for the alignment itself
*/

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
        
        this.overlay = document.createElement("canvas");
        this.overlay.className = "msa-alignment-overlay-canvas";
        this.overlayContext = this.overlay.getContext("2d");
        // this.overlayContext.configure({ device: this.device, format: this.format });

        this.scroller.appendChild(this.spacer);
        this.root.appendChild(this.scroller);
        this.root.appendChild(this.canvas);
        this.root.appendChild(this.overlay);
        
        // Hover state
        this.hoveredColumn = null;
        this.selectedColumns = new Set();
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
    syncUniforms({ totalCols, totalRows, windowColStart = 0, windowRowStart = 0, windowCols = 0, windowRows = 0 }) {
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
    setOverlayState({ hoveredColumn = null, selectedColumns = this.selectedColumns }) {
        this.hoveredColumn = hoveredColumn;
        this.selectedColumns = selectedColumns;
        this.drawOverlay(); 
    }
    drawOverlay() {
        if (!this.overlayContext) return;

        const dpr = window.devicePixelRatio || 1;
        const cellWidthCss = this.getRenderedCellWidthCss();
        const cellHeightCss = this.getRenderedCellHeightCss();
        const cellWidthPx = Math.max(1, Math.round(cellWidthCss * dpr));
        
        this.clearOverlay();

        const [colStart, colEnd] = this.getVisibleColumnRange(); 
        const localScrollLeft = this.scroller.scrollLeft - colStart * cellWidthCss;
        const localScrollLeftPx = Math.round(localScrollLeft * dpr);
        const numRows = Math.min(this.totalRows, Math.ceil(this.scroller.clientHeight / cellHeightCss));
        const heightPx = numRows * Math.max(1, Math.round(cellHeightCss * dpr));

        for (const col of this.selectedColumns) {
            if (col < colStart || col >= colEnd) continue;
            const x = (col - colStart) * cellWidthPx - localScrollLeftPx;
            this.overlayContext.strokeStyle = "rgb(0, 122, 178)";
            this.overlayContext.fillStyle = "rgba(89, 211, 255, 0.25)"; 
            this.overlayContext.lineWidth = Math.max(1, Math.round(dpr));
            this.overlayContext.beginPath();
            this.overlayContext.rect(x, 0, cellWidthPx, heightPx);
            this.overlayContext.fill();
            this.overlayContext.stroke();
        }
        
        if (this.hoveredColumn !== null && this.hoveredColumn >= colStart && this.hoveredColumn < colEnd) {
            const x = (this.hoveredColumn - colStart) * cellWidthPx - localScrollLeftPx;
            this.overlayContext.strokeStyle = "rgb(0, 122, 178)";
            this.overlayContext.lineWidth = Math.max(1, Math.round(dpr));
            this.overlayContext.strokeRect(x + 0.5, 0.5, Math.max(0, cellWidthPx - 1), Math.max(0, heightPx - 1));
        }
    }
    clearOverlay() {
        if (!this.overlayContext) return;
        this.overlayContext.clearRect(0, 0, this.overlay.width, this.overlay.height);
    }
    render() {
        if (!this.renderBindGroup) return;
        this.renderer.render(this.context, this.renderBindGroup);
    }
    ensureCanvasSize() {
        const viewportWidth = Math.max(1, this.scroller.clientWidth);
        const viewportHeight = Math.max(1, this.scroller.clientHeight);
        this.canvas.style.width = `${viewportWidth}px`;
        this.canvas.style.height = `${viewportHeight}px`;
        this.overlay.style.width = `${viewportWidth}px`;
        this.overlay.style.height = `${viewportHeight}px`;

        const width = Math.max(1, Math.floor(viewportWidth * window.devicePixelRatio));
        const height = Math.max(1, Math.floor(viewportHeight * window.devicePixelRatio));
        if (this.canvas.width !== width || this.canvas.height !== height) {
            this.canvas.width = width;
            this.canvas.height = height;
            this.overlay.width = width;
            this.overlay.height = height;
        }
        this.drawOverlay();
    }
    setAlignmentSize(totalCols, totalRows) {
        this.totalCols = totalCols;
        this.totalRows = totalRows;
        const width = totalCols * this.getRenderedCellWidthCss();
        const height = totalRows * this.getRenderedCellHeightCss();
        this.spacer.style.width = `${width}px`;
        this.spacer.style.height = `${height}px`;
    }
    scrollTo(left, top) {
        this.scroller.scrollLeft = left;
        this.scroller.scrollTop = top;
    }
}
