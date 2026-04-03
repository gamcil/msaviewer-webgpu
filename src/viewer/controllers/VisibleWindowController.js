import { materializeProjectedWindow } from "../projectedWindow.js";

export class VisibleWindowController {
    constructor({
        backend = "webgpu",
        device,
        gpuResources,
        decodedTileCache,
    }) {
        this.backend = backend;
        this.device = device;
        this.gpuResources = gpuResources;
        this.decodedTileCache = decodedTileCache;
        this.state = null;
    }

    async materializeVisibleWindow(alignmentStore, rowStart, rowCount, colStart, colCount, columnVisibility) {
        return materializeProjectedWindow({
            alignmentStore,
            rowStart,
            rowCount,
            colStart,
            colCount,
            columnVisibility,
            decodedTileCache: this.decodedTileCache,
            includeRetainedTiles: true,
        });
    }

    async update({
        alignmentStore,
        bounds,
        columnVisibility = null,
    }) {
        const { rowStart, rowEnd, colStart, colEnd } = bounds;
        const rowCount = rowEnd - rowStart;
        const colCount = colEnd - colStart;
        if (rowCount <= 0 || colCount <= 0) {
            return null;
        }

        const visibilityKey = columnVisibility
            ? `${columnVisibility.mode}:${columnVisibility.visibleCount}:${columnVisibility.signature}`
            : "raw";
        const key = `${rowStart}:${rowCount}:${colStart}:${colCount}:${visibilityKey}`;
        if (this.state?.key === key) {
            return this.state;
        }

        const {
            data,
            columnMap,
            rawTextureCols,
            retainedTiles,
        } = await this.materializeVisibleWindow(
            alignmentStore,
            rowStart,
            rowCount,
            colStart,
            colCount,
            columnVisibility
        );

        const previousTexture = this.state?.texture ?? null;
        const previousVisibleColumnMapBuffer = this.state?.visibleColumnMapBuffer ?? null;
        const needsNewTexture =
            !previousTexture ||
            this.state.rowCount !== rowCount ||
            this.state.rawTextureCols !== rawTextureCols;
        const needsNewVisibleColumnMapBuffer =
            !previousVisibleColumnMapBuffer ||
            this.state.colCount !== colCount;

        const texture = this.backend === "webgpu"
            ? (needsNewTexture
                ? this.device.createTexture({
                    size: [Math.max(1, rawTextureCols), Math.max(1, rowCount), 1],
                    format: "r8uint",
                    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
                })
                : previousTexture)
            : null;
        const visibleColumnMapBuffer = this.backend === "webgpu"
            ? (needsNewVisibleColumnMapBuffer
                ? this.device.createBuffer({
                    size: Math.max(1, colCount * 2) * Uint32Array.BYTES_PER_ELEMENT,
                    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
                })
                : previousVisibleColumnMapBuffer)
            : null;

        if (this.backend === "webgpu") {
            this.device.queue.writeTexture(
                { texture },
                data,
                {
                    offset: 0,
                    bytesPerRow: Math.max(1, rawTextureCols),
                    rowsPerImage: Math.max(1, rowCount),
                },
                [Math.max(1, rawTextureCols), Math.max(1, rowCount), 1]
            );
            this.device.queue.writeBuffer(visibleColumnMapBuffer, 0, columnMap);
        }

        this.state = {
            key,
            rowStart,
            rowCount,
            colStart,
            colCount,
            rawTextureCols,
            texture,
            visibleColumnMapBuffer,
            data,
            columnMap,
        };
        this.decodedTileCache.retain(retainedTiles);

        if (needsNewTexture && previousTexture) {
            previousTexture.destroy();
        }
        if (needsNewVisibleColumnMapBuffer && previousVisibleColumnMapBuffer) {
            previousVisibleColumnMapBuffer.destroy();
        }

        return this.state;
    }

    clear() {
        this.state?.texture?.destroy?.();
        this.state?.visibleColumnMapBuffer?.destroy?.();
        this.state = null;
    }
}
