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

export class ConsensusTrackView extends BaseTrackView {
    constructor({
        root,
        height,
        id,
        label,
        includeGaps = true,
        showHistogram = true,
        showConsensus = true,
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
                histogramFillStyle: "rgba(50, 50, 50, 1)",
                consensusFillStyle: "#333",
                ...(themeColors.light ?? {}),
            },
            dark: {
                histogramFillStyle: "rgba(255, 255, 255, 0.22)",
                consensusFillStyle: "#e6e6e6",
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
        this.render();
    }

    setTrackState(trackState) {
        super.setTrackState(trackState);
        this.setData(trackState?.consensus ?? null);
    }

    setData(data) {
        this.data = data;
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
        if (!this.data?.columns || !this.viewport || !this.context) return;

        const { colStart, colEnd } = this.viewport;
        const { dpr, cellWidthPx, localScrollLeftPx } = getTrackRenderGeometry(this.viewport);
        this.updateRenderStyles(dpr);

        const heightPx = this.canvas.height;
        const consensusFontPx = this.consensusFontPx;
        const consensusLanePx = this.showConsensus ? consensusFontPx + Math.max(2, Math.round(4 * dpr)) : 0;
        const plotHeightPx = Math.max(1, heightPx - consensusLanePx);
        const columns = this.data.columns.slice(colStart, colEnd);
        const { histogramFillStyle, consensusFillStyle } = this.getResolvedColors();

        if (this.showHistogram) {
            const bars = columns.map((columnData, index) => ({
                column: index,
                fraction: this.includeGaps
                    ? columnData.modalFractionNonGap * columnData.occupancy
                    : columnData.modalFractionNonGap,
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
                const modalFraction = this.includeGaps
                    ? columnData.modalFractionNonGap * columnData.occupancy
                    : columnData.modalFractionNonGap;
                let stackHeightPx = plotHeightPx * modalFraction;
                if (this.logoConfig.logoHeightMode === "full") {
                    stackHeightPx = plotHeightPx;
                } else if (this.logoConfig.logoHeightMode === "information") {
                    const informationContent = this.includeGaps
                        ? columnData.informationContentRaw * columnData.occupancy
                        : columnData.informationContentRaw;
                    stackHeightPx = plotHeightPx * informationContent;
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
