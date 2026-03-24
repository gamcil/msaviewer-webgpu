import { getTileIndicesForWindow, materializeWindowFromTiles } from "../alignment/tiledStorage.js";

export class VisibleWindowController {
    constructor({
        device,
        gpuResources,
        decodedTileCache,
    }) {
        this.device = device;
        this.gpuResources = gpuResources;
        this.decodedTileCache = decodedTileCache;
        this.state = null;
    }

    buildVisibleColumnMap(colStart, colCount, columnVisibility) {
        const rawCols = columnVisibility.visibleToRaw.subarray(colStart, colStart + colCount);
        if (rawCols.length === 0) {
            return {
                columnMap: new Uint32Array(0),
                minRawCol: 0,
                rawColCount: 0,
            };
        }

        let minRawCol = rawCols[0];
        let maxRawCol = rawCols[0];
        for (let i = 1; i < rawCols.length; i += 1) {
            const rawCol = rawCols[i];
            if (rawCol < minRawCol) minRawCol = rawCol;
            if (rawCol > maxRawCol) maxRawCol = rawCol;
        }

        const rawColCount = maxRawCol - minRawCol + 1;
        const columnMap = new Uint32Array(rawCols.length * 2);
        for (let i = 0; i < rawCols.length; i += 1) {
            const rawCol = rawCols[i];
            const mapOffset = i * 2;
            columnMap[mapOffset] = rawCol;
            columnMap[mapOffset + 1] = rawCol - minRawCol;
        }

        return {
            columnMap,
            minRawCol,
            rawColCount,
        };
    }

    async materializeVisibleWindow(alignmentStore, rowStart, rowCount, colStart, colCount, columnVisibility) {
        if (!columnVisibility) {
            const data = await materializeWindowFromTiles(
                alignmentStore,
                rowStart,
                rowCount,
                colStart,
                colCount,
                this.decodedTileCache
            );
            const columnMap = new Uint32Array(colCount * 2);
            for (let i = 0; i < colCount; i += 1) {
                const mapOffset = i * 2;
                columnMap[mapOffset] = colStart + i;
                columnMap[mapOffset + 1] = i;
            }
            const retainedTiles = getTileIndicesForWindow(alignmentStore, rowStart, rowCount, colStart, colCount);
            return { data, columnMap, rawTextureCols: colCount, retainedTiles };
        }

        const { columnMap, minRawCol, rawColCount } = this.buildVisibleColumnMap(
            colStart,
            colCount,
            columnVisibility
        );
        if (columnMap.length === 0) {
            return { data: new Uint8Array(0), columnMap, rawTextureCols: 0, retainedTiles: [] };
        }

        const rawWindow = await materializeWindowFromTiles(
            alignmentStore,
            rowStart,
            rowCount,
            minRawCol,
            rawColCount,
            this.decodedTileCache
        );

        const retainedTiles = getTileIndicesForWindow(alignmentStore, rowStart, rowCount, minRawCol, rawColCount);
        return { data: rawWindow, columnMap, rawTextureCols: rawColCount, retainedTiles };
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

        const texture = needsNewTexture
            ? this.device.createTexture({
                size: [Math.max(1, rawTextureCols), Math.max(1, rowCount), 1],
                format: "r8uint",
                usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
            })
            : previousTexture;
        const visibleColumnMapBuffer = needsNewVisibleColumnMapBuffer
            ? this.device.createBuffer({
                size: Math.max(1, colCount * 2) * Uint32Array.BYTES_PER_ELEMENT,
                usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
            })
            : previousVisibleColumnMapBuffer;

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

        this.state = { key, rowStart, rowCount, colStart, colCount, rawTextureCols, texture, visibleColumnMapBuffer };
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
