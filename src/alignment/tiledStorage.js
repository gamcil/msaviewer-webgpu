export const DEFAULT_TILE_ROWS = 256;
export const DEFAULT_TILE_COLS = 512;


// Cache decoded tiles and keep the current viewport window resident.
export class TileCache {
    constructor(maxBytes) {
        this.maxBytes = maxBytes;
        this.bytes = 0;
        this.map = new Map();
        this.retainedKeys = new Set();
    }

    has(key) {
        return this.map.has(key);
    }
    
    get(key) {
        const value = this.map.get(key);
        if (!value) return null;
        if (!this.retainedKeys.has(key)) {
            this.map.delete(key);
            this.map.set(key, value);
        }
        return value.entry;
    }
    
    set(key, entry, byteLength = 0) {
        const existing = this.map.get(key);
        if (existing && existing.kind === "data") {
            this.bytes -= existing.byteLength;
        }
        this.map.delete(key);
        this.map.set(key, {
            entry,
            kind: entry instanceof Uint8Array ? "data" : "pending",
            byteLength,
        });
        if (entry instanceof Uint8Array) {
            this.bytes += byteLength;
            this.evict();
        }
    }
    
    delete(key) {
        const existing = this.map.get(key);
        if (!existing) return;
        if (existing.kind === "data") {
            this.bytes -= existing.byteLength;
        }
        this.retainedKeys.delete(key);
        this.map.delete(key);
    }

    retain(keys) {
        this.retainedKeys = new Set(keys);
        for (const key of keys) {
            if (!this.map.has(key)) continue;
            const value = this.map.get(key);
            this.map.delete(key);
            this.map.set(key, value);
        }
        this.evict();
    }
    
    evict() {
        for (const [key, value] of this.map) {
            if (this.bytes <= this.maxBytes) break;
            if (this.retainedKeys.has(key)) continue;
            if (value.kind === "pending") continue;
            this.map.delete(key);
            this.bytes -= value.byteLength;
        }
    }
    
    clear() {
        this.map.clear();
        this.bytes = 0;
        this.retainedKeys.clear();
    }
}

function encodeAsciiRow(sequence) {
    const row = new Uint8Array(sequence.length);
    for (let i = 0; i < sequence.length; i += 1) {
        row[i] = sequence.charCodeAt(i);
    }
    return row;
}

// factory method for processing incoming rows from a3m/fasta parsers
// creates Blobs for tiles of a given size (def. 256x512)
export function createTiledAlignmentBuilder(totalCols, options = {}) {
    if (!Number.isInteger(totalCols) || totalCols <= 0) {
        throw new Error("Tiled alignment builder requires a positive total column count.");
    }

    const tileRows = options.tileRows ?? DEFAULT_TILE_ROWS;
    const tileCols = options.tileCols ?? DEFAULT_TILE_COLS;
    const colTileCount = Math.ceil(totalCols / tileCols);

    let totalRows = 0;
    let currentBandRowStart = 0;
    let rowsInBand = 0;
    let bandTiles = Array.from({ length: colTileCount }, () => new Uint8Array(tileRows * tileCols));
    const tiles = [];

    const sealCurrentBand = () => {
        if (rowsInBand === 0) return;
        const rowTile = Math.floor(currentBandRowStart / tileRows);
        for (let colTile = 0; colTile < colTileCount; colTile += 1) {
            const tile = bandTiles[colTile];
            const colStart = colTile * tileCols;
            const colCount = Math.min(tileCols, totalCols - colStart);
            const usedBytes = rowsInBand * tileCols;
            tiles.push({
                key: `${rowTile}:${colTile}`,
                rowTile,
                colTile,
                rowStart: currentBandRowStart,
                rowCount: rowsInBand,
                colStart,
                colCount,
                blob: new Blob([tile.subarray(0, usedBytes)], { type: "application/octet-stream" }),
            });
        }
        currentBandRowStart = totalRows;
        rowsInBand = 0;
        bandTiles = Array.from({ length: colTileCount }, () => new Uint8Array(tileRows * tileCols));
    };

    return {
        appendRow(row) {
            const rowBytes = typeof row === "string" ? encodeAsciiRow(row) : row;
            if (!(rowBytes instanceof Uint8Array)) {
                throw new Error("Alignment rows must be strings or Uint8Array instances.");
            }
            if (rowBytes.length !== totalCols) {
                throw new Error(`Expected row length ${totalCols}, received ${rowBytes.length}.`);
            }
            const rowInBand = rowsInBand;
            for (let colTile = 0; colTile < colTileCount; colTile += 1) {
                const colStart = colTile * tileCols;
                const colEnd = Math.min(colStart + tileCols, totalCols);
                const tileOffset = rowInBand * tileCols;
                bandTiles[colTile].set(rowBytes.subarray(colStart, colEnd), tileOffset);
            }
            rowsInBand += 1;
            totalRows += 1;
            if (rowsInBand === tileRows) {
                sealCurrentBand();
            }
        },
        finalize(records) {
            sealCurrentBand();
            return {
                records,
                totalRows,
                totalCols,
                tileRows,
                tileCols,
                rowTileCount: Math.ceil(totalRows / tileRows),
                colTileCount,
                tiles,
            };
        },
    };
}

