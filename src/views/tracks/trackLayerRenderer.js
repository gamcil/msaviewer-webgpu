import { renderBars, renderGlyphs, renderLine, renderSequenceLogo } from "../renderers/trackRenderers.js";
import { buildBarVisibleSlice } from "../models/barRenderModel.js";
import { buildLinePoints } from "../models/lineRenderModel.js";
import { buildVisibleGlyphs } from "../models/glyphRenderModel.js";
import {
    buildConsensusGlyphs,
    buildConsensusHistogramBars,
    buildConsensusLogoColumns,
    buildVisibleConsensusColumns,
} from "../models/consensusRenderModel.js";
import { getDefaultGlyphFillStyle, getThemedStyleValue, isNumericTrackData } from "./trackRuntime.js";

function getGlyphLaneHeightPx(layers, dpr) {
    let lane = 0;
    for (const layer of layers) {
        if (layer.type !== "glyph") continue;
        const fontPx = Math.max(10, Math.round((layer.style?.fontSize ?? 14) * dpr));
        lane = Math.max(lane, fontPx + Math.max(2, Math.round(4 * dpr)));
    }
    return lane;
}

function buildBarLayer(layer, cache, renderContext) {
    const renderColumns = cache?.renderColumns;
    if (!renderColumns) return null;
    const lineWidth = layer.style.lineWidth ?? Math.max(1, Math.round(renderContext.dpr));
    const { bars } = buildBarVisibleSlice(renderColumns, {
        visibleStart: renderContext.visibleStart,
        visibleEnd: renderContext.visibleEnd,
        columnVisibility: renderContext.columnVisibility,
        plotHeightPx: renderContext.heightPx,
        lineWidth,
        getGlyphSpec: null,
    });
    return {
        type: "bar",
        props: {
            bars,
            cellWidthPx: renderContext.cellWidthPx,
            localScrollLeftPx: renderContext.localScrollLeftPx,
            canvasHeight: renderContext.heightPx,
            fillStyle: layer.style.fillStyle,
            strokeStyle: layer.style.strokeStyle,
            lineWidth,
        },
    };
}

function buildConsensusBarLayer(layer, cache, renderContext, theme) {
    const renderColumns = cache?.renderColumns;
    if (!renderColumns) return null;
    const columns = buildVisibleConsensusColumns(
        renderColumns,
        renderContext.visibleStart,
        renderContext.visibleEnd,
        renderContext.columnVisibility
    );
    if (!columns.length) return null;
    const bars = buildConsensusHistogramBars(columns, {
        includeGaps: layer.includeGaps !== false,
        plotHeightPx: renderContext.plotHeightPx,
    });
    return {
        type: "bar",
        props: {
            bars,
            cellWidthPx: renderContext.cellWidthPx,
            localScrollLeftPx: renderContext.localScrollLeftPx,
            canvasHeight: renderContext.plotHeightPx,
            fillStyle: getThemedStyleValue(layer.colors, "fillStyle", layer.style?.fillStyle, theme),
            strokeStyle: getThemedStyleValue(layer.colors, "strokeStyle", layer.style?.strokeStyle ?? null, theme),
            lineWidth: layer.style?.lineWidth ?? Math.max(1, Math.round(renderContext.dpr)),
        },
    };
}

function buildLineLayer(layer, data, renderContext, normalizeValue) {
    if (!data || !isNumericTrackData(data)) return null;
    const lineWidth = layer.style.lineWidth ?? Math.max(1, Math.round(renderContext.dpr));
    const points = buildLinePoints(data, {
        visibleStart: renderContext.visibleStart,
        visibleEnd: renderContext.visibleEnd,
        columnVisibility: renderContext.columnVisibility,
        normalizeValue,
        cellWidthPx: renderContext.cellWidthPx,
        localScrollLeftPx: renderContext.localScrollLeftPx,
        heightPx: renderContext.heightPx,
        colorRamp: layer.colorRamp,
        style: layer.style,
        lineWidth,
    });
    return {
        type: "line",
        props: {
            points,
            canvasHeight: renderContext.heightPx,
            strokeStyle: layer.style.strokeStyle,
            fillStyle: layer.style.fillStyle,
            lineWidth,
            showPoints: layer.style.showPoints,
            pointRadius: layer.style.pointRadius,
            skipZeroPoints: layer.style.skipZeroPoints,
        },
    };
}

