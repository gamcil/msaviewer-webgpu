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
import { defaultGlyphFill, isNumericData, themedStyle } from "./trackRuntime.js";

const RENDER_TRACK_LAYER = {
    bar: renderBars,
    line: renderLine,
    glyph: renderGlyphs,
    logo: renderSequenceLogo,
};

function getTrackGlyphFontFamily(theme) {
    return theme?.uiFontFamily ?? "\"IBM Plex Sans\", sans-serif";
}

function getTrackLogoFont(theme) {
    return `bold 100px ${getTrackGlyphFontFamily(theme)}`;
}

function getTrackLaneGeometries(lanes, totalHeightPx) {
    lanes = Array.isArray(lanes) ? lanes : [];
    if (!lanes.length) {
        return [{ topPx: 0, heightPx: totalHeightPx }];
    }
    const totalHeight = lanes.reduce((sum, lane) => sum + Math.max(0, lane.height ?? 0), 0);
    const scale = totalHeight > 0 ? totalHeightPx / totalHeight : 1;
    let cursorPx = 0;
    return lanes.map((lane) => {
        const nextHeightPx = Math.max(1, (lane.height ?? 0) * scale);
        const geometry = {
            topPx: cursorPx,
            heightPx: nextHeightPx,
        };
        cursorPx += nextHeightPx;
        return geometry;
    });
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
        plotHeightPx: renderContext.heightPx,
    });
    return {
        type: "bar",
        props: {
            bars,
            cellWidthPx: renderContext.cellWidthPx,
            localScrollLeftPx: renderContext.localScrollLeftPx,
            canvasHeight: renderContext.heightPx,
            fillStyle: themedStyle(layer.colors, "fillStyle", layer.style?.fillStyle, theme),
            strokeStyle: themedStyle(layer.colors, "strokeStyle", layer.style?.strokeStyle ?? null, theme),
            lineWidth: layer.style?.lineWidth ?? Math.max(1, Math.round(renderContext.dpr)),
        },
    };
}

function buildLineLayer(layer, data, renderContext, normalizeValue) {
    if (!data || !isNumericData(data)) return null;
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
    const style = layer.style ?? {};
    if (renderContext.cellWidthPx < style.minCellWidth) {
        return null;
    }
    let glyphs = [];
    if (typeof layer.getGlyph === "function") {
        const renderColumns = cache?.renderColumns;
        if (!renderColumns) return null;
        ({ glyphs } = buildBarVisibleSlice(renderColumns, {
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
        }));
    } else {
        glyphs = buildVisibleGlyphs(data, {
            visibleStart: renderContext.visibleStart,
            visibleEnd: renderContext.visibleEnd,
            columnVisibility: renderContext.columnVisibility,
        });
    }
    if (glyphs.length === 0) return null;
    const fontPx = Math.max(10, Math.round((style.fontSize ?? 14) * renderContext.dpr));
    return {
        type: "glyph",
        props: {
            glyphs,
            cellWidthPx: renderContext.cellWidthPx,
            localScrollLeftPx: renderContext.localScrollLeftPx,
            canvasHeight: renderContext.heightPx,
            font: `${fontPx}px ${getTrackGlyphFontFamily(theme)}`,
            fillStyle: style.fillStyle ?? defaultGlyphFill(theme),
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
    const fillStyle = themedStyle(
        layer.colors,
        "fillStyle",
        layer.style?.fillStyle ?? defaultGlyphFill(theme),
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
            font: `${fontPx}px ${getTrackGlyphFontFamily(theme)}`,
            fillStyle,
            textAlign: "center",
            textBaseline: "bottom",
        },
    };
}

function buildLogoLayer(layer, cache, renderContext, theme) {
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
        plotHeightPx: renderContext.heightPx,
        logoHeightMode: style.logoHeightMode ?? "histogram",
    });
    return {
        type: "logo",
        props: {
            columns: logoColumns,
            cellWidthPx: renderContext.cellWidthPx,
            localScrollLeftPx: renderContext.localScrollLeftPx,
            plotHeightPx: renderContext.heightPx,
            font: style.logoFont ?? getTrackLogoFont(theme),
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
    lanes,
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
    const laneGeometries = getTrackLaneGeometries(lanes, renderContext.heightPx);
    for (let index = 0; index < layers.length; index += 1) {
        const layer = layers[index];
        const cache = layerCaches[index];
        const laneGeometry = laneGeometries[layer.laneIndex ?? 0] ?? laneGeometries[0] ?? {
            topPx: 0,
            heightPx: renderContext.heightPx,
        };
        const laneRenderContext = {
            ...renderContext,
            heightPx: laneGeometry.heightPx,
        };
        const layerSource = cache?.source ?? layer.source ?? source;
        const layerData = cache && "data" in cache ? cache.data : data;
        let renderedLayer = null;
        if (layer.type === "bar" && layerSource?.type === "consensus") {
            renderedLayer = buildConsensusBarLayer(layer, cache, laneRenderContext, theme);
        } else if (layer.type === "bar") {
            renderedLayer = buildBarLayer(layer, cache, laneRenderContext);
        } else if (layer.type === "line") {
            renderedLayer = buildLineLayer(layer, layerData, laneRenderContext, normalizeValue);
        } else if (layer.type === "glyph") {
            if (layerSource?.type === "consensus") {
                renderedLayer = buildConsensusGlyphLayer(layer, cache, laneRenderContext, theme);
            } else {
                renderedLayer = buildGlyphLayer(layer, cache, layerData, laneRenderContext, theme, track, trackState, viewport);
            }
        } else if (layer.type === "logo") {
            renderedLayer = buildLogoLayer(layer, cache, laneRenderContext, theme);
        }
        if (renderedLayer) {
            renderedLayers.push({
                ...renderedLayer,
                offsetTopPx: laneGeometry.topPx,
            });
        }
    }
    return renderedLayers;
}

export function renderTrackLayer(context, layer) {
    if (!layer) return;
    RENDER_TRACK_LAYER[layer.type]?.(context, layer.props);
}
