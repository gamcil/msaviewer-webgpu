const symbols = ["A", "C", "G", "T", "-"];

const logoColors = [
    "#33a02c",
    "#1f78b4",
    "#ff7f00",
    "#e31a1c",
    "#999999",
];

export const nucleotideAlphabet = {
    id: "nt",
    label: "Nucleotides",
    shortLabel: "NT",
    symbols,
    logoColors,
    coreSize: 4,
    bucketStride: 5,
    gapBucketIndex: 4,
    unknownBucketIndex: 4,
    supports: {
        quality: false,
        consensus: true,
        logo: true,
    },
    qualityMatrix: null,
    metricConfig: {
        coreSize: 4,
        bucketStride: 5,
        gapBucketIndex: 4,
        qualityMatrixSize: 0,
        residueToIndexCasesWgsl: `
        case 65u: { return 0u; }  // A
        case 67u: { return 1u; }  // C
        case 71u: { return 2u; }  // G
        case 84u: { return 3u; }  // T
        case 85u: { return 3u; }  // U`,
    },
    renderConfig: {
        qualityIndexCasesWgsl: `
        case 65u: { return 0u; }  // A
        case 67u: { return 1u; }  // C
        case 71u: { return 2u; }  // G
        case 84u: { return 3u; }  // T
        case 85u: { return 3u; }  // U`,
        qualityDefaultIndex: 4,
        qualityMatrixSize: 5,
    },
};
