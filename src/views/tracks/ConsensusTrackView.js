/*
* Jalview-style consensus track with histogram and sequence logo.
*/

import { BaseTrackView } from "./BaseTrackView.js";
import { renderBars, renderGlyphs, renderSequenceLogo, warmSequenceLogoGlyphCache } from "../renderers/trackRenderers.js";
import { createConsensusTrackStyle } from "../trackStyles.js";
import {
    buildConsensusGlyphs,
    buildConsensusHistogramBars,
    buildConsensusLogoColumns,
    buildConsensusRenderColumns,
    buildVisibleConsensusColumns,
    collectConsensusLogoGlyphPairs,
    resolveConsensusPalette,
} from "../models/consensusRenderModel.js";

export class ConsensusTrackView extends BaseTrackView {
    constructor({
        root,
        height,
        id,
        label,
        sublabel = null,
        includeGaps = true,
        showHistogram = true,
        showConsensus = true,
        darkMode = false,
        themeColors = {},
        logoConfig = {},
        histogramStyle = {},
        consensusStyle = {},
        style = {},
    }) {
        super({ root, height, id, label, sublabel });
        this.includeGaps = includeGaps;
        this.showHistogram = showHistogram;
        this.showConsensus = showConsensus;
        this.darkMode = darkMode;
        const normalizedStyle = createConsensusTrackStyle({
            histogram: {
                fillStyle: themeColors.light?.histogramFillStyle,
                strokeStyle: themeColors.light?.histogramStrokeStyle,
                ...histogramStyle,
            },
            consensus: {
                fillStyle: themeColors.light?.consensusFillStyle,
                ...consensusStyle,
            },
            logo: logoConfig,
            ...style,
        });
        this.style = normalizedStyle;
        this.darkStyle = createConsensusTrackStyle({
            histogram: {
                fillStyle: "rgba(255, 255, 255, 0.22)",
                strokeStyle: null,
                lineWidth: normalizedStyle.histogram.lineWidth,
                ...(themeColors.dark ?? {}),
                ...style.histogram,
            },
            consensus: {
                fillStyle: "#e6e6e6",
                fontSize: normalizedStyle.consensus.fontSize,
                ...(themeColors.dark ? { fillStyle: themeColors.dark.consensusFillStyle ?? "#e6e6e6" } : {}),
                ...style.consensus,
            },
            logo: {
                ...normalizedStyle.logo,
                ...style.logo,
            },
        });
        this.lightStyle = createConsensusTrackStyle({
            histogram: {
                fillStyle: "rgba(50, 50, 50, 1)",
                strokeStyle: null,
                lineWidth: normalizedStyle.histogram.lineWidth,
                ...(themeColors.light ?? {}),
                ...style.histogram,
            },
            consensus: {
                fillStyle: "#333",
                fontSize: normalizedStyle.consensus.fontSize,
                ...(themeColors.light ? { fillStyle: themeColors.light.consensusFillStyle ?? "#333" } : {}),
                ...style.consensus,
            },
            logo: {
                ...normalizedStyle.logo,
                ...style.logo,
            },
        });
        this.colors = {
            light: {
                histogramFillStyle: this.lightStyle.histogram.fillStyle,
                histogramStrokeStyle: this.lightStyle.histogram.strokeStyle,
                consensusFillStyle: this.lightStyle.consensus.fillStyle,
            },
            dark: {
                histogramFillStyle: this.darkStyle.histogram.fillStyle,
                histogramStrokeStyle: this.darkStyle.histogram.strokeStyle,
                consensusFillStyle: this.darkStyle.consensus.fillStyle,
            },
        };
        this.logoConfig = normalizedStyle.logo;
        this.renderColumns = null;
        this.dataRevision = 0;
        this.styleRevision = 0;
        this.themeRevision = 0;
    }

    refreshRendering({ warmLogo = true, rerender = true } = {}) {
        if (warmLogo) {
            this.warmLogoGlyphCache();
        }
        this.invalidateRenderCache();
        if (rerender) {
            this.render();
        }
    }

    setTheme({ darkMode }) {
        if (darkMode == null || darkMode === this.darkMode) return;
        this.darkMode = darkMode;
        this.themeRevision += 1;
        this.refreshRendering();
    }

