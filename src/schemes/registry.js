import { resolveColormap } from "./colormaps.js";
import { computeCustomSchemeColors } from "./customColorScheme.js";

export const COLUMN_PROFILE_BYTES_PER_COLUMN = Uint32Array.BYTES_PER_ELEMENT;
const CUSTOM_SCHEME_ID_START = 1000;

export const BUILT_IN_COLOR_SCHEMES = {
    clustalx: {
        id: 0,
        label: "ClustalX",
        mode: "column-statistic",
        profileKind: "column-statistic",
        scope: "representation",
        requiresColumnMetrics: true,
        supports: (alphabet) => alphabet?.id === "aa",
    },
    pid: {
        id: 1,
        label: "Identity",
        mode: "column-statistic",
        profileKind: "column-statistic",
        scope: "representation",
        requiresColumnMetrics: true,
        supports: () => true,
    },
    similarity: {
        id: 2,
        label: "Similarity",
        mode: "column-statistic",
        profileKind: "column-statistic",
        scope: "representation",
        requiresColumnMetrics: true,
        supports: (alphabet) => Boolean(alphabet?.supports?.quality),
    },
    hydrophobicity: {
        id: 3,
        label: "Hydrophobicity",
        mode: "residue-property",
        profileKind: "none",
        scope: "representation",
        requiresColumnMetrics: false,
        supports: (alphabet) => alphabet?.id === "aa",
    },
    zappo: {
        id: 4,
        label: "Zappo",
        mode: "residue-property",
        profileKind: "none",
        scope: "representation",
        requiresColumnMetrics: false,
        supports: (alphabet) => alphabet?.id === "aa",
    },
    taylor: {
        id: 5,
        label: "Taylor",
        mode: "residue-property",
        profileKind: "none",
        scope: "representation",
        requiresColumnMetrics: false,
        supports: (alphabet) => alphabet?.id === "aa",
    },
    gecosBlossom: {
        id: 6,
        label: "Gecos Blossom",
        mode: "residue-property",
        profileKind: "none",
        scope: "representation",
        requiresColumnMetrics: false,
        supports: (alphabet) => alphabet?.id === "aa",
    },
    gecosSunset: {
        id: 7,
        label: "Gecos Sunset",
        mode: "residue-property",
        profileKind: "none",
        scope: "representation",
        requiresColumnMetrics: false,
        supports: (alphabet) => alphabet?.id === "aa",
    },
    gecosOcean: {
        id: 8,
        label: "Gecos Ocean",
        mode: "residue-property",
        profileKind: "none",
        scope: "representation",
        requiresColumnMetrics: false,
        supports: (alphabet) => alphabet?.id === "aa",
    },
    helixPropensity: {
        id: 9,
        label: "Helix Propensity",
        mode: "residue-property",
        profileKind: "none",
        scope: "representation",
        requiresColumnMetrics: false,
        supports: (alphabet) => alphabet?.id === "aa",
    },
    strandPropensity: {
        id: 10,
        label: "Strand Propensity",
        mode: "residue-property",
        profileKind: "none",
        scope: "representation",
        requiresColumnMetrics: false,
        supports: (alphabet) => alphabet?.id === "aa",
    },
    turnPropensity: {
        id: 11,
        label: "Turn Propensity",
        mode: "residue-property",
        profileKind: "none",
        scope: "representation",
        requiresColumnMetrics: false,
        supports: (alphabet) => alphabet?.id === "aa",
    },
    buriedIndex: {
        id: 12,
        label: "Buried Index",
        mode: "residue-property",
        profileKind: "none",
        scope: "representation",
        requiresColumnMetrics: false,
        supports: (alphabet) => alphabet?.id === "aa",
    },
    "3di": {
        id: 13,
        label: "3Di",
        mode: "residue-property",
        profileKind: "none",
        scope: "representation",
        requiresColumnMetrics: false,
        supports: (alphabet) => alphabet?.id === "3di",
    }
};

