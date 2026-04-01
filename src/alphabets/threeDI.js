import { SYMBOLS_3DI, MATRIX_3DI } from "../graphics/data/3di.js";

const symbols = SYMBOLS_3DI;

const logoColors = [
    "#33a02c", "#1f78b4", "#1f78b4", "#e31a1c", "#33a02c",
    "#ff7f00", "#6a3d9a", "#33a02c", "#1f78b4", "#33a02c",
    "#33a02c", "#1f78b4", "#ff7f00", "#1f78b4", "#1f78b4",
    "#ff7f00", "#ff7f00", "#33a02c", "#33a02c", "#33a02c",
    "#999999",
];

export const threeDIAlphabet = {
    id: "3di",
    label: "3Di",
    shortLabel: "3Di",
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
    qualityMatrix: MATRIX_3DI,
    metricConfig: {
        coreSize: 20,
        bucketStride: 21,
        gapBucketIndex: 20,
        qualityMatrixSize: 21,
        residueToIndexCasesWgsl: `
        case 65u: { return 0u; }  // A
        case 67u: { return 1u; }  // C
        case 68u: { return 2u; }  // D
        case 69u: { return 3u; }  // E
        case 70u: { return 4u; }  // F
        case 71u: { return 5u; }  // G
        case 72u: { return 6u; }  // H
        case 73u: { return 7u; }  // I
        case 75u: { return 8u; }  // K
        case 76u: { return 9u; }  // L
        case 77u: { return 10u; } // M
        case 78u: { return 11u; } // N
        case 80u: { return 12u; } // P
        case 81u: { return 13u; } // Q
        case 82u: { return 14u; } // R
        case 83u: { return 15u; } // S
        case 84u: { return 16u; } // T
        case 86u: { return 17u; } // V
        case 87u: { return 18u; } // W
        case 89u: { return 19u; } // Y`,
    },
    renderConfig: {
        qualityIndexCasesWgsl: `
        case 65u: { return 0u; }  // A
        case 67u: { return 1u; }  // C
        case 68u: { return 2u; }  // D
        case 69u: { return 3u; }  // E
        case 70u: { return 4u; }  // F
        case 71u: { return 5u; }  // G
        case 72u: { return 6u; }  // H
        case 73u: { return 7u; }  // I
        case 75u: { return 8u; }  // K
        case 76u: { return 9u; }  // L
        case 77u: { return 10u; } // M
        case 78u: { return 11u; } // N
        case 80u: { return 12u; } // P
        case 81u: { return 13u; } // Q
        case 82u: { return 14u; } // R
        case 83u: { return 15u; } // S
        case 84u: { return 16u; } // T
        case 86u: { return 17u; } // V
        case 87u: { return 18u; } // W
        case 89u: { return 19u; } // Y
        case 88u: { return 20u; } // X`,
        qualityDefaultIndex: 20,
        qualityMatrixSize: 21,
    },
};
