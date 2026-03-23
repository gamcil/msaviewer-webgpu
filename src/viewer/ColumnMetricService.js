import { loadDecodedTile } from "../alignment/tiledStorage.js";

export class ColumnMetricService {
    constructor({
        device,
        gpuResources,
        pipelineRegistry,
        decodedTileCache,
        getMetricUniformBuffer,
    }) {
        this.device = device;
        this.gpuResources = gpuResources;
        this.pipelineRegistry = pipelineRegistry;
        this.decodedTileCache = decodedTileCache;
        this.getMetricUniformBuffer = getMetricUniformBuffer;
    }

    async compute({ alignmentStore, alphabet }) {
        const bucketStride = alphabet.metricConfig.bucketStride;
        const totalCols = alignmentStore.totalCols;
        const totalRows = alignmentStore.totalRows;
        const tileCols = alignmentStore.tileCols;
        const tileRows = alignmentStore.tileRows;
        const totalVerticalTiles = alignmentStore.rowTileCount;

        const metricPipeline = this.pipelineRegistry.getColumnMetricPipeline(alphabet);
        const tileBuffer = this.gpuResources.getOrCreateGrowableBuffer("metricTileBuffer", {
            minSize: tileCols * tileRows,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
        const uniformBuffer = this.getMetricUniformBuffer();
        const intermediateBuffer = this.gpuResources.getOrCreateGrowableBuffer("metricIntermediateBuffer", {
            minSize: tileCols * totalVerticalTiles * bucketStride * Uint32Array.BYTES_PER_ELEMENT,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
        const bandMetricBuffer = this.gpuResources.getOrCreateGrowableBuffer("metricBandBuffer", {
            minSize: tileCols * 7 * Float32Array.BYTES_PER_ELEMENT,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
        });
        const bandCountBuffer = this.gpuResources.getOrCreateGrowableBuffer("metricCountBuffer", {
            minSize: tileCols * bucketStride * Uint32Array.BYTES_PER_ELEMENT,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
        });

        const finalQuality = new Float32Array(totalCols);
        const finalOccupancy = new Float32Array(totalCols);
        const finalEntropy = new Float32Array(totalCols);
        const finalModalFractionNonGap = new Float32Array(totalCols);
        const finalInformationContentRaw = new Float32Array(totalCols);
        const finalConsensusIndex = new Uint16Array(totalCols);
        const finalConsensusTie = new Uint8Array(totalCols);
        const finalCounts = new Uint32Array(totalCols * bucketStride);

        for (let colTile = 0; colTile < alignmentStore.colTileCount; colTile += 1) {
            const colStart = colTile * tileCols;
            const colsInBand = Math.min(tileCols, totalCols - colStart);
            this.device.queue.writeBuffer(
                intermediateBuffer, 0, new Uint32Array(colsInBand * totalVerticalTiles * bucketStride)
            );

            for (let rowTile = 0; rowTile < totalVerticalTiles; rowTile += 1) {
                const tileIndex = rowTile * alignmentStore.colTileCount + colTile;
                const tileData = await loadDecodedTile(alignmentStore, tileIndex, this.decodedTileCache);
                this.device.queue.writeBuffer(tileBuffer, 0, tileData);
                metricPipeline.updateUniforms(
                    uniformBuffer,
                    totalVerticalTiles,
                    totalRows,
                    totalCols,
                    rowTile,
                    colStart,
                    colsInBand
                );
                const encoder = this.device.createCommandEncoder();
                metricPipeline.encodeCount(
                    encoder,
                    tileBuffer,
                    intermediateBuffer,
                    uniformBuffer,
                    colsInBand
                );
                this.device.queue.submit([encoder.finish()]);
            }

            {
                const encoder = this.device.createCommandEncoder();
                metricPipeline.updateUniforms(
                    uniformBuffer,
                    totalVerticalTiles,
                    totalRows,
                    totalCols,
                    0,
                    colStart,
                    colsInBand
                );
                metricPipeline.encodeAggregate(
                    encoder,
                    intermediateBuffer,
                    bandMetricBuffer,
                    uniformBuffer,
                    colsInBand,
                    bandCountBuffer,
                );
                this.device.queue.submit([encoder.finish()]);
            }

            const bandMetrics = await this.readMetricBandBuffer(bandMetricBuffer, colsInBand * 7);
            const bandCounts = await this.readCountBandBuffer(bandCountBuffer, colsInBand * bucketStride);
            for (let i = 0; i < colsInBand; i += 1) {
                const offset = i * 7;
                finalQuality[colStart + i] = bandMetrics[offset];
                finalOccupancy[colStart + i] = bandMetrics[offset + 1];
                finalEntropy[colStart + i] = bandMetrics[offset + 2];
                finalModalFractionNonGap[colStart + i] = bandMetrics[offset + 3];
                finalInformationContentRaw[colStart + i] = bandMetrics[offset + 4];
                finalConsensusIndex[colStart + i] = Math.round(bandMetrics[offset + 5]);
                finalConsensusTie[colStart + i] = Math.round(bandMetrics[offset + 6]);

                const countSrc = i * bucketStride;
                const countDst = (colStart + i) * bucketStride;
                finalCounts.set(bandCounts.subarray(countSrc, countSrc + bucketStride), countDst);
            }
        }

        return {
            quality: finalQuality,
            occupancy: finalOccupancy,
            entropy: finalEntropy,
            modalFractionNonGap: finalModalFractionNonGap,
            informationContentRaw: finalInformationContentRaw,
            consensusIndex: finalConsensusIndex,
            consensusTie: finalConsensusTie,
            counts: finalCounts,
        };
    }

    async readMetricBandBuffer(metricBuffer, floatCount) {
        const byteLength = floatCount * Float32Array.BYTES_PER_ELEMENT;
        const readbackBuffer = this.gpuResources.getOrCreateGrowableBuffer("metricReadbackBuffer", {
            minSize: byteLength,
            usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
        });
        const encoder = this.device.createCommandEncoder();
        encoder.copyBufferToBuffer(metricBuffer, 0, readbackBuffer, 0, byteLength);
        this.device.queue.submit([encoder.finish()]);
        await readbackBuffer.mapAsync(GPUMapMode.READ, 0, byteLength);
        const copy = new Float32Array(readbackBuffer.getMappedRange(0, byteLength)).slice();
        readbackBuffer.unmap();
        return copy;
    }

    async readCountBandBuffer(countBuffer, countValueCount) {
        const byteLength = countValueCount * Uint32Array.BYTES_PER_ELEMENT;
        const readbackBuffer = this.gpuResources.getOrCreateGrowableBuffer("countsReadbackBuffer", {
            minSize: byteLength,
            usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
        });
        const encoder = this.device.createCommandEncoder();
        encoder.copyBufferToBuffer(countBuffer, 0, readbackBuffer, 0, byteLength);
        this.device.queue.submit([encoder.finish()]);
        await readbackBuffer.mapAsync(GPUMapMode.READ, 0, byteLength);
        const copy = new Uint32Array(readbackBuffer.getMappedRange(0, byteLength)).slice();
        readbackBuffer.unmap();
        return copy;
    }
}