const DEFAULT_SCHEME_ORDER = [
    "clustalx",
    "pid",
    "similarity",
    "hydrophobicity",
    "zappo",
    "taylor",
    "gecosBlossom",
    "gecosSunset",
    "gecosOcean",
    "helixPropensity",
    "strandPropensity",
    "turnPropensity",
    "buriedIndex",
    "3di"
];

export function createSchemeRegistry() {
    return { ...BUILT_IN_COLOR_SCHEMES };
}

export function isSchemeSupportedForAlphabet(schemeKey, alphabet, schemes = BUILT_IN_COLOR_SCHEMES) {
    const scheme = schemes[schemeKey];
    if (!scheme) {
        return false;
    }
    return typeof scheme.supports === "function" ? scheme.supports(alphabet) : true;
}

export function getDefaultSchemeKeyForAlphabet(alphabet, schemes = BUILT_IN_COLOR_SCHEMES) {
    for (const schemeKey of DEFAULT_SCHEME_ORDER) {
        if (isSchemeSupportedForAlphabet(schemeKey, alphabet, schemes)) {
            return schemeKey;
        }
    }
    return "pid";
}

function assertCustomSchemeKey(key, schemes) {
    if (typeof key !== "string" || key.length === 0) {
        throw new Error("Custom color scheme key must be a non-empty string.");
    }
    const existing = schemes[key];
    if (existing && existing.custom !== true) {
        throw new Error(`Cannot replace built-in color scheme '${key}'.`);
    }
}

function resolveExplicitRange(options) {
    if (!Number.isFinite(options.min) || !Number.isFinite(options.max)) {
        throw new Error("Custom color scheme requires finite min and max values.");
    }
    if (options.min === options.max) {
        throw new Error("Custom color scheme min and max must be different values.");
    }
    return { min: options.min, max: options.max };
}

function resolveValues(options, expectedColumnCount) {
    const values = options.values ?? null;
    if (!values || typeof values.length !== "number") {
        throw new Error("Custom color scheme requires array-like values.");
    }
    if (expectedColumnCount != null && values.length !== expectedColumnCount) {
        throw new Error(`Custom color scheme values length (${values.length}) must match the active alignment column count (${expectedColumnCount}).`);
    }
    return values;
}

function resolveCustomColorMapping(options) {
    const colormap = resolveColormap(options.colormap);
    if (!colormap) {
        throw new Error("Custom color scheme requires colormap to be a known name or at least two valid color stops.");
    }
    return colormap;
}

function nextCustomSchemeId(schemes) {
    let nextId = CUSTOM_SCHEME_ID_START;
    for (const scheme of Object.values(schemes)) {
        if (scheme?.custom === true && Number.isInteger(scheme.id)) {
            nextId = Math.max(nextId, scheme.id + 1);
        }
    }
    return nextId;
}

export function registerCustomColorScheme(schemes, key, options = {}, { expectedColumnCount = null } = {}) {
    assertCustomSchemeKey(key, schemes);
    const previous = schemes[key];
    const values = resolveValues(options, expectedColumnCount);
    const { min, max } = resolveExplicitRange(options);
    const colormap = resolveCustomColorMapping(options);
    const missingValue = options.missingValue ?? null;
    const colors = computeCustomSchemeColors({
        values,
        min,
        max,
        colormap,
        missingValue,
    });
    const scheme = {
        id: previous?.id ?? nextCustomSchemeId(schemes),
        key,
        label: options.label ?? previous?.label ?? key,
        mode: "scalar-column",
        profileKind: "packed-color",
        scope: "viewer",
        requiresColumnMetrics: false,
        custom: true,
        version: (previous?.version ?? 0) + 1,
        colors,
        columnCount: values.length,
        min,
        max,
        missingValue,
    };
    schemes[key] = scheme;
    return scheme;
}

export function publicColorSchemeDescriptor(scheme) {
    return {
        key: scheme.key,
        label: scheme.label,
        min: scheme.min,
        max: scheme.max,
        missingValue: scheme.missingValue,
        columnCount: scheme.columnCount,
    };
}
