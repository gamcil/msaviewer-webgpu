/**
 * @import { TrackDefinition } from "./trackDefinitionSchema.js"
 */

const ACTIVE_REPRESENTATION = "active";

function createActiveSource(type, extra = {}) {
    return {
        representation: ACTIVE_REPRESENTATION,
        type,
        ...extra,
    };
}

function createActiveColoring(extra = {}) {
    return {
        representation: ACTIVE_REPRESENTATION,
        alphabet: null,
        scheme: null,
        ...extra,
    };
}

/**
 * @param {{ buildConservationTooltip: Function }} params
 * @returns {Record<string, TrackDefinition>}
 */
export function createBuiltInTrackDefinitions({ buildConservationTooltip }) {
    return {
        consensus: {
            id: "consensus",
            label: "Consensus",
            source: createActiveSource("consensus"),
            coloring: createActiveColoring(),
            options: {
                height: 80,
                layers: [
                    {
                        type: "bar",
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
                        includeGaps: true,
                        style: {
                            logoHeightMode: "histogram",
                            capGlyphHeight: true,
                            maxGlyphHeightRatio: 0.8,
                            minGlyphPixelHeight: 1,
                            minLogoCellWidth: 10,
                            logoFont: `bold 100px "IBM Plex Mono", monospace`,
                            logoMaxScaleX: 1.25,
                        },
                    },
                    {
                        type: "glyph",
                        show: true,
                        colors: {
                            light: { fillStyle: "#333" },
                            dark: { fillStyle: "#e6e6e6" },
                        },
                        style: { fontSize: 14 },
                    },
                ],
                tooltip: ({ rawColumn, track }) => {
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
                },
            },
        },
        quality: {
            id: "quality",
            label: "Quality",
            source: createActiveSource("metric", { metric: "quality" }),
            coloring: createActiveColoring(),
            options: {
                height: 60,
                layers: [{
                    type: "bar",
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
        },
        conservation: {
            id: "conservation",
            label: "Conservation",
            source: createActiveSource("metric", { metric: "conservationScore" }),
            coloring: createActiveColoring(),
            options: {
                valueRange: { min: 0, max: 11 },
                height: 80,
                layers: [
                    {
                        type: "bar",
                        style: { strokeStyle: "#080947" },
                        colorRamps: {
                            fill: { minScore: 0, maxScore: 11, minColor: "#080947", maxColor: "#87a7f3" },
                        },
                    },
                    {
                        type: "glyph",
                        style: { showGlyphs: true },
                        colorRamps: {
                            glyph: { minScore: 0, maxScore: 11, minColor: "#080947", maxColor: "#87a7f3" },
                        },
                        getGlyph: ({ value }) => {
                            if (value === 11) return { glyph: "*" };
                            if (value === 10) return { glyph: "+" };
                            return { glyph: value };
                        },
                    },
                ],
                tooltip: (context) => buildConservationTooltip(context),
            },
        },
        occupancy: {
            id: "occupancy",
            label: "Occupancy",
            source: createActiveSource("metric", { metric: "occupancy" }),
            coloring: createActiveColoring(),
            options: {
                height: 60,
                layers: [{
                    type: "bar",
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
        },
    };
}
