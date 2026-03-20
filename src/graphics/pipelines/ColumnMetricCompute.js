export class ColumnMetricCompute {
    constructor(device, shaderCode, blosumBuffer) {
        this.device = device;
        this.countPipeline = device.createComputePipeline({
            layout: 'auto',
            compute: { module: device.createShaderModule({ code: shaderCode }), entryPoint: 'count_residues' }
        });
        this.aggregatePipeline = device.createComputePipeline({
            layout: 'auto',
            compute: { module: device.createShaderModule({ code: shaderCode }), entryPoint: 'aggregate_metrics' }
        });
        this.blosumBuffer = blosumBuffer;
    }

    encodeCount(commandEncoder, tileBuffer, intermediateBuffer, uniformBuffer, currentTileCols) {
        const bindGroup = this.device.createBindGroup({
            layout: this.countPipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: uniformBuffer } },
                { binding: 1, resource: { buffer: tileBuffer } },
                { binding: 2, resource: { buffer: intermediateBuffer } },
                // { binding: 3, resource: { buffer: uniformBuffer } },
                // { binding: 4, resource: { buffer: this.blosumBuffer } },
            ]
        })
        const pass = commandEncoder.beginComputePass();
        pass.setPipeline(this.countPipeline);
        pass.setBindGroup(0, bindGroup);
        pass.dispatchWorkgroups(Math.ceil(currentTileCols / 64), 1, 1);
        pass.end();
    }

    encodeAggregate(commandEncoder, intermediateBuffer, qualityTrackBuffer, uniformBuffer, currentTileCols) {
        const bindGroup = this.device.createBindGroup({
            layout: this.aggregatePipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: uniformBuffer } },
                // Binding 1 is msa_tile (unused in stage 2)
                { binding: 2, resource: { buffer: intermediateBuffer } },
                { binding: 3, resource: { buffer: qualityTrackBuffer } },
                { binding: 4, resource: { buffer: this.blosumBuffer } }
            ]
        });

        const pass = commandEncoder.beginComputePass();
        pass.setPipeline(this.aggregatePipeline);
        pass.setBindGroup(0, bindGroup);
        pass.dispatchWorkgroups(Math.ceil(currentTileCols / 64), 1, 1);
        pass.end();
    }

    updateUniforms(uniformBuffer, totalVerticalTiles, msaHeight, totalCols, currentRowTile, currentColStart, currentTileCols) {
        const data = new Uint32Array([totalVerticalTiles, msaHeight, totalCols, currentRowTile, currentColStart, currentTileCols]);
        this.device.queue.writeBuffer(uniformBuffer, 0, data);
    }

}
