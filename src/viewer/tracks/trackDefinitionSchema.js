export const TRACK_SOURCE_TYPES = new Set(["metric", "values", "consensus"]);
export const TRACK_LAYER_TYPES = new Set(["bar", "line", "glyph", "logo"]);

function isObject(value) {
    return value != null && typeof value === "object" && !Array.isArray(value);
}

function clampTrackSize(value, minimum = 0) {
    if (!Number.isFinite(value)) {
        return minimum;
    }
    return Math.max(minimum, value);
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

function resolveTrackLayerIntrinsicHeight(layer = {}) {
    if (layer.type === "glyph") {
        const fontSize = layer.style?.fontSize ?? 14;
        return Math.max(1, fontSize + 4);
    }
    if (layer.type === "bar" || layer.type === "line" || layer.type === "logo") {
        return clampTrackSize(layer.height, 24);
    }
    return 24;
}

function resolveTrackLaneHeight(lane = null, layers = []) {
    if (Number.isFinite(lane?.height)) {
        return clampTrackSize(lane.height, 1);
    }
    if (!layers.length) {
        return 0;
    }
    return Math.max(...layers.map((layer) => resolveTrackLayerIntrinsicHeight(layer)));
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

function normalizeTrackLane(lane = {}) {
    const layers = normalizeTrackLayers(lane?.layers ?? []);
    return {
        ...lane,
        height: resolveTrackLaneHeight(lane, layers),
        layers,
    };
}

function resolveTrackLayoutHeight(layout = {}) {
    const lanes = Array.isArray(layout.lanes) ? layout.lanes : [];
    const gap = clampTrackSize(layout.gap, 0);
    const laneHeights = lanes.reduce((sum, lane) => sum + clampTrackSize(lane.height, 0), 0);
    const gaps = Math.max(0, lanes.length - 1) * gap;
    return clampTrackSize(layout.paddingTop, 0)
        + clampTrackSize(layout.paddingBottom, 0)
        + laneHeights
        + gaps;
}

function normalizeTrackLayout(layout = null) {
    const lanes = Array.isArray(layout?.lanes)
        ? layout.lanes.map((lane) => normalizeTrackLane(lane))
        : [];
    const normalizedLayout = {
        paddingTop: clampTrackSize(layout?.paddingTop, 0),
        paddingBottom: clampTrackSize(layout?.paddingBottom, 0),
        gap: clampTrackSize(layout?.gap, 0),
        lanes,
    };
    return {
        ...normalizedLayout,
        totalHeight: resolveTrackLayoutHeight(normalizedLayout),
    };
}

export function normalizeTrackDefinition(definition) {
    if (!definition) return null;
    if (!definition.id) {
        throw new Error("Track definitions require an id.");
    }

    const source = normalizeTrackSource(definition.source);
    const rawOptions = definition.options ?? {};
    if (!rawOptions.layout) {
        throw new Error(`Track definition "${definition.id}" requires options.layout.`);
    }
    const { layout: rawLayout, ...optionOverrides } = rawOptions;
    const layout = normalizeTrackLayout(rawLayout);

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
            ...optionOverrides,
            layout,
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