function buildGlyphLayer(layer, cache, data, renderContext, theme, track, trackState, viewport) {
    if (typeof layer.getGlyph === "function") {
        if (renderContext.cellWidthPx < layer.style.minCellWidth) {
            return null;
        }
        const renderColumns = cache?.renderColumns;
        if (!renderColumns) return null;
        const fontPx = Math.max(10, Math.round((layer.style.fontSize ?? 14) * renderContext.dpr));
        const { glyphs } = buildBarVisibleSlice(renderColumns, {
            visibleStart: renderContext.visibleStart,
            visibleEnd: renderContext.visibleEnd,
            columnVisibility: renderContext.columnVisibility,
            plotHeightPx: renderContext.heightPx,
            lineWidth: 1,
            getGlyphSpec: (rawCol, score, fraction) => {
                const glyphSpec = layer.getGlyph({
                    rawColumn: rawCol,
                    value: score,
                    fraction,
                    track,
                    trackState,
                    viewport,
                });
                return glyphSpec?.glyph
                    ? { ...glyphSpec, y: glyphSpec.y ?? renderContext.heightPx }
                    : null;
            },
        });
        if (glyphs.length === 0) return null;
        return {
            type: "glyph",
            props: {
                glyphs,
                cellWidthPx: renderContext.cellWidthPx,
                localScrollLeftPx: renderContext.localScrollLeftPx,
                canvasHeight: renderContext.heightPx,
                font: `${fontPx}px "IBM Plex Mono", monospace`,
                fillStyle: layer.style.fillStyle ?? getDefaultGlyphFillStyle(theme),
                textAlign: "center",
                textBaseline: "bottom",
            },
        };
    }

    if (renderContext.cellWidthPx < layer.style.minCellWidth) {
        return null;
    }
    const glyphs = buildVisibleGlyphs(data, {
        visibleStart: renderContext.visibleStart,
        visibleEnd: renderContext.visibleEnd,
        columnVisibility: renderContext.columnVisibility,
    });
    if (glyphs.length === 0) return null;
    const fontPx = Math.max(10, Math.round((layer.style.fontSize ?? 14) * renderContext.dpr));
    return {
        type: "glyph",
        props: {
            glyphs,
            cellWidthPx: renderContext.cellWidthPx,
            localScrollLeftPx: renderContext.localScrollLeftPx,
            canvasHeight: renderContext.heightPx,
            font: `${fontPx}px "IBM Plex Mono", monospace`,
            fillStyle: layer.style.fillStyle ?? getDefaultGlyphFillStyle(theme),
            textAlign: "center",
            textBaseline: "bottom",
        },
    };
}

function buildConsensusGlyphLayer(layer, cache, renderContext, theme) {
    const renderColumns = cache?.renderColumns;
    if (!renderColumns || layer.show === false) return null;
    const columns = buildVisibleConsensusColumns(
        renderColumns,
        renderContext.visibleStart,
        renderContext.visibleEnd,
        renderContext.columnVisibility
    );
    if (!columns.length) return null;
    const fillStyle = getThemedStyleValue(
        layer.colors,
        "fillStyle",
        layer.style?.fillStyle ?? getDefaultGlyphFillStyle(theme),
        theme
    );
    const glyphs = buildConsensusGlyphs(columns, {
        consensusFillStyle: fillStyle,
        heightPx: renderContext.heightPx,
    });
    if (glyphs.length === 0) return null;
    const fontPx = Math.max(10, Math.round((layer.style?.fontSize ?? 14) * renderContext.dpr));
    return {
        type: "glyph",
        props: {
            glyphs,
            cellWidthPx: renderContext.cellWidthPx,
            localScrollLeftPx: renderContext.localScrollLeftPx,
            canvasHeight: renderContext.heightPx,
            font: `${fontPx}px "IBM Plex Mono", monospace`,
            fillStyle,
            textAlign: "center",
            textBaseline: "bottom",
        },
    };
}

