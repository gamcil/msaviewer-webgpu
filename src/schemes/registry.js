export const SCHEMES = {
    clustalx: {
        id: 0,
        type: "columnStatistic",
        profileStride: 4,
        supports: (alphabet) => alphabet?.id === "aa",
    },
    pid: {
        id: 1,
        type: "columnStatistic",
        profileStride: 4,
        supports: () => true,
    },
    blosum62: {
        id: 2,
        type: "columnStatistic",
        profileStride: 4,
        supports: (alphabet) => Boolean(alphabet?.supports?.quality),
    },
    hydrophobicity: {
        id: 3,
        type: "residueProperty",
        profileStride: 4,
        supports: (alphabet) => alphabet?.id === "aa",
    },
    zappo: {
        id: 4,
        type: "residueProperty",
        profileStride: 4,
        supports: (alphabet) => alphabet?.id === "aa",
    },
    taylor: {
        id: 5,
        type: "residueProperty",
        profileStride: 4,
        supports: (alphabet) => alphabet?.id === "aa",
    },
    gecosBlossom: {
        id: 6,
        type: "residueProperty",
        profileStride: 4,
        supports: (alphabet) => alphabet?.id === "aa",
    },
    gecosSunset: {
        id: 7,
        type: "residueProperty",
        profileStride: 4,
        supports: (alphabet) => alphabet?.id === "aa",
    },
    gecosOcean: {
        id: 8,
        type: "residueProperty",
        profileStride: 4,
        supports: (alphabet) => alphabet?.id === "aa",
    },
    helixPropensity: {
        id: 9,
        type: "residueProperty",
        profileStride: 4,
        supports: (alphabet) => alphabet?.id === "aa",
    },
    strandPropensity: {
        id: 10,
        type: "residueProperty",
        profileStride: 4,
        supports: (alphabet) => alphabet?.id === "aa",
    },
    turnPropensity: {
        id: 11,
        type: "residueProperty",
        profileStride: 4,
        supports: (alphabet) => alphabet?.id === "aa",
    },
    buriedIndex: {
        id: 12,
        type: "residueProperty",
        profileStride: 4,
        supports: (alphabet) => alphabet?.id === "aa",
    },
    "3di": {
        id: 13,
        type: "residueProperty",
        profileStride: 4,
        supports: (alphabet) => alphabet?.id === "3di",
    }
};

const DEFAULT_SCHEME_ORDER = [
    "clustalx",
    "pid",
    "blosum62",
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
