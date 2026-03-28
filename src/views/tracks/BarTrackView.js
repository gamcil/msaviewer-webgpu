import { MetricTrackView } from "./MetricTrackView.js";
import { renderBars, renderGlyphs, prepareColorRamp } from "../renderers/trackRenderers.js";
import { createBarTrackStyle, createGlyphTrackStyle } from "../trackStyles.js";
import { buildBarRenderColumns, buildBarVisibleSlice, createBarColorRamps } from "../models/barRenderModel.js";

export class BarTrackView extends MetricTrackView {
    constructor({
        root,
        height,
        id,
        label,
        sublabel = null,
        metric = null,
        valueRange = null,
        tooltip = null,
        style = {},
        colorRamps = null,
        glyph = null,
        glyphStyle = {},
    }) {
        super({ root, height, id, label, sublabel, metric, valueRange, tooltip });
        this.style = createBarTrackStyle(style);
        this.colorRamps = colorRamps ? createBarColorRamps(colorRamps, prepareColorRamp) : { fill: null, stroke: null, glyph: null };
        this.glyph = glyph;
        this.glyphStyle = createGlyphTrackStyle(glyphStyle);
        this.renderStyleDpr = null;
        this.renderColumns = null;
    }

    setOptions({ style, colorRamps, valueRange, glyph, glyphStyle } = {}) {
        if (style) {
            this.style = createBarTrackStyle({
                ...this.style,
                ...style,
            });
        }
        if (valueRange !== undefined) {
            this.setValueRange(valueRange);
        }
        if (colorRamps !== undefined) {
            this.colorRamps = colorRamps ? createBarColorRamps({
                fill: colorRamps.fill ? { ...this.colorRamps?.fill, ...colorRamps.fill } : this.colorRamps?.fill,
                stroke: colorRamps.stroke ? { ...this.colorRamps?.stroke, ...colorRamps.stroke } : this.colorRamps?.stroke,
                glyph: colorRamps.glyph ? { ...this.colorRamps?.glyph, ...colorRamps.glyph } : this.colorRamps?.glyph,
            }, prepareColorRamp) : { fill: null, stroke: null, glyph: null };
        }
        if (glyph !== undefined) {
            this.glyph = glyph;
        }
        if (glyphStyle) {
            this.glyphStyle = createGlyphTrackStyle({
                ...this.glyphStyle,
                ...glyphStyle,
            });
        }
        this.rebuildRenderColumns();
        this.invalidateRenderCache();
    }

    setData(data) {
        super.setData(data);
        this.rebuildRenderColumns();
    }

    setTheme(theme) {
        const prevDarkMode = this.theme?.darkMode;
        super.setTheme(theme);
        if (prevDarkMode !== theme?.darkMode) {
            this.rebuildRenderColumns();
        }
    }

    updateRenderStyles(dpr) {
        if (this.renderStyleDpr === dpr) return;
        this.renderStyleDpr = dpr;
        const baseFontPx = this.glyphStyle.fontSize ?? 14;
        this.glyphFontPx = Math.max(10, Math.round(baseFontPx * dpr));
        this.glyphFont = `${this.glyphFontPx}px "IBM Plex Mono", monospace`;
        this.trackLineWidth = Math.max(1, Math.round(dpr));
    }

    getGlyphSpec(rawColumn, score, fraction) {
        if (!this.glyph) {
            return null;
        }
        return this.glyph({
            rawColumn,
            value: score,
            fraction,
            track: this,
            trackState: this.trackState,
            viewport: this.viewport,
        });
    }

    getResolvedGlyphFillStyle() {
        if (this.glyphStyle.fillStyle != null) {
            return this.glyphStyle.fillStyle;
        }
        return this.theme?.darkMode ? "#e6e6e6" : "#333";
    }

    rebuildRenderColumns() {
        this.renderColumns = buildBarRenderColumns(this.data, {
            normalizeValue: (value) => this.normalizeValue(value),
            colorRamps: this.colorRamps,
            defaultFillStyle: this.style.fillStyle,
            defaultStrokeStyle: this.style.strokeStyle,
            defaultGlyphFillStyle: this.getResolvedGlyphFillStyle(),
        });
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
        if (!this.renderColumns) return;
        this.updateRenderStyles(dpr);
        const showGlyphLane = this.glyphStyle.showGlyphs && cellWidthPx >= this.glyphStyle.minCellWidth;
        const glyphLanePx = showGlyphLane ? this.glyphFontPx + Math.max(2, Math.round(4 * dpr)) : 0;
        const plotHeightPx = Math.max(1, heightPx - glyphLanePx);
        const lineWidth = this.style.lineWidth ?? this.trackLineWidth;
        const { bars, glyphs } = buildBarVisibleSlice(this.renderColumns, {
            visibleStart,
            visibleEnd,
            columnVisibility,
            plotHeightPx,
            lineWidth,
            getGlyphSpec: showGlyphLane
                ? (rawCol, score, fraction) => {
                    const glyphSpec = this.getGlyphSpec(rawCol, score, fraction);
                    return glyphSpec?.glyph
                        ? { ...glyphSpec, y: glyphSpec.y ?? heightPx }
                        : null;
                }
                : null,
        });
        renderBars(context, {
            bars,
            cellWidthPx,
            localScrollLeftPx,
            canvasHeight: plotHeightPx,
            fillStyle: this.style.fillStyle,
            strokeStyle: this.style.strokeStyle,
            lineWidth,
        });
        if (glyphs.length > 0) {
            renderGlyphs(context, {
                glyphs,
                cellWidthPx,
                localScrollLeftPx,
                canvasHeight: heightPx,
                font: this.glyphFont,
                fillStyle: this.getResolvedGlyphFillStyle(),
                textAlign: "center",
                textBaseline: "bottom",
            });
        }
    }
}
