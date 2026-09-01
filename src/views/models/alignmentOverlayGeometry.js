export function projectSelectionRects(ranges, columnVisibility, visibleColStart, visibleColEnd, visibleRowStart, visibleRowEnd) {
    const rects = [];
    for (const range of ranges ?? []) {
        const rowStart = Math.max(range.rowStart, visibleRowStart);
        const rowEnd = Math.min(range.rowEnd, visibleRowEnd);
        if (rowStart >= rowEnd) continue;
        if (!columnVisibility?.rawToVisible) {
            const colStart = Math.max(range.colStart, visibleColStart);
            const colEnd = Math.min(range.colEnd, visibleColEnd);
            if (colStart < colEnd) {
                rects.push({ colStart, colEnd, rowStart, rowEnd });
            }
            continue;
        }
        let runStart = -1;
        let lastVisible = -1;
        for (let rawCol = range.colStart; rawCol < range.colEnd; rawCol += 1) {
            const visibleCol = columnVisibility.rawToVisible[rawCol];
            if (visibleCol == null || visibleCol < visibleColStart || visibleCol >= visibleColEnd) {
                if (runStart >= 0) {
                    rects.push({ colStart: runStart, colEnd: lastVisible + 1, rowStart, rowEnd });
                    runStart = -1;
                    lastVisible = -1;
                }
                continue;
            }
            if (runStart < 0) {
                runStart = visibleCol;
                lastVisible = visibleCol;
            } else if (visibleCol === lastVisible + 1) {
                lastVisible = visibleCol;
            } else {
                rects.push({ colStart: runStart, colEnd: lastVisible + 1, rowStart, rowEnd });
                runStart = visibleCol;
                lastVisible = visibleCol;
            }
        }
        if (runStart >= 0) {
            rects.push({ colStart: runStart, colEnd: lastVisible + 1, rowStart, rowEnd });
        }
    }
    return rects;
}

export function projectSelectionRowIntervals(ranges, columnVisibility, visibleColStart, visibleColEnd, visibleRowStart, visibleRowEnd) {
    const rows = new Map();
    for (const rect of projectSelectionRects(ranges, columnVisibility, visibleColStart, visibleColEnd, visibleRowStart, visibleRowEnd)) {
        for (let row = rect.rowStart; row < rect.rowEnd; row += 1) {
            const intervals = rows.get(row) ?? [];
            intervals.push({ colStart: rect.colStart, colEnd: rect.colEnd });
            rows.set(row, intervals);
        }
    }

    for (const [row, intervals] of rows.entries()) {
        rows.set(row, mergeIntervals(intervals));
    }

    return rows;
}

function mergeIntervals(intervals) {
    const merged = [];
    for (const interval of intervals.sort((a, b) => a.colStart - b.colStart || a.colEnd - b.colEnd)) {
        const last = merged[merged.length - 1];
        if (last && interval.colStart <= last.colEnd) {
            last.colEnd = Math.max(last.colEnd, interval.colEnd);
        } else {
            merged.push({ ...interval });
        }
    }
    return merged;
}

function areIntervalsEqual(left, right) {
    return left.length === right.length && left.every((interval, index) =>
        interval.colStart === right[index].colStart && interval.colEnd === right[index].colEnd
    );
}

// Compact the union of projected selection rectangles into vertical row bands.
// A band covers many adjacent rows with the same set of selected column intervals.
export function projectSelectionRowBands(ranges, columnVisibility, visibleColStart, visibleColEnd, visibleRowStart, visibleRowEnd) {
    const events = new Map();
    for (const rect of projectSelectionRects(
        ranges,
        columnVisibility,
        visibleColStart,
        visibleColEnd,
        visibleRowStart,
        visibleRowEnd,
    )) {
        const starts = events.get(rect.rowStart) ?? { add: [], remove: [] };
        starts.add.push(rect);
        events.set(rect.rowStart, starts);
        const ends = events.get(rect.rowEnd) ?? { add: [], remove: [] };
        ends.remove.push(rect);
        events.set(rect.rowEnd, ends);
    }

    const rowEdges = [...events.keys()].sort((a, b) => a - b);
    const activeRects = new Set();
    const bands = [];
    for (let index = 0; index < rowEdges.length - 1; index += 1) {
        const rowStart = rowEdges[index];
        const { add, remove } = events.get(rowStart);
        for (const rect of remove) activeRects.delete(rect);
        for (const rect of add) activeRects.add(rect);

        const rowEnd = rowEdges[index + 1];
        if (activeRects.size === 0 || rowStart >= rowEnd) continue;
        const intervals = mergeIntervals([...activeRects].map(({ colStart, colEnd }) => ({ colStart, colEnd })));
        const previous = bands[bands.length - 1];
        if (previous?.rowEnd === rowStart && areIntervalsEqual(previous.intervals, intervals)) {
            previous.rowEnd = rowEnd;
            continue;
        }
        bands.push({
            rowStart,
            rowEnd,
            intervals,
        });
    }
    return bands;
}

export function buildOverlayGeometry({
    selectionRanges,
    previewRange,
    hoveredCell,
    columnVisibility,
    colStart,
    colEnd,
    rowStart,
    rowEnd,
}) {
    const committedRanges = selectionRanges ?? [];
    const previewRanges = previewRange ? [previewRange] : [];
    return {
        committedRowIntervals: projectSelectionRowIntervals(committedRanges, columnVisibility, colStart, colEnd, rowStart, rowEnd),
        previewRowIntervals: projectSelectionRowIntervals(previewRanges, columnVisibility, colStart, colEnd, rowStart, rowEnd),
        hoveredVisibleCol: hoveredCell?.col == null
            ? -1
            : (columnVisibility?.rawToVisible?.[hoveredCell.col] ?? hoveredCell.col),
        hoveredRow: hoveredCell?.row ?? -1,
    };
}

export function getIntervalDifference(baseIntervals, neighborIntervals) {
    if (!baseIntervals?.length) return [];
    if (!neighborIntervals?.length) {
        return baseIntervals.map((interval) => ({ ...interval }));
    }

    const uncovered = [];
    let neighborIndex = 0;

    for (const interval of baseIntervals) {
        let cursor = interval.colStart;
        while (neighborIndex < neighborIntervals.length && neighborIntervals[neighborIndex].colEnd <= cursor) {
            neighborIndex += 1;
        }

        let scanIndex = neighborIndex;
        while (scanIndex < neighborIntervals.length) {
            const neighbor = neighborIntervals[scanIndex];
            if (neighbor.colStart >= interval.colEnd) break;
            if (neighbor.colStart > cursor) {
                uncovered.push({ colStart: cursor, colEnd: Math.min(neighbor.colStart, interval.colEnd) });
            }
            cursor = Math.max(cursor, neighbor.colEnd);
            if (cursor >= interval.colEnd) break;
            scanIndex += 1;
        }

        if (cursor < interval.colEnd) {
            uncovered.push({ colStart: cursor, colEnd: interval.colEnd });
        }
    }

    return uncovered;
}
