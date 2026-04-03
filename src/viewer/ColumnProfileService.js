import { SCHEMES } from "../schemes/registry.js";
import { materializeWindowFromTiles } from "../alignment/tiledStorage.js";
import { computeColumnProfileDataCpu } from "./backends/cpu/computeColumnProfileCpu.js";

export class ColumnProfileService {
    constructor({
        backend = "webgpu",
        device,
        gpuResources,
        pipelineRegistry,
        decodedTileCache,
    }) {
        this.backend = backend;
        this.device = device;
        this.gpuResources = gpuResources;
        this.pipelineRegistry = pipelineRegistry;
        this.decodedTileCache = decodedTileCache;
    }

    async compute({
        alignmentStore,
        alignmentState,
        schemeKey,
        columnMetrics = null,
        alphabet = null,
    }) {
        const activeScheme = SCHEMES[schemeKey];
        if (this.backend === "cpu") {
            alignmentState.colProfileData = activeScheme.type === "columnStatistic"
                ? computeColumnProfileDataCpu({
                    columnMetrics,
                    alphabet,
                    schemeKey,
                })
                : new Uint32Array(alignmentState.totalCols);
            return;
        }
        if (activeScheme.type !== "columnStatistic") {
            this.device.queue.writeBuffer(
                alignmentState.colProfileBuffer,
                0,
                new Uint32Array(alignmentState.totalCols),
            );
            return;
        }

        const totalCols = alignmentStore.totalCols;
        const totalRows = alignmentStore.totalRows;
        const maxTextureDim = this.device.limits.maxTextureDimension2D ?? 8192;
        const maxLayers = this.device.limits.maxTextureArrayLayers ?? 256;
        const rowsPerLayer = Math.min(totalRows, maxTextureDim);
        const requiredLayers = Math.ceil(totalRows / rowsPerLayer);
        if (requiredLayers > maxLayers) {
            throw new Error(`Alignment row count exceeds texture array layer limit (${requiredLayers} > ${maxLayers}).`);
        }

        const chunkCols = Math.min(totalCols, maxTextureDim);
        const computePipeline = this.pipelineRegistry.getColumnProfilePipeline(schemeKey);

        for (let colStart = 0; colStart < totalCols; colStart += chunkCols) {
            const colsInChunk = Math.min(chunkCols, totalCols - colStart);
            const chunkData = await materializeWindowFromTiles(
                alignmentStore,
                0,
                totalRows,
                colStart,
                colsInChunk,
                this.decodedTileCache
            );
            const chunkTexture = this.device.createTexture({
                size: [colsInChunk, rowsPerLayer, requiredLayers],
                format: "r8uint",
                usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
            });

            for (let layer = 0; layer < requiredLayers; layer += 1) {
                const layerRowStart = layer * rowsPerLayer;
                const layerRows = Math.min(rowsPerLayer, totalRows - layerRowStart);
                const layerByteStart = layerRowStart * colsInChunk;
                const layerByteEnd = layerByteStart + layerRows * colsInChunk;
                this.device.queue.writeTexture(
                    {
                        texture: chunkTexture,
                        origin: { x: 0, y: 0, z: layer },
                    },
                    chunkData.subarray(layerByteStart, layerByteEnd),
                    {
                        offset: 0,
                        bytesPerRow: colsInChunk,
                        rowsPerImage: layerRows,
                    },
                    [colsInChunk, layerRows, 1]
                );
            }

            const chunkBuffer = this.gpuResources.getOrCreateGrowableBuffer("profileChunkBuffer", {
                minSize: colsInChunk * activeScheme.profileStride,
                usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
            });
            const commandEncoder = this.device.createCommandEncoder();
            computePipeline.encode(
                commandEncoder,
                chunkTexture.createView({ dimension: "2d-array", arrayLayerCount: requiredLayers }),
                chunkBuffer,
                colsInChunk,
                totalRows,
                rowsPerLayer
            );
            commandEncoder.copyBufferToBuffer(
                chunkBuffer,
                0,
                alignmentState.colProfileBuffer,
                colStart * activeScheme.profileStride,
                colsInChunk * activeScheme.profileStride
            );
            this.device.queue.submit([commandEncoder.finish()]);
            chunkTexture.destroy();
        }

        await this.device.queue.onSubmittedWorkDone();
    }
}
