import { resolveInterpolatedColor } from "../renderers/trackRenderers.js";
import { createColorRamp } from "../trackStyles.js";
import { buildProjectedVisibleColumns } from "./visibleColumnModel.js";

export function createBarColorRamps(colorRamps = {}, prepareColorRamp) {
    return {
        fill: colorRamps.fill ? prepareColorRamp(createColorRamp(colorRamps.fill)) : null,
        stroke: colorRamps.stroke ? prepareColorRamp(createColorRamp(colorRamps.stroke)) : null,
        glyph: colorRamps.glyph ? prepareColorRamp(createColorRamp(colorRamps.glyph)) : null,
    };
}

export function buildBarRenderColumns(data, {
    normalizeValue,
    colorRamps,
    defaultFillStyle,
    defaultStrokeStyle,
    defaultGlyphFillStyle,
}) {
    if (!data?.length) {
        return null;
    }
    return Array.from(data, (score = 0, rawCol) => {
        const fraction = normalizeValue(score);
        const fillColor = colorRamps.fill
            ? (resolveInterpolatedColor(score, colorRamps.fill) ?? defaultFillStyle)
            : defaultFillStyle;
        const strokeColor = colorRamps.stroke
            ? (resolveInterpolatedColor(score, colorRamps.stroke) ?? defaultStrokeStyle)
            : defaultStrokeStyle;
        const glyphColor = colorRamps.glyph
            ? (resolveInterpolatedColor(score, colorRamps.glyph) ?? defaultGlyphFillStyle)
            : defaultGlyphFillStyle;
        return {
            rawCol,
            score,
            fraction,
            fillColor,
            strokeColor,
            glyphColor,
        };
    });
}

export function buildBarVisibleSlice(renderColumns, {
    visibleStart,
    visibleEnd,
    columnVisibility,
    plotHeightPx,
    lineWidth,
    getGlyphSpec,
}) {
    const bars = [];
    const glyphs = [];
    forEachBarVisibleColumn(renderColumns, {
        visibleStart,
        visibleEnd,
        columnVisibility,
    }, (columnData, column) => {
        bars.push({
            column,
            fraction: columnData.fraction,
            baseY: plotHeightPx,
            plotHeight: plotHeightPx,
            fillStyle: columnData.fillColor,
            strokeStyle: columnData.strokeColor,
            lineWidth,
        });

        const glyphSpec = getGlyphSpec?.(columnData.rawCol, columnData.score, columnData.fraction);
        if (glyphSpec?.glyph) {
            glyphs.push({
                column,
                glyph: glyphSpec.glyph,
                color: glyphSpec.color ?? columnData.glyphColor,
                y: glyphSpec.y,
            });
        }
    });
    return { bars, glyphs };
}

function forEachBarVisibleColumn(renderColumns, { visibleStart, visibleEnd, columnVisibility }, callback) {
    buildProjectedVisibleColumns(visibleStart, visibleEnd, columnVisibility, (rawCol, column) => {
        const columnData = renderColumns[rawCol];
        if (!columnData) {
            return null;
        }
        callback(columnData, column);
        return null;
    });
}