export function getTileIndex(alignment, rowTile, colTile) {
    return rowTile * alignment.colTileCount + colTile;
}

export function getTileCacheKey(alignment, tileIndex) {
    return alignment.tiles[tileIndex] ?? tileIndex;
}

export function getTileIndicesForWindow(alignment, rowStart, rowCount, colStart, colCount) {
    const rowEnd = Math.min(rowStart + rowCount, alignment.totalRows);
    const colEnd = Math.min(colStart + colCount, alignment.totalCols);
    if (rowEnd <= rowStart || colEnd <= colStart) {
        return [];
    }
    const firstRowTile = Math.floor(rowStart / alignment.tileRows);
    const lastRowTile = Math.floor((rowEnd - 1) / alignment.tileRows);
    const firstColTile = Math.floor(colStart / alignment.tileCols);
    const lastColTile = Math.floor((colEnd - 1) / alignment.tileCols);
    const indices = [];
    for (let rowTile = firstRowTile; rowTile <= lastRowTile; rowTile += 1) {
        for (let colTile = firstColTile; colTile <= lastColTile; colTile += 1) {
            indices.push(getTileIndex(alignment, rowTile, colTile));
        }
    }
    return indices;
}

export function getTileCacheKeysForWindow(alignment, rowStart, rowCount, colStart, colCount) {
    return getTileIndicesForWindow(alignment, rowStart, rowCount, colStart, colCount)
        .map((tileIndex) => getTileCacheKey(alignment, tileIndex));
}

export async function loadDecodedTile(alignment, tileIndex, cache) {
    const cacheKey = getTileCacheKey(alignment, tileIndex);
    const cached = cache?.get(cacheKey);
    if (cached) {
        return await cached;
    }
    const tile = alignment.tiles[tileIndex];
    if (!tile) {
        throw new Error(`Tile index ${tileIndex} is out of range.`);
    }

    const pending = tile.blob.arrayBuffer().then((buffer) => {
        const decoded = new Uint8Array(buffer);
        cache?.set(cacheKey, decoded, decoded.byteLength);
        return decoded;
    });

    cache?.set(cacheKey, pending);

    try {
        return await pending;
    } catch (error) {
        if (cache?.get(cacheKey) === pending) {
            cache.delete(cacheKey);
        }
        throw error;
    }
}

export async function materializeWindowFromTiles(alignment, rowStart, rowCount, colStart, colCount, cache = null) {
    const out = new Uint8Array(rowCount * colCount);
    const rowEnd = Math.min(rowStart + rowCount, alignment.totalRows);
    const colEnd = Math.min(colStart + colCount, alignment.totalCols);
    if (rowEnd <= rowStart || colEnd <= colStart) {
        return out;
    }
    const firstRowTile = Math.floor(rowStart / alignment.tileRows);
    const lastRowTile = Math.floor((rowEnd - 1) / alignment.tileRows);
    const firstColTile = Math.floor(colStart / alignment.tileCols);
    const lastColTile = Math.floor((colEnd - 1) / alignment.tileCols);
    const promises = [];
    for (let rowTile = firstRowTile; rowTile <= lastRowTile; rowTile += 1) {
        for (let colTile = firstColTile; colTile <= lastColTile; colTile += 1) {
            const tileIndex = getTileIndex(alignment, rowTile, colTile);
            const tileMeta = alignment.tiles[tileIndex];
            promises.push(
                loadDecodedTile(alignment, tileIndex, cache).then((tileData) => ({ tileMeta, tileData }))
            );
        }
    }
    const decodedTiles = await Promise.all(promises);
    for (const { tileMeta, tileData } of decodedTiles) {
        const overlapRowStart = Math.max(rowStart, tileMeta.rowStart);
        const overlapRowEnd = Math.min(rowEnd, tileMeta.rowStart + tileMeta.rowCount);
        const overlapColStart = Math.max(colStart, tileMeta.colStart);
        const overlapColEnd = Math.min(colEnd, tileMeta.colStart + tileMeta.colCount);

        for (let row = overlapRowStart; row < overlapRowEnd; row += 1) {
            const sourceRowOffset = (row - tileMeta.rowStart) * alignment.tileCols;
            const sourceStart = sourceRowOffset + (overlapColStart - tileMeta.colStart);
            const sourceEnd = sourceRowOffset + (overlapColEnd - tileMeta.colStart);
            const targetRowOffset = (row - rowStart) * colCount;
            const targetStart = targetRowOffset + (overlapColStart - colStart);
            out.set(tileData.subarray(sourceStart, sourceEnd), targetStart);
        }
    }

    return out;
}
