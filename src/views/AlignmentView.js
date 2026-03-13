/*
View for the alignment itself
*/

function writeRenderUniformBuffer(device, buffer, scrollPxX, scrollPxY, totalCols, totalRows, gridPxX, gridPxY, canvasWidth, canvasHeight) {
    const data = new Uint32Array([
        scrollPxX,
        scrollPxY,
        totalCols,
        totalRows,
        gridPxX,
        gridPxY,
        canvasWidth,
        canvasHeight,
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
        
        this.stage = document.createElement("div");
        this.stage.className = "msa-alignment-stage";
        
        this.canvas = document.createElement("canvas");
        this.canvas.className = "msa-alignment-canvas";
        this.context = this.canvas.getContext("webgpu");
        this.context.configure({ device: this.device, format: this.format });

        this.stage.appendChild(this.canvas);
        this.scroller.appendChild(this.spacer);
        this.scroller.appendChild(this.stage);
        this.root.appendChild(this.scroller);
    }
    setBindGroup(bindGroup) {
        this.renderBindGroup = bindGroup;
    }
    syncStage() {
        this.stage.style.transform = `translate(${this.scroller.scrollLeft}px, ${this.scroller.scrollTop}px)`;
    }
    syncUniforms({ totalCols, totalRows }) {
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
        );
    }
    render() {
        if (!this.renderBindGroup) return;
        this.renderer.render(this.context, this.renderBindGroup);
    }
    ensureCanvasSize() {
        const width = Math.max(1, Math.floor(this.canvas.clientWidth * window.devicePixelRatio));
        const height = Math.max(1, Math.floor(this.canvas.clientHeight * window.devicePixelRatio));
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
