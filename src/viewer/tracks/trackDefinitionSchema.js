/**
 * @typedef {"metric"|"values"|"consensus"} TrackSourceType
 * @typedef {"bar"|"line"|"glyph"|"logo"} TrackLayerType
 *
 * @typedef {{
 *   type: TrackSourceType,
 *   representation?: "active"|string,
 *   metric?: string,
 *   values?: ArrayLike<number>|null,
 * }} TrackSourceDefinition
 *
 * @typedef {{
 *   representation?: "active"|string,
 *   alphabet?: string|null,
 *   scheme?: string|null,
 * }} TrackColoringDefinition
 *
 * @typedef {{
 *   type: TrackLayerType,
 *   height?: number,
 *   style?: Object,
 *   colors?: Object,
 *   colorRamps?: Object,
 *   includeGaps?: boolean,
 *   show?: boolean,
 *   getGlyph?: Function,
 * }} TrackLayerDefinition
 *
 * @typedef {{
 *   height?: number,
 *   sublabel?: string|null,
 *   valueRange?: { min?: number, max?: number }|null,
 *   elements?: {
 *     barHeight?: number,
 *     glyphSize?: number,
 *     logoHeight?: number,
 *   }|null,
 *   layers?: TrackLayerDefinition[],
 *   tooltip?: Function|null,
 * }} TrackOptionsDefinition
 *
 * @typedef {{
 *   alphabets?: string[]|null,
 *   shared?: boolean,
 * }} TrackSupportsDefinition
 *
 * @typedef {{
 *   id: string,
 *   label?: string,
 *   supports?: TrackSupportsDefinition|null,
 *   source: TrackSourceDefinition|null,
 *   coloring?: TrackColoringDefinition|null,
 *   options?: TrackOptionsDefinition,
 * }} TrackDefinition
 */

export const TRACK_SOURCE_TYPES = new Set(["metric", "values", "consensus"]);
export const TRACK_LAYER_TYPES = new Set(["bar", "line", "glyph", "logo"]);

function isObject(value) {
    return value != null && typeof value === "object" && !Array.isArray(value);
}

export function mergeNestedOptions(base, override) {
    if (!isObject(base)) {
        return isObject(override) ? { ...override } : override;
    }
    if (!isObject(override)) {
        return { ...base };
    }
    const result = { ...base };
    for (const [key, value] of Object.entries(override)) {
        if (isObject(value) && isObject(base[key])) {
            result[key] = mergeNestedOptions(base[key], value);
        } else {
            result[key] = value;
        }
    }
    return result;
}

function resolveConfiguredTrackHeight(options = {}) {
    if (Number.isFinite(options.height)) {
        return Math.max(20, options.height);
    }
    const elements = options.elements ?? {};
    const layers = options.layers ?? [];
    if (layers.some((layer) => TRACK_LAYER_TYPES.has(layer.type))) {
        const glyphLayer = layers.find((layer) => layer.type === "glyph");
        const lineLikeLayer = layers.find((layer) => layer.type === "bar" || layer.type === "line" || layer.type === "logo");
        const glyphSize = elements.glyphSize ?? glyphLayer?.style?.fontSize ?? 14;
        const showGlyphs = Boolean(glyphLayer);
        const glyphLane = showGlyphs ? glyphSize + 4 : 0;
        const mainHeight = elements.logoHeight ?? elements.barHeight ?? lineLikeLayer?.height ?? 24;
        return Math.max(24, mainHeight + glyphLane);
    }
    return 60;
}

