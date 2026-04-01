import { TrackView } from "../../views/tracks/TrackView.js";

export function createTrackFromDefinition(definition, {
    labelWidth = 100,
} = {}) {
    if (!definition) return null;

    const root = document.createElement("div");
    root.className = "msa-track";
    const resolvedOptions = definition.options ?? {};
    if (!Array.isArray(resolvedOptions.layers)) return null;

    return new TrackView({
        root,
        id: definition.id,
        label: definition.label,
        sublabel: resolvedOptions.sublabel ?? null,
        height: resolvedOptions.height,
        labelWidth,
        ...resolvedOptions,
        source: definition.source ?? null,
        coloring: definition.coloring ?? null,
    });
}
