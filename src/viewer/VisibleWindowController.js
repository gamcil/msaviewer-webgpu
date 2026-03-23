import { getTileIndicesForWindow, materializeWindowFromTiles } from "../alignment/tiledStorage.js";

export class VisibleWindowController {
    constructor({
        device,
        decodedTileCache,
    }) {
        this.device = device;
        this.decodedTileCache = decodedTileCache;
        this.state = null;
    }

    async update({
        alignmentStore,
        bounds,
    }) {
        const { rowStart, rowEnd, colStart, colEnd } = bounds;
        const rowCount = rowEnd - rowStart;
        const colCount = colEnd - colStart;
        if (rowCount <= 0 || colCount <= 0) {
            return null;
        }

        const key = `${rowStart}:${rowCount}:${colStart}:${colCount}`;
        if (this.state?.key === key) {
            return this.state;
        }

        const data = await materializeWindowFromTiles(
            alignmentStore,
            rowStart,
            rowCount,
            colStart,
            colCount,
            this.decodedTileCache
        );

        const previousTexture = this.state?.texture ?? null;
        const needsNewTexture =
            !previousTexture ||
            this.state.rowCount !== rowCount ||
            this.state.colCount !== colCount;

        const texture = needsNewTexture
            ? this.device.createTexture({
                size: [Math.max(1, colCount), Math.max(1, rowCount), 1],
                format: "r8uint",
                usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
            })
            : previousTexture;

        this.device.queue.writeTexture(
            { texture },
            data,
            {
                offset: 0,
                bytesPerRow: Math.max(1, colCount),
                rowsPerImage: Math.max(1, rowCount),
            },
            [Math.max(1, colCount), Math.max(1, rowCount), 1]
        );

        this.state = { key, rowStart, rowCount, colStart, colCount, texture };
        this.decodedTileCache.retain(
            getTileIndicesForWindow(alignmentStore, rowStart, rowCount, colStart, colCount)
        );

        if (needsNewTexture && previousTexture) {
            previousTexture.destroy();
        }

        return this.state;
    }

    clear() {
        this.state?.texture?.destroy?.();
        this.state = null;
    }
}
