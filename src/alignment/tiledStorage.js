export const DEFAULT_TILE_ROWS = 256;
export const DEFAULT_TILE_COLS = 512;
const OPFS_DIRECTORY_NAME = "msa-viewer";
const OPFS_ALIGNMENT_FILE_NAME = "alignment.bin";
const OPFS_SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function supportsOpfs() {
    return typeof navigator !== "undefined"
        && typeof navigator.storage?.getDirectory === "function";
}

function createSessionId() {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
        return `session-${Date.now()}-${crypto.randomUUID()}`;
    }
    return `session-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function getSessionCreatedAt(sessionName) {
    const match = /^session-(\d+)-/.exec(sessionName);
    const createdAt = Number(match?.[1]);
    return Number.isFinite(createdAt) ? createdAt : null;
}

function getSessionLockName(sessionName) {
    return `${OPFS_DIRECTORY_NAME}:${sessionName}`;
}

async function acquireSessionLock(sessionName) {
    if (typeof navigator === "undefined" || typeof navigator.locks?.request !== "function") {
        return null;
    }
    let release;
    let acquired;
    const released = new Promise((resolve) => {
        release = resolve;
    });
    const acquiredPromise = new Promise((resolve) => {
        acquired = resolve;
    });
    let lockError = null;
    const lockPromise = navigator.locks.request(getSessionLockName(sessionName), async () => {
        acquired();
        await released;
    }).catch((error) => {
        lockError = error;
        acquired();
    });
    await acquiredPromise;
    if (lockError) {
        return null;
    }
    return {
        async release() {
            release();
            await lockPromise;
        },
    };
}

async function removeStaleSessions(viewerDirectory) {
    if (typeof navigator === "undefined" || typeof navigator.locks?.request !== "function") {
        return;
    }
    const cutoff = Date.now() - OPFS_SESSION_MAX_AGE_MS;
    for await (const [sessionName, entry] of viewerDirectory.entries()) {
        if (entry.kind !== "directory" || (getSessionCreatedAt(sessionName) ?? Infinity) > cutoff) {
            continue;
        }
        await navigator.locks.request(
            getSessionLockName(sessionName),
            { ifAvailable: true },
            async (lock) => {
                if (lock) {
                    await viewerDirectory.removeEntry(sessionName, { recursive: true }).catch(() => {});
                }
            }
        ).catch(() => {});
    }
}

function createOpfsTileReader() {
    if (typeof Worker === "undefined") {
        return null;
    }

    let worker;
    try {
        worker = new Worker(new URL("./opfsTileReader.worker.js", import.meta.url), { type: "module" });
    } catch {
        return null;
    }
    const pending = new Map();
    let nextRequestId = 1;
    let closed = false;

    const rejectPending = (error) => {
        for (const { reject } of pending.values()) {
            reject(error);
        }
        pending.clear();
    };

    worker.onmessage = ({ data }) => {
        const request = pending.get(data.id);
        if (!request) return;
        pending.delete(data.id);
        if (data.error) {
            request.reject(new Error(data.error));
        } else {
            request.resolve(data);
        }
    };
    worker.onerror = (event) => {
        closed = true;
        worker.terminate();
        rejectPending(event.error ?? new Error(event.message || "OPFS tile reader failed."));
    };

    const request = (type, payload = {}) => {
        if (closed) {
            return Promise.reject(new Error("OPFS tile reader has been closed."));
        }
        const id = nextRequestId;
        nextRequestId += 1;
        return new Promise((resolve, reject) => {
            pending.set(id, { resolve, reject });
            worker.postMessage({ id, type, ...payload });
        });
    };

    return {
        async open(fileHandle) {
            try {
                await request("open", { fileHandle });
                return true;
            } catch {
                await this.destroy();
                return false;
            }
        },
        async read(tile) {
            const { buffer } = await request("read", {
                byteOffset: tile.byteOffset,
                byteLength: tile.byteLength,
            });
            return new Uint8Array(buffer);
        },
        async destroy() {
            if (closed) return;
            try {
                await request("close");
            } catch {
                // Terminating the worker also releases its access handle.
            }
            closed = true;
            worker.terminate();
            rejectPending(new Error("OPFS tile reader has been closed."));
        },
    };
}

function createOpfsTileStorage({
    viewerDirectory,
    sessionName,
    fileHandle,
    writable,
    sessionLock = null,
    createReader = true,
    releaseLockOnFinalize = false,
}) {
    let byteOffset = 0;
    let closed = !writable;
    let file = null;
    let tileReader = null;

    const releaseLock = async () => {
        await sessionLock?.release();
        sessionLock = null;
    };

    const close = async () => {
        if (closed) return;
        await writable.close();
        closed = true;
    };

    return {
        ephemeral: true,
        async write(bytes) {
            if (closed || !writable) {
                throw new Error("Cannot write to a finalized OPFS alignment store.");
            }
            const offset = byteOffset;
            await writable.write({ type: "write", position: offset, data: bytes });
            byteOffset += bytes.byteLength;
            return { byteOffset: offset, byteLength: bytes.byteLength };
        },
        async finalize() {
            await close();
            if (createReader) {
                const nextTileReader = createOpfsTileReader();
                if (nextTileReader && await nextTileReader.open(fileHandle)) {
                    tileReader = nextTileReader;
                }
            }
            if (releaseLockOnFinalize) {
                await releaseLock();
            }
        },
        async read(tile) {
            if (tileReader) {
                return tileReader.read(tile);
            }
            file ??= await fileHandle.getFile();
            return new Uint8Array(
                await file.slice(tile.byteOffset, tile.byteOffset + tile.byteLength).arrayBuffer()
            );
        },
        async destroy() {
            try {
                await tileReader?.destroy();
                tileReader = null;
                if (!closed) {
                    await writable.abort?.();
                    closed = true;
                }
            } finally {
                try {
                    await viewerDirectory.removeEntry(sessionName, { recursive: true });
                } finally {
                    await releaseLock();
                }
            }
        },
        describe() {
            return { type: "opfs", sessionName };
        },
    };
}

async function createOpfsTileStorageForWrite({
    createReader = true,
    releaseLockOnFinalize = false,
} = {}) {
    const root = await navigator.storage.getDirectory();
    const viewerDirectory = await root.getDirectoryHandle(OPFS_DIRECTORY_NAME, { create: true });
    const sessionName = createSessionId();
    const sessionLock = await acquireSessionLock(sessionName);
    try {
        const sessionDirectory = await viewerDirectory.getDirectoryHandle(sessionName, { create: true });
        const fileHandle = await sessionDirectory.getFileHandle(OPFS_ALIGNMENT_FILE_NAME, { create: true });
        const writable = await fileHandle.createWritable();
        return createOpfsTileStorage({
            viewerDirectory,
            sessionName,
            fileHandle,
            writable,
            sessionLock,
            createReader,
            releaseLockOnFinalize,
        });
    } catch (error) {
        await sessionLock?.release();
        await viewerDirectory.removeEntry(sessionName, { recursive: true }).catch(() => {});
        throw error;
    }
}

async function createTileStorage(options) {
    if (!supportsOpfs()) {
        return null;
    }
    try {
        return await createOpfsTileStorageForWrite(options);
    } catch (error) {
        if (error?.name === "NotSupportedError" || error?.name === "SecurityError") {
            return null;
        }
        throw error;
    }
}

export async function cleanupStaleTileStorage() {
    if (!supportsOpfs()) {
        return;
    }
    try {
        const root = await navigator.storage.getDirectory();
        const viewerDirectory = await root.getDirectoryHandle(OPFS_DIRECTORY_NAME);
        await removeStaleSessions(viewerDirectory);
    } catch {
        // Cleanup is best-effort and must not affect viewer startup.
    }
}

export async function restoreTileStorage(descriptor) {
    if (!descriptor || descriptor.type !== "opfs") {
        return null;
    }
    const sessionLock = await acquireSessionLock(descriptor.sessionName);
    let tileStorage = null;
    try {
        const root = await navigator.storage.getDirectory();
        const viewerDirectory = await root.getDirectoryHandle(OPFS_DIRECTORY_NAME);
        const sessionDirectory = await viewerDirectory.getDirectoryHandle(descriptor.sessionName);
        const fileHandle = await sessionDirectory.getFileHandle(OPFS_ALIGNMENT_FILE_NAME);
        tileStorage = createOpfsTileStorage({
            viewerDirectory,
            sessionName: descriptor.sessionName,
            fileHandle,
            sessionLock,
            createReader: true,
        });
        await tileStorage.finalize();
        return tileStorage;
    } catch (error) {
        if (tileStorage) {
            await tileStorage.destroy().catch(() => {});
        } else {
            await sessionLock?.release();
        }
        throw error;
    }
}


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

export function isGapRaw(raw) {
    return raw === 0 || raw === 45 || raw === 46 || raw === 32;
}

// Factory method for processing incoming rows from A3M/FASTA parsers.
// Tile payloads are stored in OPFS when available, with Blob storage as a fallback.
export async function createTiledAlignmentBuilder(totalCols, options = {}) {
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
    const sequenceResidueTileOffsets = [];
    const tileStorage = await createTileStorage({
        createReader: options.createOpfsReader !== false,
        releaseLockOnFinalize: options.releaseOpfsLockOnFinalize === true,
    });

    const sealCurrentBand = async () => {
        if (rowsInBand === 0) return;
        const rowTile = Math.floor(currentBandRowStart / tileRows);
        const usedBytes = rowsInBand * tileCols;
        let bandByteOffset = 0;
        if (tileStorage) {
            const bandBytes = new Uint8Array(colTileCount * usedBytes);
            for (let colTile = 0; colTile < colTileCount; colTile += 1) {
                bandBytes.set(bandTiles[colTile].subarray(0, usedBytes), colTile * usedBytes);
            }
            ({ byteOffset: bandByteOffset } = await tileStorage.write(bandBytes));
        }
        for (let colTile = 0; colTile < colTileCount; colTile += 1) {
            const tile = bandTiles[colTile];
            const colStart = colTile * tileCols;
            const colCount = Math.min(tileCols, totalCols - colStart);
            const tileMeta = {
                key: `${rowTile}:${colTile}`,
                rowTile,
                colTile,
                rowStart: currentBandRowStart,
                rowCount: rowsInBand,
                colStart,
                colCount,
            };
            const tileBytes = tile.subarray(0, usedBytes);
            if (tileStorage) {
                Object.assign(tileMeta, {
                    byteOffset: bandByteOffset + (colTile * usedBytes),
                    byteLength: usedBytes,
                });
            } else {
                tileMeta.blob = new Blob([tileBytes], { type: "application/octet-stream" });
            }
            tiles.push(tileMeta);
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
            let residueCount = 0;
            for (let colTile = 0; colTile < colTileCount; colTile += 1) {
                const colStart = colTile * tileCols;
                const colEnd = Math.min(colStart + tileCols, totalCols);
                const tileOffset = rowInBand * tileCols;
                bandTiles[colTile].set(rowBytes.subarray(colStart, colEnd), tileOffset);
                sequenceResidueTileOffsets.push(residueCount);
                for (let col = colStart; col < colEnd; col += 1) {
                    if (!isGapRaw(rowBytes[col])) residueCount += 1;
                }
            }
            rowsInBand += 1;
            totalRows += 1;
            if (rowsInBand === tileRows) {
                return sealCurrentBand();
            }
        },
        async finalize(records) {
            await sealCurrentBand();
            await tileStorage?.finalize();
            return {
                records,
                totalRows,
                totalCols,
                tileRows,
                tileCols,
                rowTileCount: Math.ceil(totalRows / tileRows),
                colTileCount,
                sequenceResidueTileOffsets: Uint32Array.from(sequenceResidueTileOffsets),
                tiles,
                tileStorage,
            };
        },
        async abort() {
            await tileStorage?.destroy();
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

    const pending = (alignment.tileStorage
        ? alignment.tileStorage.read(tile)
        : tile.blob.arrayBuffer().then((buffer) => new Uint8Array(buffer))
    ).then((decoded) => {
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

export async function sequenceResidueIndexAt(alignment, rowIndex, rawColumn, cache = null) {
    if (
        !alignment?.sequenceResidueTileOffsets
        || rowIndex == null
        || rawColumn == null
        || rowIndex < 0
        || rowIndex >= alignment.totalRows
        || rawColumn < 0
        || rawColumn >= alignment.totalCols
    ) {
        return null;
    }

    const rowTile = Math.floor(rowIndex / alignment.tileRows);
    const colTile = Math.floor(rawColumn / alignment.tileCols);
    const tileIndex = getTileIndex(alignment, rowTile, colTile);
    const tile = alignment.tiles[tileIndex];
    if (!tile) return null;

    const rowInTile = rowIndex - tile.rowStart;
    const localCol = rawColumn - tile.colStart;
    if (rowInTile < 0 || rowInTile >= tile.rowCount || localCol < 0 || localCol >= tile.colCount) {
        return null;
    }

    const tileData = await loadDecodedTile(alignment, tileIndex, cache);
    const rowOffset = rowInTile * alignment.tileCols;
    if (isGapRaw(tileData[rowOffset + localCol])) {
        return null;
    }

    let residueIndex = alignment.sequenceResidueTileOffsets[(rowIndex * alignment.colTileCount) + colTile];
    for (let col = 0; col < localCol; col += 1) {
        if (!isGapRaw(tileData[rowOffset + col])) residueIndex += 1;
    }
    return residueIndex;
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
