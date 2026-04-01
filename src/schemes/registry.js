export const SCHEMES = {
    clustalx: {
        id: 0,
        label: "ClustalX",
        type: "columnStatistic",
        profileStride: 4,
        supports: (alphabet) => alphabet?.id === "aa",
    },
    pid: {
        id: 1,
        label: "Identity",
        type: "columnStatistic",
        profileStride: 4,
        supports: () => true,
    },
    similarity: {
        id: 2,
        label: "Similarity",
        type: "columnStatistic",
        profileStride: 4,
        supports: (alphabet) => Boolean(alphabet?.supports?.quality),
    },
    hydrophobicity: {
        id: 3,
        label: "Hydrophobicity",
        type: "residueProperty",
        profileStride: 4,
        supports: (alphabet) => alphabet?.id === "aa",
    },
    zappo: {
        id: 4,
        label: "Zappo",
        type: "residueProperty",
        profileStride: 4,
        supports: (alphabet) => alphabet?.id === "aa",
    },
    taylor: {
        id: 5,
        label: "Taylor",
        type: "residueProperty",
        profileStride: 4,
        supports: (alphabet) => alphabet?.id === "aa",
    },
    gecosBlossom: {
        id: 6,
        label: "Gecos Blossom",
        type: "residueProperty",
        profileStride: 4,
        supports: (alphabet) => alphabet?.id === "aa",
    },
    gecosSunset: {
        id: 7,
        label: "Gecos Sunset",
        type: "residueProperty",
        profileStride: 4,
        supports: (alphabet) => alphabet?.id === "aa",
    },
    gecosOcean: {
        id: 8,
        label: "Gecos Ocean",
        type: "residueProperty",
        profileStride: 4,
        supports: (alphabet) => alphabet?.id === "aa",
    },
    helixPropensity: {
        id: 9,
        label: "Helix Propensity",
        type: "residueProperty",
        profileStride: 4,
        supports: (alphabet) => alphabet?.id === "aa",
    },
    strandPropensity: {
        id: 10,
        label: "Strand Propensity",
        type: "residueProperty",
        profileStride: 4,
        supports: (alphabet) => alphabet?.id === "aa",
    },
    turnPropensity: {
        id: 11,
        label: "Turn Propensity",
        type: "residueProperty",
        profileStride: 4,
        supports: (alphabet) => alphabet?.id === "aa",
    },
    buriedIndex: {
        id: 12,
        label: "Buried Index",
        type: "residueProperty",
        profileStride: 4,
        supports: (alphabet) => alphabet?.id === "aa",
    },
    "3di": {
        id: 13,
        label: "3Di",
        type: "residueProperty",
        profileStride: 4,
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

export function isSchemeSupportedForAlphabet(schemeKey, alphabet) {
    const scheme = SCHEMES[schemeKey];
    if (!scheme) {
        return false;
    }
    return typeof scheme.supports === "function" ? scheme.supports(alphabet) : true;
}

export function getSupportedSchemeKeysForAlphabet(alphabet) {
    return Object.keys(SCHEMES).filter((schemeKey) => isSchemeSupportedForAlphabet(schemeKey, alphabet));
}

export function getDefaultSchemeKeyForAlphabet(alphabet) {
    for (const schemeKey of DEFAULT_SCHEME_ORDER) {
        if (isSchemeSupportedForAlphabet(schemeKey, alphabet)) {
            return schemeKey;
        }
    }
    return "pid";
}