function buildLogoLayer(layer, cache, renderContext) {
    const renderColumns = cache?.renderColumns;
    if (!renderColumns || layer.show === false) return null;
    const style = layer.style ?? {};
    if (renderContext.cellWidthPx < (style.minLogoCellWidth ?? 10)) return null;
    const columns = buildVisibleConsensusColumns(
        renderColumns,
        renderContext.visibleStart,
        renderContext.visibleEnd,
        renderContext.columnVisibility
    );
    if (!columns.length) return null;
    const logoColumns = buildConsensusLogoColumns(columns, {
        includeGaps: layer.includeGaps !== false,
        plotHeightPx: renderContext.plotHeightPx,
        logoHeightMode: style.logoHeightMode ?? "histogram",
    });
    return {
        type: "logo",
        props: {
            columns: logoColumns,
            cellWidthPx: renderContext.cellWidthPx,
            localScrollLeftPx: renderContext.localScrollLeftPx,
            plotHeightPx: renderContext.plotHeightPx,
            font: style.logoFont ?? `bold 100px "IBM Plex Mono", monospace`,
            maxScaleX: style.logoMaxScaleX ?? 1.25,
            capGlyphHeight: style.capGlyphHeight ?? true,
            maxGlyphHeightRatio: style.maxGlyphHeightRatio ?? 0.8,
            minGlyphPixelHeight: style.minGlyphPixelHeight ?? 1,
        },
    };
}

export function buildRenderedTrackLayers({
    source,
    data,
    layers,
    layerCaches,
    theme,
    track,
    trackState,
    viewport,
    normalizeValue,
    renderContext,
}) {
    const renderedLayers = [];
    const glyphLanePx = getGlyphLaneHeightPx(layers, renderContext.dpr);
    const plotHeightPx = Math.max(1, renderContext.heightPx - glyphLanePx);
    for (let index = 0; index < layers.length; index += 1) {
        const layer = layers[index];
        const cache = layerCaches[index];
        let renderedLayer = null;
        if (layer.type === "bar" && source?.type === "consensus") {
            renderedLayer = buildConsensusBarLayer(layer, cache, { ...renderContext, plotHeightPx }, theme);
        } else if (layer.type === "bar") {
            renderedLayer = buildBarLayer(layer, cache, { ...renderContext, heightPx: plotHeightPx });
        } else if (layer.type === "line") {
            renderedLayer = buildLineLayer(layer, data, { ...renderContext, heightPx: plotHeightPx }, normalizeValue);
        } else if (layer.type === "glyph") {
            if (source?.type === "consensus") {
                renderedLayer = buildConsensusGlyphLayer(layer, cache, renderContext, theme);
            } else {
                renderedLayer = buildGlyphLayer(layer, cache, data, renderContext, theme, track, trackState, viewport);
            }
        } else if (layer.type === "logo") {
            renderedLayer = buildLogoLayer(layer, cache, { ...renderContext, plotHeightPx });
        }
        if (renderedLayer) {
            renderedLayers.push(renderedLayer);
        }
    }
    return renderedLayers;
}

export function renderTrackLayer(context, layer) {
    if (!layer) return;
    if (layer.type === "bar") {
        renderBars(context, layer.props);
        return;
    }
    if (layer.type === "line") {
        renderLine(context, layer.props);
        return;
    }
    if (layer.type === "glyph") {
        renderGlyphs(context, layer.props);
        return;
    }
    if (layer.type === "logo") {
        renderSequenceLogo(context, layer.props);
    }
}
