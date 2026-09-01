import { getIntervalDifference } from "../models/alignmentOverlayGeometry.js";

function areIntervalsEqual(left = [], right = []) {
    if (left.length !== right.length) return false;
    for (let index = 0; index < left.length; index += 1) {
        if (left[index].colStart !== right[index].colStart || left[index].colEnd !== right[index].colEnd) {
            return false;
        }
    }
    return true;
}

function buildFillBlocks(rowIntervals, getRowY, getRowHeight, getIntervalX, getIntervalWidth) {
    const rows = Array.from(rowIntervals.keys()).sort((a, b) => a - b);
    const blocks = [];
    let current = null;

    for (const row of rows) {
        const intervals = rowIntervals.get(row) ?? [];
        const y = getRowY(row);
        const rowHeight = getRowHeight(row);
        if (
            current &&
            row === current.lastRow + 1 &&
            areIntervalsEqual(intervals, current.intervals)
        ) {
            current.lastRow = row;
            current.height = (y + rowHeight) - current.y;
            continue;
        }

        if (current) {
            blocks.push(current);
        }
        current = {
            intervals,
            y,
            height: rowHeight,
            lastRow: row,
        };
    }

    if (current) {
        blocks.push(current);
    }

    return blocks.flatMap((block) =>
        block.intervals.map((interval) => ({
            x: getIntervalX(interval),
            y: block.y,
            width: getIntervalWidth(interval),
            height: block.height,
        }))
    );
}

export function drawSelectionUnion({
    context,
    rowIntervals,
    getRowY,
    getRowHeight,
    getIntervalX,
    getIntervalWidth,
    washFillStyle,
    fillStyle,
    strokeStyle,
    lineWidth = 1,
    lineDash = [],
}) {
    if (!context || !(rowIntervals instanceof Map) || rowIntervals.size === 0) {
        return;
    }

    const fillBlocks = buildFillBlocks(
        rowIntervals,
        getRowY,
        getRowHeight,
        getIntervalX,
        getIntervalWidth
    );

    context.fillStyle = washFillStyle;
    for (const block of fillBlocks) {
        context.fillRect(block.x, block.y, block.width, block.height);
    }

    context.fillStyle = fillStyle;
    for (const block of fillBlocks) {
        context.fillRect(block.x, block.y, block.width, block.height);
    }

    context.strokeStyle = strokeStyle;
    context.lineWidth = lineWidth;
    context.setLineDash(lineDash);
    context.beginPath();
    for (const [row, intervals] of rowIntervals.entries()) {
        const y = getRowY(row);
        const rowHeight = getRowHeight(row);
        const prevIntervals = rowIntervals.get(row - 1) ?? [];
        const nextIntervals = rowIntervals.get(row + 1) ?? [];

        for (const interval of intervals) {
            const x = getIntervalX(interval);
            const width = getIntervalWidth(interval);
            context.moveTo(x + 0.5, y);
            context.lineTo(x + 0.5, y + rowHeight);
            context.moveTo(x + width - 0.5, y);
            context.lineTo(x + width - 0.5, y + rowHeight);
        }

        for (const span of getIntervalDifference(intervals, prevIntervals)) {
            const x = getIntervalX(span);
            const width = getIntervalWidth(span);
            context.moveTo(x, y + 0.5);
            context.lineTo(x + width, y + 0.5);
        }

        for (const span of getIntervalDifference(intervals, nextIntervals)) {
            const x = getIntervalX(span);
            const width = getIntervalWidth(span);
            context.moveTo(x, y + rowHeight - 0.5);
            context.lineTo(x + width, y + rowHeight - 0.5);
        }
    }
    context.stroke();
    context.setLineDash([]);
}

export function drawSelectionBands({
    context,
    rowBands,
    getBandY,
    getBandHeight,
    getIntervalX,
    getIntervalWidth,
    washFillStyle,
    fillStyle,
    strokeStyle,
    lineWidth = 1,
    lineDash = [],
}) {
    if (!context || !Array.isArray(rowBands) || rowBands.length === 0) {
        return;
    }

    const fillBlocks = rowBands.flatMap((band) =>
        band.intervals.map((interval) => ({
            x: getIntervalX(interval),
            y: getBandY(band),
            width: getIntervalWidth(interval),
            height: getBandHeight(band),
        }))
    );

    context.fillStyle = washFillStyle;
    for (const block of fillBlocks) {
        context.fillRect(block.x, block.y, block.width, block.height);
    }
    context.fillStyle = fillStyle;
    for (const block of fillBlocks) {
        context.fillRect(block.x, block.y, block.width, block.height);
    }

    context.strokeStyle = strokeStyle;
    context.lineWidth = lineWidth;
    context.setLineDash(lineDash);
    context.beginPath();
    for (let index = 0; index < rowBands.length; index += 1) {
        const band = rowBands[index];
        const previous = rowBands[index - 1];
        const next = rowBands[index + 1];
        const previousIntervals = previous?.rowEnd === band.rowStart ? previous.intervals : [];
        const nextIntervals = next?.rowStart === band.rowEnd ? next.intervals : [];
        const y = getBandY(band);
        const height = getBandHeight(band);

        for (const interval of band.intervals) {
            const x = getIntervalX(interval);
            const width = getIntervalWidth(interval);
            context.moveTo(x + 0.5, y);
            context.lineTo(x + 0.5, y + height);
            context.moveTo(x + width - 0.5, y);
            context.lineTo(x + width - 0.5, y + height);
        }
        for (const span of getIntervalDifference(band.intervals, previousIntervals)) {
            const x = getIntervalX(span);
            context.moveTo(x, y + 0.5);
            context.lineTo(x + getIntervalWidth(span), y + 0.5);
        }
        for (const span of getIntervalDifference(band.intervals, nextIntervals)) {
            const x = getIntervalX(span);
            context.moveTo(x, y + height - 0.5);
            context.lineTo(x + getIntervalWidth(span), y + height - 0.5);
        }
    }
    context.stroke();
    context.setLineDash([]);
}
