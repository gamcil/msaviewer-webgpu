const ACTIVE = "active";

function buildConsensusTooltip({ rawColumn, track }) {
    const columnData = track.data?.columns?.[rawColumn];
    if (!columnData) return null;
    const lines = [`Column: ${rawColumn + 1}`];
    if (columnData.consensusGlyph) {
        lines.push(`Consensus: ${columnData.consensusGlyph}`);
    }
    const residueLines = (columnData.letters ?? [])
        .map((letter) => ({
            glyph: letter.glyph,
            percent: Math.round((letter.logoFraction ?? 0) * 100),
        }))
        .filter((letter) => Number.isFinite(letter.percent) && letter.percent > 0)
        .map((letter) => `${letter.glyph} ${letter.percent}%`);
    return {
        title: track.label,
        subtitle: track.sublabel,
        lines: residueLines.length > 0 ? [...lines, ...residueLines] : lines,
    };
}

function buildConservationGlyph({ value }) {
    if (value === 11) return { glyph: "*" };
    if (value === 10) return { glyph: "+" };
    return { glyph: value };
}

function decodeConservationMask(mask) {
    const propertyNames = [
        "hydrophobic",
        "polar",
        "small",
        "proline",
        "tiny",
        "aliphatic",
        "aromatic",
        "positive",
        "negative",
        "charged",
    ];
    const positive = [];
    const negative = [];
    const maskValue = Number(mask) >>> 0;
    for (let i = 0; i < propertyNames.length; i += 1) {
        if (maskValue & (1 << i)) {
            positive.push(propertyNames[i]);
        }
        if (maskValue & (1 << (10 + i))) {
            negative.push(`!${propertyNames[i]}`);
        }
    }
    return {
        positive,
        negative,
        isIdentity: Boolean(maskValue & (1 << 20)),
        isFullyConserved: Boolean(maskValue & (1 << 21)),
    };
}

function buildConservationTooltip({ rawColumn, value, trackState }) {
    if (!Number.isFinite(value)) {
        return null;
    }
    const conservationMask = trackState?.metrics?.conservationMask?.[rawColumn] ?? 0;
    const decoded = decodeConservationMask(conservationMask);
    const lines = [
        `Column: ${rawColumn + 1}`,
        `Score: ${value}`,
    ];
    if (decoded.isIdentity) {
        lines.push("* identity");
    } else if (decoded.isFullyConserved) {
        lines.push("+ fully conserved");
    }
    lines.push(...decoded.positive);
    lines.push(...decoded.negative);
    return {
        title: "Conservation",
        lines,
    };
}

export const BUILT_IN_TRACK_DEFINITIONS = {
    consensus: {
        id: "consensus",
        label: "Consensus",
        supports: {
            alphabets: null,
            shared: false,
        },
        source: {
            type: "consensus",
            representation: ACTIVE,
        },
        coloring: {
            representation: ACTIVE,
            alphabet: null,
            scheme: null,
        },
        lanes: [
            {
                layers: [
                    {
                        type: "bar",
                        height: 60,
                        includeGaps: true,
                        colors: {
                            light: {
                                fillStyle: "rgba(50, 50, 50, 1)",
                                strokeStyle: null,
                            },
                            dark: {
                                fillStyle: "rgba(255, 255, 255, 0.22)",
                                strokeStyle: null,
                            },
                        },
                        style: { lineWidth: null },
                    },
                    {
                        type: "logo",
                        height: 60,
                        includeGaps: true,
                        style: {
                            logoHeightMode: "histogram",
                            capGlyphHeight: true,
                            maxGlyphHeightRatio: 0.8,
                            minGlyphPixelHeight: 1,
                            minLogoCellWidth: 10,
                            logoMaxScaleX: 1.25,
                        },
                    },
                ],
            },
            {
                layers: [
                    {
                        type: "glyph",
                        show: true,
                        colors: {
                            light: { fillStyle: "#333" },
                            dark: { fillStyle: "#e6e6e6" },
                        },
                        style: { fontSize: 16 },
                    },
                ],
            },
        ],
        tooltip: buildConsensusTooltip,
    },
    quality: {
        id: "quality",
        label: "Quality",
        supports: {
            alphabets: null,
            shared: false,
        },
        source: {
            type: "metric",
            metric: "quality",
            representation: ACTIVE,
        },
        coloring: {
            representation: ACTIVE,
            alphabet: null,
            scheme: null,
        },
        lanes: [
            {
                layers: [{
                    type: "bar",
                    height: 60,
                    style: { strokeStyle: "#063306" },
                    colorRamps: {
                        fill: {
                            minScore: 0,
                            maxScore: 1,
                            minColor: "#063306",
                            maxColor: "#77ca8f",
                        },
                    },
                }],
            },
        ],
    },
    conservation: {
        id: "conservation",
        label: "Conservation",
        supports: {
            alphabets: ["aa"],
            shared: false,
        },
        source: {
            type: "metric",
            metric: "conservationScore",
            representation: ACTIVE,
        },
        coloring: {
            representation: ACTIVE,
            alphabet: null,
            scheme: null,
        },
        valueRange: { min: 0, max: 11 },
        lanes: [
            {
                layers: [
                    {
                        type: "bar",
                        height: 60,
                        style: { strokeStyle: "#080947" },
                        colorRamps: {
                            fill: { minScore: 0, maxScore: 11, minColor: "#080947", maxColor: "#87a7f3" },
                        },
                    },
                ],
            },
            {
                layers: [
                    {
                        type: "glyph",
                        style: { showGlyphs: true, fontSize: 16 },
                        colorRamps: {
                            glyph: { minScore: 0, maxScore: 11, minColor: "#080947", maxColor: "#87a7f3" },
                        },
                        getGlyph: buildConservationGlyph,
                    },
                ],
            },
        ],
        tooltip: buildConservationTooltip,
    },
    occupancy: {
        id: "occupancy",
        label: "Occupancy",
        supports: {
            alphabets: null,
            shared: true,
        },
        source: {
            type: "metric",
            metric: "occupancy",
            representation: ACTIVE,
        },
        coloring: {
            representation: ACTIVE,
            alphabet: null,
            scheme: null,
        },
        lanes: [
            {
                layers: [{
                    type: "bar",
                    height: 60,
                    style: { strokeStyle: "#3e2709" },
                    colorRamps: {
                        fill: {
                            minScore: 0,
                            maxScore: 1,
                            minColor: "#3e2709",
                            maxColor: "#d4b080",
                        },
                    },
                }],
            },
        ],
    },
};
