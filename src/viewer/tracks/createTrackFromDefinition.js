import { TrackView } from "../../views/tracks/TrackView.js";
import { resolveBuiltInTrackLayer, resolveBuiltInTrackTooltip } from "./builtInTrackBehaviors.js";

export function createTrackFromDefinition(definition, {
    labelWidth = 100,
    behaviorHelpers = {},
} = {}) {
    if (!definition) return null;

    const root = document.createElement("div");
    root.className = "msa-track";
    const resolvedOptions = definition.options ?? {};
    if (!Array.isArray(resolvedOptions.layers)) return null;
    const resolvedLayers = resolvedOptions.layers.map((layer) => resolveBuiltInTrackLayer(layer));
    const resolvedTooltip = resolveBuiltInTrackTooltip(resolvedOptions.tooltip ?? null, behaviorHelpers);

    return new TrackView({
        root,
        id: definition.id,
        label: definition.label,
        sublabel: resolvedOptions.sublabel ?? null,
        height: resolvedOptions.height,
        labelWidth,
        ...resolvedOptions,
        layers: resolvedLayers,
        tooltip: resolvedTooltip,
        source: definition.source ?? null,
        coloring: definition.coloring ?? null,
    });
}
