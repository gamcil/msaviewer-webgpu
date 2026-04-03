import { warmSequenceLogoGlyphCache } from "../renderers/trackRenderers.js";
import { buildBarRenderColumns } from "../models/barRenderModel.js";
import { buildConsensusRenderColumns, collectConsensusLogoGlyphPairs } from "../models/consensusRenderModel.js";
import { getDefaultGlyphFillStyle, isNumericTrackData, resolveTrackSymbolColorResolver } from "./trackRuntime.js";

export function buildTrackLayerCaches({
    source,
    coloring,
    trackContext,
    data,
    layers,
    theme,
    normalizeValue,
}) {
    const numericData = isNumericTrackData(data);
    const resolveLetterColor = resolveTrackSymbolColorResolver(coloring, source, trackContext);
    return layers.map((layer) => {
        if (source?.type === "consensus") {
            if (!data?.columns?.length) {
                return null;
            }
            return {
                renderColumns: buildConsensusRenderColumns(data.columns, { resolveLetterColor }),
            };
        }
        if (!numericData) {
            return null;
        }
        if (layer.type === "bar") {
            return {
                renderColumns: buildBarRenderColumns(data, {
                    normalizeValue,
                    colorRamps: layer.colorRamps,
                    defaultFillStyle: layer.style.fillStyle,
                    defaultStrokeStyle: layer.style.strokeStyle,
                    defaultGlyphFillStyle: getDefaultGlyphFillStyle(theme),
                }),
            };
        }
        if (layer.type === "glyph" && typeof layer.getGlyph === "function") {
            return {
                renderColumns: buildBarRenderColumns(data, {
                    normalizeValue,
                    colorRamps: layer.colorRamps,
                    defaultFillStyle: null,
                    defaultStrokeStyle: null,
                    defaultGlyphFillStyle: layer.style.fillStyle ?? getDefaultGlyphFillStyle(theme),
                }),
            };
        }
        return null;
    });
}

export function warmTrackLogoGlyphCaches({
    source,
    layers,
    layerCaches,
    theme,
}) {
    if (source?.type !== "consensus") return;
    for (let index = 0; index < layers.length; index += 1) {
        const layer = layers[index];
        const cache = layerCaches[index];
        if (layer?.type !== "logo" || !cache?.renderColumns || layer.show === false) continue;
        const glyphColorPairs = collectConsensusLogoGlyphPairs(cache.renderColumns);
        warmSequenceLogoGlyphCache(
            layer.style?.logoFont ?? `bold 100px ${theme?.uiFontFamily ?? "\"IBM Plex Sans\", sans-serif"}`,
            glyphColorPairs
        );
    }
}
