/*
 * Compute shader for accumulating minimap pixels
 * */
export class MinimapCompute {
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

    encode(commandEncoder, msaTextureView, colProfileBuffer, themeBuffer, visibleToRawBuffer, auxBuffer, outputBuffer, paramsBuffer, params) {
        const paramsData = new Uint32Array([
            params.totalRows,
            params.totalCols,
            params.chunkRowStart,
            params.chunkColStart,
            params.chunkRows,
            params.chunkCols,
            params.minimapWidth,
            params.minimapHeight,
        ]);
        this.device.queue.writeBuffer(paramsBuffer, 0, paramsData);

        const bindGroup = this.device.createBindGroup({
            layout: this.pipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: paramsBuffer } },
                { binding: 1, resource: msaTextureView },
                { binding: 2, resource: { buffer: colProfileBuffer } },
                { binding: 3, resource: { buffer: themeBuffer } },
                { binding: 4, resource: { buffer: visibleToRawBuffer } },
                { binding: 5, resource: { buffer: auxBuffer } },
                { binding: 6, resource: { buffer: outputBuffer } },
            ]
        });

        const passEncoder = commandEncoder.beginComputePass();
        passEncoder.setPipeline(this.pipeline);
        passEncoder.setBindGroup(0, bindGroup);
        passEncoder.dispatchWorkgroups(
            Math.ceil(params.minimapWidth / 8),
            Math.ceil(params.minimapHeight / 8)
        );
        passEncoder.end();
    }

    run(msaTextureView, colProfileBuffer, themeBuffer, visibleToRawBuffer, auxBuffer, outputBuffer, paramsBuffer, params) {
        const commandEncoder = this.device.createCommandEncoder();
        this.encode(
            commandEncoder,
            msaTextureView,
            colProfileBuffer,
            themeBuffer,
            visibleToRawBuffer,
            auxBuffer,
            outputBuffer,
            paramsBuffer,
            params
        );
        this.device.queue.submit([commandEncoder.finish()]);
    }
}