function applyTrackElementSizing(options = {}) {
    const resolvedOptions = mergeNestedOptions({}, options);
    if (!Array.isArray(resolvedOptions.layers)) {
        return resolvedOptions;
    }

    const elements = resolvedOptions.elements ?? {};
    if (Number.isFinite(elements.glyphSize)) {
        resolvedOptions.layers = resolvedOptions.layers.map((layer) =>
            layer.type === "glyph"
                ? {
                    ...layer,
                    style: {
                        ...(layer.style ?? {}),
                        fontSize: elements.glyphSize,
                    },
                }
                : layer
        );
    }
    if (Number.isFinite(elements.logoHeight)) {
        resolvedOptions.layers = resolvedOptions.layers.map((layer) =>
            layer.type === "logo"
                ? { ...layer, height: elements.logoHeight }
                : layer
        );
    }
    if (Number.isFinite(elements.barHeight)) {
        resolvedOptions.layers = resolvedOptions.layers.map((layer) =>
            layer.type === "bar" || layer.type === "line"
                ? { ...layer, height: elements.barHeight }
                : layer
        );
    }
    return resolvedOptions;
}

function normalizeTrackSource(source = null) {
    if (!source) return null;
    if (!TRACK_SOURCE_TYPES.has(source.type)) {
        throw new Error(`Unsupported track source type: ${source.type}`);
    }
    return {
        representation: source.representation ?? "active",
        ...source,
    };
}

function normalizeTrackColoring(coloring = null, source = null) {
    if (!coloring) {
        return {
            representation: source?.representation ?? "active",
            alphabet: null,
            scheme: null,
        };
    }
    return {
        representation: coloring.representation ?? source?.representation ?? "active",
        alphabet: coloring.alphabet ?? null,
        scheme: coloring.scheme ?? null,
    };
}

function normalizeTrackLayers(layers = []) {
    if (!Array.isArray(layers)) {
        return [];
    }
    return layers.map((layer) => {
        if (!TRACK_LAYER_TYPES.has(layer?.type)) {
            throw new Error(`Unsupported track layer type: ${layer?.type}`);
        }
        return { ...layer };
    });
}

export function normalizeTrackDefinition(definition) {
    if (!definition) return null;
    if (!definition.id) {
        throw new Error("Track definitions require an id.");
    }

    const source = normalizeTrackSource(definition.source);
    const rawOptions = definition.options ?? {};
    const options = applyTrackElementSizing({
        ...rawOptions,
        layers: normalizeTrackLayers(rawOptions.layers ?? []),
    });

    return {
        ...definition,
        id: definition.id,
        label: definition.label ?? definition.id,
        supports: {
            alphabets: Array.isArray(definition.supports?.alphabets) ? [...definition.supports.alphabets] : null,
            shared: definition.supports?.shared === true,
        },
        source,
        coloring: normalizeTrackColoring(definition.coloring, source),
        options: {
            ...options,
            height: resolveConfiguredTrackHeight(options),
        },
    };
}

export function normalizeTrackDefinitions({
    builtInDefinitions = {},
    userDefinitions = {},
    order = null,
}) {
    const definitionsById = new Map();
    const builtInIds = Object.keys(builtInDefinitions);

    for (const id of builtInIds) {
        const builtIn = builtInDefinitions[id];
        const override = userDefinitions[id] ?? null;
        definitionsById.set(id, normalizeTrackDefinition({
            ...builtIn,
            ...(override ?? {}),
            options: mergeNestedOptions(builtIn.options ?? {}, override?.options ?? {}),
        }));
    }

    for (const [id, definition] of Object.entries(userDefinitions)) {
        if (definitionsById.has(id)) continue;
        definitionsById.set(id, normalizeTrackDefinition({
            ...definition,
            id: definition?.id ?? id,
            label: definition?.label ?? definition?.id ?? id,
            options: mergeNestedOptions({}, definition.options ?? {}),
        }));
    }

    const availableIds = new Set(definitionsById.keys());
    const fallbackOrder = [...builtInIds, ...Object.keys(userDefinitions).filter((id) => !builtInIds.includes(id))];
    const orderedIds = Array.isArray(order) && order.length > 0
        ? [
            ...order.filter((id) => availableIds.has(id)),
            ...fallbackOrder.filter((id) => !order.includes(id) && availableIds.has(id)),
        ]
        : fallbackOrder.filter((id) => availableIds.has(id));

    return orderedIds.map((id) => definitionsById.get(id)).filter(Boolean);
}
