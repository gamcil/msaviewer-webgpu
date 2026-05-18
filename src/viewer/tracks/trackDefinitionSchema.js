import { mergeObjects } from "../../util.js";

const TRACK_SOURCE_TYPES = new Set(["metric", "values", "consensus"]);
const TRACK_LAYER_TYPES = new Set(["bar", "line", "glyph", "logo"]);

function layerHeight(layer = {}) {
    if (layer.type === "glyph") {
        const fontSize = layer.style?.fontSize ?? 14;
        return Math.max(1, fontSize + 4);
    }
    if (layer.type === "bar" || layer.type === "line" || layer.type === "logo") {
        return Math.max(24, Number.isFinite(layer.height) ? layer.height : 24);
    }
    return 24;
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
        const source = normalizeTrackSource(layer.source);
        const normalized = { ...layer };
        if (source) {
            normalized.source = source;
        }
        if (layer.coloring) {
            normalized.coloring = normalizeTrackColoring(layer.coloring, source);
        }
        return normalized;
    });
}

export function normalizeTrackDefinition(definition) {
    if (!definition) return null;
    if (!definition.id) {
        throw new Error("Track definitions require an id.");
    }

    const {
        lanes: rawLanes,
        supports: rawSupports,
        height: _height,
        ...rest
    } = definition;
    if (_height != null) {
        throw new Error(`Track definition "${definition.id}" does not accept height. Track height is derived from its lanes.`);
    }
    if (!Array.isArray(rawLanes) || rawLanes.length === 0) {
        throw new Error(`Track definition "${definition.id}" requires lanes.`);
    }

    const lanes = rawLanes.map((lane = {}, index) => {
        const {
            layers: rawLayers,
            height,
            ...restLane
        } = lane;
        if (height != null) {
            throw new Error(`Track definition "${definition.id}" lane ${index} does not accept height. Lane height is derived from its layers.`);
        }
        const layers = normalizeTrackLayers(rawLayers ?? []);
        return {
            ...restLane,
            height: Math.max(0, ...layers.map((layer) => layerHeight(layer))),
            layers,
        };
    });
    const source = normalizeTrackSource(rest.source);
    return {
        ...rest,
        id: definition.id,
        label: rest.label ?? definition.id,
        supports: {
            alphabets: Array.isArray(rawSupports?.alphabets) ? [...rawSupports.alphabets] : null,
            shared: rawSupports?.shared === true,
        },
        source,
        coloring: normalizeTrackColoring(rest.coloring, source),
        lanes,
    };
}

export function normalizeTrackDefinitions({
    builtInDefinitions = {},
    userDefinitions = [],
    order = null,
}) {
    const definitionsById = new Map();
    const builtInIds = Object.keys(builtInDefinitions);
    const userDefinitionList = Array.isArray(userDefinitions) ? userDefinitions : [];
    const userDefinitionsById = new Map(userDefinitionList
        .filter((definition) => definition?.id)
        .map((definition) => [definition.id, definition]));

    for (const id of builtInIds) {
        const builtIn = builtInDefinitions[id];
        const override = userDefinitionsById.get(id) ?? null;
        definitionsById.set(id, normalizeTrackDefinition(mergeObjects(builtIn, override ?? {})));
    }

    for (const definition of userDefinitionList) {
        const id = definition?.id;
        if (!id) continue;
        if (definitionsById.has(id)) continue;
        definitionsById.set(id, normalizeTrackDefinition(definition));
    }

    const availableIds = new Set(definitionsById.keys());
    const userIds = userDefinitionList.map((definition) => definition?.id).filter(Boolean);
    const fallbackOrder = [...builtInIds, ...userIds.filter((id) => !builtInIds.includes(id))];
    const orderedIds = Array.isArray(order) && order.length > 0
        ? [
            ...order.filter((id) => availableIds.has(id)),
            ...fallbackOrder.filter((id) => !order.includes(id) && availableIds.has(id)),
        ]
        : fallbackOrder.filter((id) => availableIds.has(id));

    return orderedIds.map((id) => definitionsById.get(id)).filter(Boolean);
}
