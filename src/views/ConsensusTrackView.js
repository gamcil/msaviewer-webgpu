/*
* Jalview-style consensus track with histogram and sequence logo.
*/

import { BaseTrackView } from "./BaseTrackView.js";
import {
    getTrackRenderGeometry,
    renderBars,
    renderGlyphs,
    renderSequenceLogo,
} from "./renderers/trackRenderers.js";

const AA_SYMBOLS = [
    "A", "R", "N", "D", "C",
    "Q", "E", "G", "H", "I",
    "L", "K", "M", "F", "P",
    "S", "T", "W", "Y", "V",
    "-",
];

const AA_LOGO_COLORS = [
    "#33a02c", "#1f78b4", "#1f78b4", "#e31a1c", "#ff7f00",
    "#1f78b4", "#e31a1c", "#ff7f00", "#6a3d9a", "#33a02c",
    "#33a02c", "#1f78b4", "#33a02c", "#33a02c", "#ff7f00",
    "#ff7f00", "#ff7f00", "#33a02c", "#33a02c", "#33a02c",
    "#999999",
];

export class ConsensusTrackView extends BaseTrackView {
    constructor({
        root,
        height,
        id,
        label,
        includeGaps = true,
        showHistogram = true,
        showConsensus = true,
        histogramFillStyle,
        consensusFillStyle,
        darkMode = false,
        themeColors = {},
        logoConfig = {},
    }) {
        super({ root, height, id, label });
        this.includeGaps = includeGaps;
        this.showHistogram = showHistogram;
        this.showConsensus = showConsensus;
        this.darkMode = darkMode;
        this.colors = {
            light: {
                histogramFillStyle: histogramFillStyle ?? "rgba(50, 50, 50, 1)",
                consensusFillStyle: consensusFillStyle ?? "#333",
                ...(themeColors.light ?? {}),
            },
            dark: {
                histogramFillStyle: histogramFillStyle ?? "rgba(255, 255, 255, 0.22)",
                consensusFillStyle: consensusFillStyle ?? "#e6e6e6",
                ...(themeColors.dark ?? {}),
            },
        };
        this.logoConfig = {
            showLogo: true,
            logoHeightMode: "histogram",
            capGlyphHeight: true,
            maxGlyphHeightRatio: 0.8,
            minGlyphPixelHeight: 1,
            minLogoCellWidth: 10,
            logoFont: `bold 100px "IBM Plex Mono", monospace`,
            logoMaxScaleX: 1.25,
            ...logoConfig,
        };
        this.precomputedColumns = null;
    }

    setTheme({ darkMode }) {
        if (darkMode == null || darkMode === this.darkMode) return;
        this.darkMode = darkMode;
        this.render();
    }

    getResolvedColors() {
        const palette = this.darkMode ? this.colors.dark : this.colors.light;
        return {
            histogramFillStyle: palette.histogramFillStyle,
            consensusFillStyle: palette.consensusFillStyle,
        };
    }

    setOptions(options = {}) {
        const previousIncludeGaps = this.includeGaps;
        if (options.includeGaps != null) this.includeGaps = options.includeGaps;
        if (options.showHistogram != null) this.showHistogram = options.showHistogram;
        if (options.showConsensus != null) this.showConsensus = options.showConsensus;
        if (options.darkMode != null) this.darkMode = options.darkMode;
        if (options.histogramFillStyle !== undefined || options.consensusFillStyle !== undefined) {
            this.colors = {
                light: {
                    ...this.colors.light,
                    ...(options.histogramFillStyle !== undefined ? { histogramFillStyle: options.histogramFillStyle } : {}),
                    ...(options.consensusFillStyle !== undefined ? { consensusFillStyle: options.consensusFillStyle } : {}),
                },
                dark: {
                    ...this.colors.dark,
                    ...(options.histogramFillStyle !== undefined ? { histogramFillStyle: options.histogramFillStyle } : {}),
                    ...(options.consensusFillStyle !== undefined ? { consensusFillStyle: options.consensusFillStyle } : {}),
                },
            };
        }
        if (options.themeColors != null) {
            this.colors = {
                ...this.colors,
                ...(options.themeColors.light
                    ? { light: { ...this.colors.light, ...options.themeColors.light } }
                    : {}),
                ...(options.themeColors.dark
                    ? { dark: { ...this.colors.dark, ...options.themeColors.dark } }
                    : {}),
            };
        }
        if (options.logoConfig != null) {
            this.logoConfig = {
                ...this.logoConfig,
                ...options.logoConfig,
            };
        }
        if (this.data && previousIncludeGaps !== this.includeGaps) {
            this.setData(this.data);
            return;
        }
        this.render();
    }

