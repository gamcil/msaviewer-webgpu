import { getTileCacheKeysForWindow, materializeWindowFromTiles } from "../alignment/tiledStorage.js";

export function buildVisibleColumnMap(colStart, colCount, columnVisibility) {
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

export function getProjectedChunkColCount(totalCols, colStart, maxVisibleChunkCols, maxTextureDim, columnVisibility) {
    const remainingCols = totalCols - colStart;
    if (remainingCols <= 0) return 0;
    const maxCols = Math.min(maxVisibleChunkCols, remainingCols);
    if (!columnVisibility) return maxCols;

    const visibleToRaw = columnVisibility.visibleToRaw;
    const firstRawCol = visibleToRaw[colStart];
    let low = colStart + 1;
    let high = colStart + maxCols;
    let bestEndExclusive = colStart + 1;
    while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        const lastRawCol = visibleToRaw[mid - 1];
        const rawSpan = lastRawCol - firstRawCol + 1;
        if (rawSpan <= maxTextureDim) {
            bestEndExclusive = mid;
            low = mid + 1;
        } else {
            high = mid - 1;
        }
    }
    return Math.max(1, bestEndExclusive - colStart);
}

export async function materializeProjectedWindow({
    alignmentStore,
    rowStart,
    rowCount,
    colStart,
    colCount,
    columnVisibility = null,
    decodedTileCache,
    includeRetainedTiles = false,
}) {
    if (!columnVisibility) {
        const data = await materializeWindowFromTiles(
            alignmentStore,
            rowStart,
            rowCount,
            colStart,
            colCount,
            decodedTileCache
        );
        const columnMap = new Uint32Array(colCount * 2);
        for (let i = 0; i < colCount; i += 1) {
            const mapOffset = i * 2;
            columnMap[mapOffset] = colStart + i;
            columnMap[mapOffset + 1] = i;
        }
        return {
            data,
            columnMap,
            rawTextureCols: colCount,
            retainedTiles: includeRetainedTiles
                ? getTileCacheKeysForWindow(alignmentStore, rowStart, rowCount, colStart, colCount)
                : null,
        };
    }

    const { columnMap, minRawCol, rawColCount } = buildVisibleColumnMap(
        colStart,
        colCount,
        columnVisibility
    );
    if (columnMap.length === 0) {
        return {
            data: new Uint8Array(0),
            columnMap,
            rawTextureCols: 0,
            retainedTiles: includeRetainedTiles ? [] : null,
        };
    }

    const data = await materializeWindowFromTiles(
        alignmentStore,
        rowStart,
        rowCount,
        minRawCol,
        rawColCount,
        decodedTileCache
    );

    return {
        data,
        columnMap,
        rawTextureCols: rawColCount,
        retainedTiles: includeRetainedTiles
            ? getTileCacheKeysForWindow(alignmentStore, rowStart, rowCount, minRawCol, rawColCount)
            : null,
    };
}
