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
        } = await materializeProjectedWindow({
            alignmentStore,
            rowStart,
            rowCount,
            colStart,
            colCount,
            columnVisibility,
            decodedTileCache: this.decodedTileCache,
            includeRetainedTiles: true,
        });

        const prevTexture = this.state?.texture ?? null;
        const prevColumnMapBuffer = this.state?.visibleColumnMapBuffer ?? null;
        const resizeTexture =
            !prevTexture ||
            this.state.rowCount !== rowCount ||
            this.state.rawTextureCols !== rawTextureCols;
        const resizeColumnMap =
            !prevColumnMapBuffer ||
            this.state.colCount !== colCount;

        const texture = this.backend === "webgpu"
            ? (resizeTexture
                ? this.device.createTexture({
                    size: [Math.max(1, rawTextureCols), Math.max(1, rowCount), 1],
                    format: "r8uint",
                    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
                })
                : prevTexture)
            : null;
        const columnMapBuffer = this.backend === "webgpu"
            ? (resizeColumnMap
                ? this.device.createBuffer({
                    size: Math.max(1, colCount * 2) * Uint32Array.BYTES_PER_ELEMENT,
                    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
                })
                : prevColumnMapBuffer)
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
            this.device.queue.writeBuffer(columnMapBuffer, 0, columnMap);
        }

        this.state = {
            key,
            rowStart,
            rowCount,
            colStart,
            colCount,
            rawTextureCols,
            texture,
            visibleColumnMapBuffer: columnMapBuffer,
            data,
            columnMap,
        };
        this.decodedTileCache.retain(retainedTiles);

        if (resizeTexture && prevTexture) {
            prevTexture.destroy();
        }
        if (resizeColumnMap && prevColumnMapBuffer) {
            prevColumnMapBuffer.destroy();
        }

        return this.state;
    }

    clear() {
        this.state?.texture?.destroy?.();
        this.state?.visibleColumnMapBuffer?.destroy?.();
        this.state = null;
    }
}