    setOptions(options = {}) {
        let styleChanged = false;
        if (options.includeGaps != null) this.includeGaps = options.includeGaps;
        if (options.showHistogram != null) this.showHistogram = options.showHistogram;
        if (options.showConsensus != null) this.showConsensus = options.showConsensus;
        if (options.darkMode != null && options.darkMode !== this.darkMode) {
            this.darkMode = options.darkMode;
            this.themeRevision += 1;
        }
        if (
            options.histogramFillStyle !== undefined ||
            options.histogramStrokeStyle !== undefined ||
            options.consensusFillStyle !== undefined
        ) {
            this.colors = {
                light: {
                    ...this.colors.light,
                    ...(options.histogramFillStyle !== undefined ? { histogramFillStyle: options.histogramFillStyle } : {}),
                    ...(options.histogramStrokeStyle !== undefined ? { histogramStrokeStyle: options.histogramStrokeStyle } : {}),
                    ...(options.consensusFillStyle !== undefined ? { consensusFillStyle: options.consensusFillStyle } : {}),
                },
                dark: {
                    ...this.colors.dark,
                    ...(options.histogramFillStyle !== undefined ? { histogramFillStyle: options.histogramFillStyle } : {}),
                    ...(options.histogramStrokeStyle !== undefined ? { histogramStrokeStyle: options.histogramStrokeStyle } : {}),
                    ...(options.consensusFillStyle !== undefined ? { consensusFillStyle: options.consensusFillStyle } : {}),
                },
            };
            styleChanged = true;
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
            styleChanged = true;
        }
        if (options.style != null) {
            this.style = createConsensusTrackStyle({
                ...this.style,
                ...options.style,
            });
            styleChanged = true;
        }
        if (options.logoConfig != null) {
            this.logoConfig = {
                ...this.logoConfig,
                ...options.logoConfig,
            };
            styleChanged = true;
        }
        if (options.histogramStyle != null) {
            this.style = createConsensusTrackStyle({
                ...this.style,
                histogram: {
                    ...this.style.histogram,
                    ...options.histogramStyle,
                },
            });
            styleChanged = true;
        }
        if (options.consensusStyle != null) {
            this.style = createConsensusTrackStyle({
                ...this.style,
                consensus: {
                    ...this.style.consensus,
                    ...options.consensusStyle,
                },
            });
            styleChanged = true;
        }
        if (styleChanged) {
            this.styleRevision += 1;
        }
        this.refreshRendering();
    }

    setTrackState(trackState) {
        super.setTrackState(trackState);
        this.setData(trackState?.consensus ?? null);
    }

    setData(data) {
        this.data = data;
        this.rebuildRenderColumns();
        this.render();
    }

    rebuildRenderColumns() {
        const sourceColumns = this.data?.columns;
        if (!sourceColumns?.length) {
            this.renderColumns = null;
            this.refreshRendering({ warmLogo: false, rerender: false });
            return;
        }
        this.renderColumns = buildConsensusRenderColumns(sourceColumns);
        this.dataRevision += 1;
        this.refreshRendering({ rerender: false });
    }

    warmLogoGlyphCache() {
        if (!this.renderColumns?.length || !this.logoConfig?.showLogo) {
            return;
        }
        const glyphColorPairs = collectConsensusLogoGlyphPairs(this.renderColumns);
        warmSequenceLogoGlyphCache(this.logoConfig.logoFont, glyphColorPairs);
    }

    getTooltipData(rawColumn) {
        const columnData = this.data?.columns?.[rawColumn];
        if (!columnData) {
            return null;
        }

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
            title: this.label,
            subtitle: this.sublabel,
            lines: residueLines.length > 0 ? [...lines, ...residueLines] : lines,
        };
    }

    updateRenderStyles(dpr) {
        if (this.renderStyleDpr === dpr) return;
        this.renderStyleDpr = dpr;
        const baseConsensusFontPx = this.style.consensus.fontSize ?? 14;
        this.consensusFontPx = Math.max(10, Math.round(baseConsensusFontPx * dpr));
        this.consensusFont = `${this.consensusFontPx}px "IBM Plex Mono", monospace`;
        this.trackLineWidth = Math.max(1, Math.round(dpr));
    }

    getRenderCacheKey({ dpr, cellWidthPx, heightPx }) {
        return [
            super.getRenderCacheKey({ dpr, cellWidthPx, heightPx }),
            this.includeGaps,
            this.showHistogram,
            this.showConsensus,
            this.dataRevision,
            this.styleRevision,
            this.themeRevision,
        ].join("|");
    }

    renderCachedWindow(context, {
        visibleStart,
        visibleEnd,
        cellWidthPx,
        localScrollLeftPx,
        dpr,
        heightPx,
        columnVisibility,
    }) {
        if (!this.renderColumns) {
            return;
        }
        this.updateRenderStyles(dpr);
        const columns = buildVisibleConsensusColumns(this.renderColumns, visibleStart, visibleEnd, columnVisibility);
        if (!columns.length) {
            return;
        }
        const consensusFontPx = this.consensusFontPx;
        const consensusLanePx = this.showConsensus ? consensusFontPx + Math.max(2, Math.round(4 * dpr)) : 0;
        const plotHeightPx = Math.max(1, heightPx - consensusLanePx);
        const { histogramFillStyle, histogramStrokeStyle, consensusFillStyle } = resolveConsensusPalette(this.darkMode, this.colors);
        const histogramLineWidth = this.style.histogram.lineWidth ?? this.trackLineWidth;

        if (this.showHistogram) {
            const bars = buildConsensusHistogramBars(columns, {
                includeGaps: this.includeGaps,
                plotHeightPx,
            });
            renderBars(context, {
                bars,
                cellWidthPx,
                localScrollLeftPx,
                canvasHeight: plotHeightPx,
                fillStyle: histogramFillStyle,
                strokeStyle: histogramStrokeStyle,
                lineWidth: histogramLineWidth,
            });
        }

        if (this.logoConfig.showLogo && cellWidthPx >= this.logoConfig.minLogoCellWidth) {
            const logoColumns = buildConsensusLogoColumns(columns, {
                includeGaps: this.includeGaps,
                plotHeightPx,
                logoHeightMode: this.logoConfig.logoHeightMode,
            });
            renderSequenceLogo(context, {
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
            const glyphs = buildConsensusGlyphs(columns, {
                consensusFillStyle,
                heightPx,
            });
            renderGlyphs(context, {
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