    setData(data) {
        this.data = data;
        if (!data?.counts || !Number.isFinite(data?.numSequences)) {
            this.precomputedColumns = null;
            this.render();
            return;
        }

        const alphabetSize = 20;
        const bucketStride = 21;
        const gapBucketIndex = 20;
        const numColumns = Math.floor(data.counts.length / bucketStride);
        const maxEntropy = Math.log2(alphabetSize);

        this.precomputedColumns = new Array(numColumns);
        for (let col = 0; col < numColumns; col += 1) {
            const colOffset = col * bucketStride;
            const gapCount = data.counts[colOffset + gapBucketIndex];
            const nonGapCount = data.numSequences - gapCount;
            const nonZeroCounts = [];
            let maxCount = 0;

            for (let i = 0; i < alphabetSize; i += 1) {
                const count = data.counts[colOffset + i];
                if (count > 0) {
                    nonZeroCounts.push({ index: i, count });
                }
                maxCount = Math.max(maxCount, count);
            }

            const histogramDenominator = this.includeGaps ? data.numSequences : nonGapCount;
            nonZeroCounts.sort((a, b) => b.count - a.count);
            const modalFraction = histogramDenominator > 0 ? maxCount / histogramDenominator : 0;
            const topCount = nonZeroCounts[0]?.count ?? 0;
            const tiedTop = nonZeroCounts.length > 1 && nonZeroCounts[1].count === topCount;
            let entropy = 0;
            for (const { count } of nonZeroCounts) {
                const p = nonGapCount > 0 ? count / nonGapCount : 0;
                if (p > 0) {
                    entropy -= p * Math.log2(p);
                }
            }
            const rawInformationContent = nonGapCount > 0
                ? Math.max(0, (maxEntropy - entropy) / maxEntropy)
                : 0;
            const occupancy = data.numSequences > 0 ? nonGapCount / data.numSequences : 0;
            const informationContent = this.includeGaps
                ? rawInformationContent * occupancy
                : rawInformationContent;

            this.precomputedColumns[col] = {
                modalFraction,
                informationContent,
                nonGapCount,
                consensusGlyph: nonZeroCounts.length === 0
                    ? null
                    : (tiedTop ? "+" : AA_SYMBOLS[nonZeroCounts[0].index]),
                letters: nonZeroCounts.map(({ index, count }) => ({
                    glyph: AA_SYMBOLS[index],
                    color: AA_LOGO_COLORS[index],
                    logoFraction: nonGapCount > 0 ? count / nonGapCount : 0,
                })),
            };
        }

        this.render();
    }

    updateRenderStyles(dpr) {
        if (this.renderStyleDpr === dpr) return;
        this.renderStyleDpr = dpr;
        this.consensusFontPx = Math.max(10, Math.round(14 * dpr));
        this.consensusFont = `${this.consensusFontPx}px "IBM Plex Mono", monospace`;
        this.trackLineWidth = Math.max(1, Math.round(dpr));
    }

    render() {
        this.clear();
        if (!this.data || !this.viewport || !this.context || !this.precomputedColumns) return;
        

        const { colStart, colEnd } = this.viewport;
        const { dpr, cellWidthPx, localScrollLeftPx } = getTrackRenderGeometry(this.viewport);
        this.updateRenderStyles(dpr);

        const heightPx = this.canvas.height;
        const consensusFontPx = this.consensusFontPx;
        const consensusLanePx = this.showConsensus ? consensusFontPx + Math.max(2, Math.round(4 * dpr)) : 0;
        const plotHeightPx = Math.max(1, heightPx - consensusLanePx);
        const columns = this.precomputedColumns.slice(colStart, colEnd);
        const { histogramFillStyle, consensusFillStyle } = this.getResolvedColors();

        if (this.showHistogram) {
            const bars = columns.map((columnData, index) => ({
                column: index,
                fraction: columnData.modalFraction,
                baseY: plotHeightPx,
                plotHeight: plotHeightPx,
            }));
            renderBars(this.context, {
                bars,
                cellWidthPx,
                localScrollLeftPx,
                canvasHeight: plotHeightPx,
                fillStyle: histogramFillStyle,
                lineWidth: this.trackLineWidth,
            });
        }

        if (this.logoConfig.showLogo && cellWidthPx >= this.logoConfig.minLogoCellWidth) {
            const logoColumns = columns.map((columnData, index) => {
                let stackHeightPx = plotHeightPx * columnData.modalFraction;
                if (this.logoConfig.logoHeightMode === "full") {
                    stackHeightPx = plotHeightPx;
                } else if (this.logoConfig.logoHeightMode === "information") {
                    stackHeightPx = plotHeightPx * columnData.informationContent;
                }
                const letters = columnData.letters.map((letter) => ({
                    glyph: letter.glyph,
                    color: letter.color,
                    heightPx: stackHeightPx * letter.logoFraction,
                }));
                return { column: index, stackHeightPx, letters };
            });
            renderSequenceLogo(this.context, {
                columns: logoColumns,
                cellWidthPx,
                localScrollLeftPx,
                plotHeightPx,
                font: this.logoConfig.logoFont,
                maxScaleX: this.logoConfig.logoMaxScaleX,
                capGlyphHeight: this.logoConfig.capGlyphHeight,
                maxGlyphHeightRatio: this.logoConfig.maxGlyphHeightRatio,
                minGlyphPixelHeight: this.logoConfig.minGlyphPixelHeight,
            });
        }

        if (this.showConsensus) {
            const glyphs = [];
            for (let i = 0; i < columns.length; i += 1) {
                const consensusGlyph = columns[i].consensusGlyph;
                if (!consensusGlyph) continue;
                glyphs.push({
                    column: i,
                    glyph: consensusGlyph,
                    color: consensusFillStyle,
                    y: heightPx,
                });
            }
            renderGlyphs(this.context, {
                glyphs,
                cellWidthPx,
                localScrollLeftPx,
                canvasHeight: heightPx,
                font: this.consensusFont,
                fillStyle: consensusFillStyle,
                textAlign: "center",
                textBaseline: "bottom",
            });
        }
    }
}
