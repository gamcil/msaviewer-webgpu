/**
 * @import { TrackDefinition } from "./trackDefinitionSchema.js"
 */

const ACTIVE = "active";

/** @type {Record<string, TrackDefinition>} */
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
            tooltip: "consensus",
        },
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
                    getGlyph: "conservationSymbols",
                },
            ],
            tooltip: "conservation",
        },
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
