import { BLOSUM62 } from "../graphics/data/blosum62.js";

const symbols = [
    "A", "R", "N", "D", "C",
    "Q", "E", "G", "H", "I",
    "L", "K", "M", "F", "P",
    "S", "T", "W", "Y", "V",
    "-",
];

const logoColors = [
    "#33a02c", "#1f78b4", "#1f78b4", "#e31a1c", "#ff7f00",
    "#1f78b4", "#e31a1c", "#ff7f00", "#6a3d9a", "#33a02c",
    "#33a02c", "#1f78b4", "#33a02c", "#33a02c", "#ff7f00",
    "#ff7f00", "#ff7f00", "#33a02c", "#33a02c", "#33a02c",
    "#999999",
];

export const aminoAcidAlphabet = {
    id: "aa",
    label: "Amino acids",
    symbols,
    logoColors,
    coreSize: 20,
    bucketStride: 21,
    gapBucketIndex: 20,
    unknownBucketIndex: 20,
    supports: {
        quality: true,
        consensus: true,
        logo: true,
    },
    qualityMatrix: BLOSUM62,
    metricConfig: {
        coreSize: 20,
        bucketStride: 21,
        gapBucketIndex: 20,
        qualityMatrixSize: 25,
        residueToIndexCasesWgsl: `
        case 65u: { return 0u; }  // A
        case 82u: { return 1u; }  // R
        case 78u: { return 2u; }  // N
        case 68u: { return 3u; }  // D
        case 67u: { return 4u; }  // C
        case 81u: { return 5u; }  // Q
        case 69u: { return 6u; }  // E
        case 71u: { return 7u; }  // G
        case 72u: { return 8u; }  // H
        case 73u: { return 9u; }  // I
        case 76u: { return 10u; } // L
        case 75u: { return 11u; } // K
        case 77u: { return 12u; } // M
        case 70u: { return 13u; } // F
        case 80u: { return 14u; } // P
        case 83u: { return 15u; } // S
        case 84u: { return 16u; } // T
        case 87u: { return 17u; } // W
        case 89u: { return 18u; } // Y
        case 86u: { return 19u; } // V`,
    },
    renderConfig: {
        qualityIndexCasesWgsl: `
        case 65u: { return 0u; }   // A
        case 82u: { return 1u; }   // R
        case 78u: { return 2u; }   // N
        case 68u: { return 3u; }   // D
        case 67u: { return 4u; }   // C
        case 81u: { return 5u; }   // Q
        case 69u: { return 6u; }   // E
        case 71u: { return 7u; }   // G
        case 72u: { return 8u; }   // H
        case 73u: { return 9u; }   // I
        case 76u: { return 10u; }  // L
        case 75u: { return 11u; }  // K
        case 77u: { return 12u; }  // M
        case 70u: { return 13u; }  // F
        case 80u: { return 14u; }  // P
        case 83u: { return 15u; }  // S
        case 84u: { return 16u; }  // T
        case 87u: { return 17u; }  // W
        case 89u: { return 18u; }  // Y
        case 86u: { return 19u; }  // V
        case 66u: { return 20u; }  // B
        case 74u: { return 21u; }  // J
        case 90u: { return 22u; }  // Z
        case 88u: { return 23u; }  // X`,
        qualityDefaultIndex: 24,
        qualityMatrixSize: 25,
    },
};
