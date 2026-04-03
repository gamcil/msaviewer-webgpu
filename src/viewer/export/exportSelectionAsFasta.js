import { materializeWindowFromTiles } from "../../alignment/tiledStorage.js";

const ASCII_DECODER = new TextDecoder("ascii");
const GAP_CODE = "-".charCodeAt(0);

function wrapSequence(sequence, lineWidth = 80) {
    if (!Number.isFinite(lineWidth) || lineWidth <= 0) {
        return sequence.length > 0 ? [sequence] : [];
    }
    const width = Math.max(1, Math.floor(lineWidth));
    const lines = [];
    for (let offset = 0; offset < sequence.length; offset += width) {
        lines.push(sequence.slice(offset, offset + width));
    }
    return lines;
}

function concatChunks(chunks = []) {
    const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const out = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
        out.set(chunk, offset);
        offset += chunk.length;
    }
    return out;
}

function mergeIntervals(intervals = []) {
    const sorted = intervals
        .filter((interval) => Number.isInteger(interval?.colStart) && Number.isInteger(interval?.colEnd) && interval.colEnd > interval.colStart)
        .map((interval) => ({ colStart: interval.colStart, colEnd: interval.colEnd }))
        .sort((a, b) => a.colStart - b.colStart || a.colEnd - b.colEnd);

    const merged = [];
    for (const interval of sorted) {
        const last = merged[merged.length - 1];
        if (last && interval.colStart <= last.colEnd) {
            last.colEnd = Math.max(last.colEnd, interval.colEnd);
        } else {
            merged.push(interval);
        }
    }
    return merged;
}

function buildGlobalIntervals(selectionRanges, totalCols) {
    return mergeIntervals(
        (selectionRanges ?? []).map((range) => ({
            colStart: Math.max(0, Math.min(totalCols, range?.colStart ?? 0)),
            colEnd: Math.max(0, Math.min(totalCols, range?.colEnd ?? 0)),
        }))
    );
}

function buildRowIntervals(selectionRanges, totalRows, totalCols) {
    const rowIntervals = new Map();
    for (const range of selectionRanges ?? []) {
        const rowStart = Math.max(0, Math.min(totalRows, range?.rowStart ?? 0));
        const rowEnd = Math.max(0, Math.min(totalRows, range?.rowEnd ?? 0));
        const colStart = Math.max(0, Math.min(totalCols, range?.colStart ?? 0));
        const colEnd = Math.max(0, Math.min(totalCols, range?.colEnd ?? 0));
        if (rowEnd <= rowStart || colEnd <= colStart) continue;

        for (let row = rowStart; row < rowEnd; row += 1) {
            const intervals = rowIntervals.get(row) ?? [];
            intervals.push({ colStart, colEnd });
            rowIntervals.set(row, intervals);
        }
    }

    for (const [row, intervals] of rowIntervals.entries()) {
        rowIntervals.set(row, mergeIntervals(intervals));
    }

    return rowIntervals;
}

function buildContiguousRowBlocks(rows = []) {
    if (rows.length === 0) return [];
    const blocks = [];
    let start = rows[0];
    let end = rows[0] + 1;
    for (let index = 1; index < rows.length; index += 1) {
        const row = rows[index];
        if (row === end) {
            end = row + 1;
            continue;
        }
        blocks.push({ rowStart: start, rowEnd: end });
        start = row;
        end = row + 1;
    }
    blocks.push({ rowStart: start, rowEnd: end });
    return blocks;
}

function sliceSelectedRowSegment(rowBytes, globalColStart, globalColEnd, rowIntervals, getGapChunk) {
    const chunks = [];
    let cursor = globalColStart;
    for (const interval of rowIntervals) {
        const start = Math.max(globalColStart, interval.colStart);
        const end = Math.min(globalColEnd, interval.colEnd);
        if (end <= start) continue;
        if (start > cursor) {
            chunks.push(getGapChunk(start - cursor));
        }
        chunks.push(rowBytes.slice(start - globalColStart, end - globalColStart));
        cursor = end;
    }
    if (cursor < globalColEnd) {
        chunks.push(getGapChunk(globalColEnd - cursor));
    }
    return chunks;
}

export async function exportSelectionAsFasta({
    alignmentStore,
    selectionRanges,
    lineWidth = 80,
    decodedTileCache = null,
} = {}) {
    if (!alignmentStore || !Array.isArray(alignmentStore.records) || alignmentStore.records.length === 0) {
        return "";
    }
    if (!Array.isArray(selectionRanges) || selectionRanges.length === 0) {
        return "";
    }

    const totalRows = alignmentStore.totalRows;
    const totalCols = alignmentStore.totalCols;
    const globalIntervals = buildGlobalIntervals(selectionRanges, totalCols);
    const rowIntervals = buildRowIntervals(selectionRanges, totalRows, totalCols);
    if (globalIntervals.length === 0 || rowIntervals.size === 0) {
        return "";
    }

    const selectedRows = [...rowIntervals.keys()].sort((a, b) => a - b);
    const rowBlocks = buildContiguousRowBlocks(selectedRows);
    const rowChunks = new Map(selectedRows.map((row) => [row, []]));
    const gapCache = new Map();
    const getGapChunk = (length) => {
        const normalizedLength = Math.max(0, length);
        if (normalizedLength === 0) {
            return new Uint8Array(0);
        }
        const cached = gapCache.get(normalizedLength);
        if (cached) return cached;
        const gapChunk = new Uint8Array(normalizedLength);
        gapChunk.fill(GAP_CODE);
        gapCache.set(normalizedLength, gapChunk);
        return gapChunk;
    };

    for (const globalInterval of globalIntervals) {
        const colStart = globalInterval.colStart;
        const colEnd = globalInterval.colEnd;
        const colCount = colEnd - colStart;
        if (colCount <= 0) continue;

        for (const block of rowBlocks) {
            const rowCount = block.rowEnd - block.rowStart;
            const windowData = await materializeWindowFromTiles(
                alignmentStore,
                block.rowStart,
                rowCount,
                colStart,
                colCount,
                decodedTileCache,
            );

            for (let localRow = 0; localRow < rowCount; localRow += 1) {
                const rowIndex = block.rowStart + localRow;
                const intervals = rowIntervals.get(rowIndex) ?? [];
                if (intervals.length === 0) continue;
                const rowOffset = localRow * colCount;
                const rowBytes = windowData.subarray(rowOffset, rowOffset + colCount);
                const chunks = rowChunks.get(rowIndex) ?? [];
                chunks.push(...sliceSelectedRowSegment(rowBytes, colStart, colEnd, intervals, getGapChunk));
                rowChunks.set(rowIndex, chunks);
            }
        }
    }

    const lines = [];
    for (const rowIndex of selectedRows) {
        const record = alignmentStore.records[rowIndex];
        if (!record) continue;
        const name = record.name?.trim?.() || `sequence_${rowIndex + 1}`;
        const sequence = ASCII_DECODER.decode(concatChunks(rowChunks.get(rowIndex) ?? []));
        lines.push(`>${name}`);
        lines.push(...wrapSequence(sequence, lineWidth));
    }

    return lines.join("\n");
}
