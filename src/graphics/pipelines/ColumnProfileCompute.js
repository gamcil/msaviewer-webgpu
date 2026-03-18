// Compute column profiles using the pident compute shader

export class ColumnProfileCompute {
    constructor(device, shaderCode) {
        this.device = device;
        this.pipeline = device.createComputePipeline({
            layout: 'auto',
            compute: {
                module: device.createShaderModule({ code: shaderCode }),
                entryPoint: 'main'
            }
        });
    }

    encode(commandEncoder, msaTextureView, colProfileBuffer, totalCols, totalRows, rowsPerLayer) {
        const paramsData = new Uint32Array([totalCols, totalRows, rowsPerLayer]);
        const paramsBuffer = this.device.createBuffer({
            size: paramsData.byteLength,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        this.device.queue.writeBuffer(paramsBuffer, 0, paramsData);

        const bindGroup = this.device.createBindGroup({
            layout: this.pipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: paramsBuffer } },
                { binding: 1, resource: msaTextureView },
                { binding: 2, resource: { buffer: colProfileBuffer } }
            ]
        });

        const passEncoder = commandEncoder.beginComputePass();
        passEncoder.setPipeline(this.pipeline);
        passEncoder.setBindGroup(0, bindGroup);
        passEncoder.dispatchWorkgroups(Math.ceil(totalCols / 64));
        passEncoder.end();
    }

    run(msaTextureView, colProfileBuffer, totalCols, totalRows, rowsPerLayer) {
        const commandEncoder = this.device.createCommandEncoder();
        this.encode(commandEncoder, msaTextureView, colProfileBuffer, totalCols, totalRows, rowsPerLayer);
        this.device.queue.submit([commandEncoder.finish()]);
    }
}
