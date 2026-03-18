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

        this.scroller.appendChild(this.spacer);
        this.root.appendChild(this.scroller);
        this.root.appendChild(this.canvas);
    }
    setBindGroup(bindGroup) {
        this.renderBindGroup = bindGroup;
    }
    syncUniforms({ totalCols, totalRows, windowColStart = 0, windowRowStart = 0, windowCols = 0, windowRows = 0 }) {
        const dpr = window.devicePixelRatio || 1;
        const gridPxX = Math.max(1, Math.round(this.getCellWidth() * dpr));
        const gridPxY = Math.max(1, Math.round(this.getCellHeight() * dpr));
        writeRenderUniformBuffer(
            this.device,
            this.uniformBuffer,
            Math.round(this.scroller.scrollLeft * dpr),
            Math.round(this.scroller.scrollTop * dpr),
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
    render() {
        if (!this.renderBindGroup) return;
        this.renderer.render(this.context, this.renderBindGroup);
    }
    ensureCanvasSize() {
        const viewportWidth = Math.max(1, this.scroller.clientWidth);
        const viewportHeight = Math.max(1, this.scroller.clientHeight);
        this.canvas.style.width = `${viewportWidth}px`;
        this.canvas.style.height = `${viewportHeight}px`;

        const width = Math.max(1, Math.floor(viewportWidth * window.devicePixelRatio));
        const height = Math.max(1, Math.floor(viewportHeight * window.devicePixelRatio));
        if (this.canvas.width !== width || this.canvas.height !== height) {
            this.canvas.width = width;
            this.canvas.height = height;
        }
    }
    setAlignmentSize(totalCols, totalRows) {
        const width = totalCols * this.getCellWidth();
        const height = totalRows * this.getCellHeight();
        this.spacer.style.width = `${width}px`;
        this.spacer.style.height = `${height}px`;
    }
    scrollTo(left, top) {
        this.scroller.scrollLeft = left;
        this.scroller.scrollTop = top;
    }
}
