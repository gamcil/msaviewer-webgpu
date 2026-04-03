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

export class WebGPUAlignmentSurface {
    constructor({
        device,
        format,
        uniformBuffer,
        renderer,
    }) {
        this.device = device;
        this.format = format;
        this.uniformBuffer = uniformBuffer;
        this.renderer = renderer;
        this.renderBindGroup = null;

        this.canvas = document.createElement("canvas");
        this.canvas.className = "msa-alignment-canvas";
        this.context = this.canvas.getContext("webgpu");
        this.context.configure({ device: this.device, format: this.format });
    }

    setRenderer(renderer) {
        this.renderer = renderer;
    }

    setRenderResources(renderResources) {
        this.renderBindGroup = renderResources?.bindGroup ?? null;
    }

    syncSize(width, height, cssWidth, cssHeight) {
        this.canvas.style.width = `${cssWidth}px`;
        this.canvas.style.height = `${cssHeight}px`;
        if (this.canvas.width !== width || this.canvas.height !== height) {
            this.canvas.width = width;
            this.canvas.height = height;
        }
    }

    syncRenderState({
        scrollPxX,
        scrollPxY,
        totalCols,
        totalRows,
        gridPxX,
        gridPxY,
        windowColStart,
        windowRowStart,
        windowCols,
        windowRows,
    }) {
        writeRenderUniformBuffer(
            this.device,
            this.uniformBuffer,
            scrollPxX,
            scrollPxY,
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
        if (!this.renderBindGroup || !this.renderer) return;
        this.renderer.render(this.context, this.renderBindGroup);
    }
}
