import { TrackView } from "../../views/tracks/TrackView.js";
import { resolveBuiltInTrackLayer, resolveBuiltInTrackTooltip } from "./builtInTrackBehaviors.js";

export function createTrackFromDefinition(definition, {
    behaviorHelpers = {},
} = {}) {
    if (!definition) return null;

    const resolvedOptions = definition.options ?? {};
    const resolvedLayout = resolvedOptions.layout
        ? {
            ...resolvedOptions.layout,
            lanes: Array.isArray(resolvedOptions.layout.lanes)
                ? resolvedOptions.layout.lanes.map((lane) => ({
                    ...lane,
                    layers: Array.isArray(lane.layers)
                        ? lane.layers.map((layer) => resolveBuiltInTrackLayer(layer))
                        : [],
                }))
                : [],
        }
        : null;
    if (!resolvedLayout?.lanes?.length) return null;
    const resolvedTooltip = resolveBuiltInTrackTooltip(resolvedOptions.tooltip ?? null, behaviorHelpers);

    return new TrackView({
        id: definition.id,
        label: definition.label,
        sublabel: resolvedOptions.sublabel ?? null,
        ...resolvedOptions,
        layout: resolvedLayout,
        tooltip: resolvedTooltip,
        source: definition.source ?? null,
        coloring: definition.coloring ?? null,
    });
}
