export function createColorRamp(overrides = {}) {
    return {
        minScore: 0,
        maxScore: 1,
        minColor: null,
        maxColor: null,
        target: "fill",
        ...overrides,
    };
}

export function createBarTrackStyle(overrides = {}) {
    return {
        fillStyle: "rgba(89, 211, 255, 0.25)",
        strokeStyle: "rgb(0, 122, 178)",
        lineWidth: null,
        ...overrides,
    };
}

export function createGlyphTrackStyle(overrides = {}) {
    return {
        showGlyphs: false,
        fillStyle: null,
        fontSize: 14,
        minCellWidth: 10,
        ...overrides,
    };
}

export function createLineTrackStyle(overrides = {}) {
    return {
        strokeStyle: "rgb(0, 122, 178)",
        fillStyle: "rgba(89, 211, 255, 0.25)",
        lineWidth: null,
        showPoints: true,
        pointRadius: 5,
        pointFillStyle: null,
        pointStrokeStyle: null,
        pointLineWidth: null,
        skipZeroPoints: true,
        ...overrides,
    };
}

export function createConsensusTrackStyle(overrides = {}) {
    return {
        histogram: {
            fillStyle: "rgba(50, 50, 50, 1)",
            strokeStyle: null,
            lineWidth: null,
            ...(overrides.histogram ?? {}),
        },
        consensus: {
            fillStyle: "#333",
            fontSize: 14,
            ...(overrides.consensus ?? {}),
        },
        logo: {
            showLogo: true,
            logoHeightMode: "histogram",
            capGlyphHeight: true,
            maxGlyphHeightRatio: 0.8,
            minGlyphPixelHeight: 1,
            minLogoCellWidth: 10,
            logoFont: `bold 100px "IBM Plex Mono", monospace`,
            logoMaxScaleX: 1.25,
            ...(overrides.logo ?? {}),
        },
    };
}
