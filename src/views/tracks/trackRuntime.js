import { createBarColorRamps } from "../models/barRenderModel.js";
import { prepareColorRamp } from "../renderers/trackRenderers.js";
import { createPreparedLineColorRamp } from "../models/lineRenderModel.js";
import { resolveSymbolColor } from "../../schemes/symbolColorResolver.js";
import { buildConsensusState } from "../../viewer/TrackStateBuilder.js";

const BAR_STYLE = {
    fillStyle: "rgba(89, 211, 255, 0.25)",
    strokeStyle: "rgb(0, 122, 178)",
    lineWidth: null,
};

const GLYPH_STYLE = {
    showGlyphs: false,
    fillStyle: null,
    fontSize: 14,
    minCellWidth: 10,
};

const LINE_STYLE = {
    strokeStyle: "rgb(0, 122, 178)",
    fillStyle: "rgba(89, 211, 255, 0.25)",
    lineWidth: null,
    showPoints: true,
    pointRadius: 5,
    pointFillStyle: null,
    pointStrokeStyle: null,
    pointLineWidth: null,
    skipZeroPoints: true,
};

export function defaultGlyphFill(theme) {
    return theme?.darkMode ? "#e6e6e6" : "#333";
}

function themedColor(colors, key, theme) {
    if (!colors) return undefined;
    const themeColors = theme?.darkMode ? colors.dark : colors.light;
    if (!themeColors || !(key in themeColors)) {
        return undefined;
    }
    return themeColors[key];
}

export function themedStyle(colors, key, fallback, theme) {
    const themed = themedColor(colors, key, theme);
    return themed === undefined ? fallback : themed;
}

export function normalizeTrackLayers(layers = []) {
    return layers.map((layer) => {
        if (layer.type === "bar") {
            return {
                ...layer,
                style: { ...BAR_STYLE, ...layer.style },
                colorRamps: layer.colorRamps ? createBarColorRamps(layer.colorRamps, prepareColorRamp) : { fill: null, stroke: null, glyph: null },
            };
        }
        if (layer.type === "line") {
            return {
                ...layer,
                style: { ...LINE_STYLE, ...layer.style },
                colorRamp: createPreparedLineColorRamp(layer.colorRamp),
            };
        }
        if (layer.type === "glyph") {
            return {
                ...layer,
                style: { ...GLYPH_STYLE, ...layer.style },
                colorRamps: layer.colorRamps ? createBarColorRamps(layer.colorRamps, prepareColorRamp) : { fill: null, stroke: null, glyph: null },
            };
        }
        return { ...layer };
    });
}

export function isNumericData(data) {
    if (!data || typeof data.length !== "number") {
        return false;
    }
    for (let i = 0; i < data.length; i += 1) {
        const value = data[i];
        if (value == null) continue;
        return typeof value === "number";
    }
    return true;
}

function getTrackRepresentation(trackContext, ref = "active") {
    const id = ref === "active" || ref == null
        ? trackContext?.activeRepresentationId ?? null
        : ref;
    if (!id) return null;
    return trackContext?.getRepresentation?.(id) ?? null;
}

export function resolveTrackState(source, trackContext) {
    if (!source || !trackContext) return null;
    const ref = source.representation ?? "active";
    const rep = getTrackRepresentation(trackContext, ref);
    return rep?.trackState
        ?? ((ref === "active" || ref == null) ? trackContext.activeTrackState ?? null : null);
}

export function resolveTrackData(source, trackContext) {
    if (!source) {
        return undefined;
    }
    const ref = source.representation ?? "active";
    const rep = getTrackRepresentation(trackContext, ref);
    const trackState = rep?.trackState
        ?? ((ref === "active" || ref == null) ? trackContext?.activeTrackState ?? null : null);
    if (source.type === "metric" && source.metric) {
        if (rep?.columnMetrics?.[source.metric]) {
            return rep.columnMetrics[source.metric];
        }
        return trackState?.metrics?.[source.metric] ?? null;
    }
    if (source.type === "consensus") {
        if (rep?.columnMetrics && rep?.store) {
            const alphabet = trackContext?.getAlphabet?.(rep.alphabetId) ?? null;
            if (alphabet) {
                return buildConsensusState(
                    rep.columnMetrics,
                    rep.store.totalRows,
                    alphabet
                );
            }
        }
        return trackState?.consensus ?? null;
    }
    if (source.type === "values") {
        return source.values ?? null;
    }
    return undefined;
}

export function resolveGlyphColor(coloring, source, trackContext) {
    let colorAlphabet = null;
    if (coloring?.alphabet) {
        colorAlphabet = trackContext?.getAlphabet?.(coloring.alphabet) ?? null;
    } else {
        const ref = coloring?.representation ?? source?.representation ?? "active";
        const rep = getTrackRepresentation(trackContext, ref);
        colorAlphabet = rep
            ? trackContext?.getAlphabet?.(rep.alphabetId) ?? null
            : ((ref === "active" || ref == null) ? trackContext?.getActiveAlphabet?.() ?? null : null);
    }
    const scheme = coloring?.scheme ?? null;
    if (!colorAlphabet) return null;
    if (!scheme) {
        return (glyph, fallbackColor = null) => {
            const symbolIndex = colorAlphabet.symbols?.indexOf?.(glyph) ?? -1;
            if (symbolIndex < 0) return fallbackColor;
            return colorAlphabet.logoColors?.[symbolIndex] ?? fallbackColor;
        };
    }
    return (glyph, fallbackColor = null) => resolveSymbolColor({
        glyph,
        alphabet: colorAlphabet,
        scheme,
    }) ?? fallbackColor;
}
