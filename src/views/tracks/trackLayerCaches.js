import { warmSequenceLogoGlyphCache } from "../renderers/trackRenderers.js";
import { buildBarRenderColumns } from "../models/barRenderModel.js";
import { buildConsensusRenderColumns, collectConsensusLogoGlyphPairs } from "../models/consensusRenderModel.js";
import { defaultGlyphFill, isNumericData, resolveGlyphColor, resolveTrackData } from "./trackRuntime.js";

export function buildTrackLayerCaches({
    source,
    coloring,
    trackContext,
    data,
    layers,
    theme,
    normalizeValue,
}) {
    return layers.map((layer) => {
        const layerSource = layer.source ?? source;
        const layerData = layer.source ? resolveTrackData(layerSource, trackContext) : data;
        const cache = { source: layerSource, data: layerData };
        const glyphColor = resolveGlyphColor(layer.coloring ?? coloring, layerSource, trackContext);
        if (layerSource?.type === "consensus") {
            if (!layerData?.columns?.length) {
                return cache;
            }
            return {
                ...cache,
                renderColumns: buildConsensusRenderColumns(layerData.columns, { resolveLetterColor: glyphColor }),
            };
        }
        if (!isNumericData(layerData)) {
            return cache;
        }
        if (layer.type === "bar") {
            return {
                ...cache,
                renderColumns: buildBarRenderColumns(layerData, {
                    normalizeValue,
                    colorRamps: layer.colorRamps,
                    defaultFillStyle: layer.style.fillStyle,
                    defaultStrokeStyle: layer.style.strokeStyle,
                    defaultGlyphFillStyle: defaultGlyphFill(theme),
                }),
            };
        }
        if (layer.type === "glyph" && typeof layer.getGlyph === "function") {
            return {
                ...cache,
                renderColumns: buildBarRenderColumns(layerData, {
                    normalizeValue,
                    colorRamps: layer.colorRamps,
                    defaultFillStyle: null,
                    defaultStrokeStyle: null,
                    defaultGlyphFillStyle: layer.style.fillStyle ?? defaultGlyphFill(theme),
                }),
            };
        }
        return cache;
    });
}

export function warmTrackLogoGlyphCaches({
    source,
    layers,
    layerCaches,
    theme,
}) {
    for (let index = 0; index < layers.length; index += 1) {
        const layer = layers[index];
        const cache = layerCaches[index];
        if ((cache?.source ?? layer?.source ?? source)?.type !== "consensus") continue;
        if (layer?.type !== "logo" || !cache?.renderColumns || layer.show === false) continue;
        const glyphColorPairs = collectConsensusLogoGlyphPairs(cache.renderColumns);
        warmSequenceLogoGlyphCache(
            layer.style?.logoFont ?? `bold 100px ${theme?.uiFontFamily ?? "\"IBM Plex Sans\", sans-serif"}`,
            glyphColorPairs
        );
    }
}
