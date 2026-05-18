import { createColorRamp, prepareColorRamp, resolveInterpolatedColor } from "../renderers/trackRenderers.js";
import { buildProjectedVisibleColumns } from "./visibleColumnModel.js";

export function createPreparedLineColorRamp(colorRamp) {
    return colorRamp ? prepareColorRamp(createColorRamp(colorRamp)) : null;
}

export function buildLinePoints(data, {
    visibleStart,
    visibleEnd,
    columnVisibility,
    normalizeValue,
    cellWidthPx,
    localScrollLeftPx,
    heightPx,
    colorRamp,
    style,
    lineWidth,
}) {
    if (!data) {
        return [];
    }

    return buildProjectedVisibleColumns(visibleStart, visibleEnd, columnVisibility, (rawCol, column) => {
        const score = data[rawCol] ?? 0;
        const fraction = normalizeValue(score);
        const interpolatedColor = colorRamp
            ? resolveInterpolatedColor(score, colorRamp)
            : null;
        const target = colorRamp?.target ?? "points";
        return {
            score,
            x: column * cellWidthPx + (cellWidthPx / 2) - localScrollLeftPx,
            y: heightPx - (heightPx * fraction),
            pointFillStyle: target === "points"
                ? (interpolatedColor ?? style.pointFillStyle ?? style.fillStyle)
                : style.pointFillStyle,
            pointStrokeStyle: target === "points"
                ? (interpolatedColor ?? style.pointStrokeStyle ?? style.strokeStyle)
                : style.pointStrokeStyle,
            pointLineWidth: style.pointLineWidth ?? lineWidth,
        };
    });
}
