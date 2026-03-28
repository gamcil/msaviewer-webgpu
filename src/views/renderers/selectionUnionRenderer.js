import { getIntervalDifference } from "../models/alignmentOverlayGeometry.js";

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

    context.fillStyle = washFillStyle;
    for (const [row, intervals] of rowIntervals.entries()) {
        const y = getRowY(row);
        const rowHeight = getRowHeight(row);
        for (const interval of intervals) {
            context.fillRect(getIntervalX(interval), y, getIntervalWidth(interval), rowHeight);
        }
    }

    context.fillStyle = fillStyle;
    for (const [row, intervals] of rowIntervals.entries()) {
        const y = getRowY(row);
        const rowHeight = getRowHeight(row);
        for (const interval of intervals) {
            context.fillRect(getIntervalX(interval), y, getIntervalWidth(interval), rowHeight);
        }
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
