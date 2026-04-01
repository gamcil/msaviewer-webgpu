import { createBarTrackStyle, createGlyphTrackStyle, createLineTrackStyle } from "../trackStyles.js";
import { createBarColorRamps } from "../models/barRenderModel.js";
import { prepareColorRamp } from "../renderers/trackRenderers.js";
import { createPreparedLineColorRamp } from "../models/lineRenderModel.js";
import { resolveSymbolColor } from "../../schemes/symbolColorResolver.js";
import { buildConsensusState } from "../../viewer/TrackStateBuilder.js";

export function getDefaultGlyphFillStyle(theme) {
    return theme?.darkMode ? "#e6e6e6" : "#333";
}

export function getThemeColor(colors, key, theme) {
    if (!colors) return undefined;
    const themeColors = theme?.darkMode ? colors.dark : colors.light;
    if (!themeColors || !(key in themeColors)) {
        return undefined;
    }
    return themeColors[key];
}

export function getThemedStyleValue(colors, key, fallback, theme) {
    const themed = getThemeColor(colors, key, theme);
    return themed === undefined ? fallback : themed;
}

export function normalizeTrackLayers(layers = []) {
    return layers.map((layer) => {
        if (layer.type === "bar") {
            return {
                ...layer,
                style: createBarTrackStyle(layer.style),
                colorRamps: layer.colorRamps ? createBarColorRamps(layer.colorRamps, prepareColorRamp) : { fill: null, stroke: null, glyph: null },
            };
        }
        if (layer.type === "line") {
            return {
                ...layer,
                style: createLineTrackStyle(layer.style),
                colorRamp: createPreparedLineColorRamp(layer.colorRamp),
            };
        }
        if (layer.type === "glyph") {
            return {
                ...layer,
                style: createGlyphTrackStyle(layer.style),
                colorRamps: layer.colorRamps ? createBarColorRamps(layer.colorRamps, prepareColorRamp) : { fill: null, stroke: null, glyph: null },
            };
        }
        return { ...layer };
    });
}

export function isNumericTrackData(data) {
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

function resolveTrackRepresentationId(source, trackContext) {
    const representationRef = source?.representation ?? "active";
    if (representationRef === "active" || representationRef == null) {
        return trackContext?.activeRepresentationId ?? null;
    }
    return representationRef;
}

export function resolveTrackSourceRepresentation(source, trackContext) {
    const representationId = resolveTrackRepresentationId(source, trackContext);
    if (!representationId) return null;
    return trackContext?.getRepresentation?.(representationId) ?? null;
}

export function resolveTrackSourceTrackState(source, trackContext) {
    if (!source || !trackContext) return null;
    const representationRef = source.representation ?? "active";
    const representation = resolveTrackSourceRepresentation(source, trackContext);
    if (representation) {
        return representation.trackState ?? null;
    }
    if (representationRef === "active" || representationRef == null) {
        return trackContext.activeTrackState ?? null;
    }
    return null;
}

export function resolveTrackSourceData(source, trackContext) {
    if (!source) {
        return undefined;
    }
    const representation = resolveTrackSourceRepresentation(source, trackContext);
    const trackState = resolveTrackSourceTrackState(source, trackContext);
    if (source.type === "metric" && source.metric) {
        if (representation?.columnMetrics?.[source.metric]) {
            return representation.columnMetrics[source.metric];
        }
        return trackState?.metrics?.[source.metric] ?? null;
    }
    if (source.type === "consensus") {
        if (representation?.columnMetrics && representation?.store) {
            const alphabet = trackContext?.getAlphabet?.(representation.alphabetId) ?? null;
            if (alphabet) {
                return buildConsensusState(
                    representation.columnMetrics,
                    representation.store.totalRows,
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

export function resolveTrackColorAlphabet(coloring, source, trackContext) {
    const alphabetId = coloring?.alphabet;
    if (alphabetId) {
        return trackContext?.getAlphabet?.(alphabetId) ?? null;
    }

    const representationRef = coloring?.representation ?? source?.representation ?? "active";
    if (representationRef === "active" || representationRef == null) {
        const activeRepresentation = trackContext?.getRepresentation?.(trackContext?.activeRepresentationId);
        if (!activeRepresentation) return trackContext?.getActiveAlphabet?.() ?? null;
        return trackContext?.getAlphabet?.(activeRepresentation.alphabetId) ?? null;
    }

    const representation = trackContext?.getRepresentation?.(representationRef) ?? null;
    if (!representation) return null;
    return trackContext?.getAlphabet?.(representation.alphabetId) ?? null;
}

export function resolveTrackSymbolColorResolver(coloring, source, trackContext) {
    const colorAlphabet = resolveTrackColorAlphabet(coloring, source, trackContext);
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
