import { BaseTrackView } from "./BaseTrackView.js";
import {
    getTrackRenderGeometry,
    renderBars,
    renderGlyphs,
    resolveInterpolatedColor,
} from "./renderers/trackRenderers.js";
import { createBarTrackStyle, createColorRamp, createGlyphTrackStyle } from "./trackStyles.js";

function createBarColorRamps(colorRamps = {}) {
    return {
        fill: colorRamps.fill ? createColorRamp(colorRamps.fill) : null,
        stroke: colorRamps.stroke ? createColorRamp(colorRamps.stroke) : null,
        glyph: colorRamps.glyph ? createColorRamp(colorRamps.glyph) : null,
    };
}

export class BarTrackView extends BaseTrackView {
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
        this.colorRamps = colorRamps ? createBarColorRamps(colorRamps) : { fill: null, stroke: null, glyph: null };
        this.glyph = glyph;
        this.glyphStyle = createGlyphTrackStyle(glyphStyle);
        this.renderStyleDpr = null;
    }

    setOptions({ style, colorRamps, valueRange, glyph, glyphStyle } = {}) {
        if (style) {
            this.style = createBarTrackStyle({
                ...this.style,
                ...style,
            });
        }
        if (valueRange !== undefined) {
            this.valueRange = valueRange ? {
                min: valueRange.min ?? 0,
                max: valueRange.max ?? 1,
            } : null;
        }
        if (colorRamps !== undefined) {
            this.colorRamps = colorRamps ? createBarColorRamps({
                fill: colorRamps.fill ? { ...this.colorRamps?.fill, ...colorRamps.fill } : this.colorRamps?.fill,
                stroke: colorRamps.stroke ? { ...this.colorRamps?.stroke, ...colorRamps.stroke } : this.colorRamps?.stroke,
                glyph: colorRamps.glyph ? { ...this.colorRamps?.glyph, ...colorRamps.glyph } : this.colorRamps?.glyph,
            }) : { fill: null, stroke: null, glyph: null };
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
    }

    setTrackState(trackState) {
        super.setTrackState(trackState);
        const nextData = this.getMetricData(trackState);
        this.setData(nextData);
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

    render() {
        this.clear();
        if (!this.data || !this.viewport || !this.context) return;

        const { colStart, colEnd } = this.viewport;
        const visibleRawColumns = this.viewport.visibleRawColumns ?? null;
        const { dpr, cellWidthPx, localScrollLeftPx } = getTrackRenderGeometry(this.viewport);
        this.updateRenderStyles(dpr);
        const heightPx = this.canvas.height;
        const showGlyphLane = this.glyphStyle.showGlyphs && cellWidthPx >= this.glyphStyle.minCellWidth;
        const glyphLanePx = showGlyphLane ? this.glyphFontPx + Math.max(2, Math.round(4 * dpr)) : 0;
        const plotHeightPx = Math.max(1, heightPx - glyphLanePx);
        const bars = [];
        const glyphs = [];
        const lineWidth = this.style.lineWidth ?? this.trackLineWidth;
        for (let i = 0; i < (colEnd - colStart); i += 1) {
            const rawCol = visibleRawColumns?.[i] ?? (colStart + i);
            const score = this.data[rawCol] ?? 0;
            const fraction = this.normalizeValue(score);
            const fillColor = this.colorRamps.fill
                ? resolveInterpolatedColor(score, this.colorRamps.fill)
                : null;
            const strokeColor = this.colorRamps.stroke
                ? resolveInterpolatedColor(score, this.colorRamps.stroke)
                : null;
            bars.push({
                column: i,
                fraction,
                baseY: plotHeightPx,
                plotHeight: plotHeightPx,
                fillStyle: fillColor ?? this.style.fillStyle,
                strokeStyle: strokeColor ?? this.style.strokeStyle,
                lineWidth,
            });

            if (showGlyphLane) {
                const glyphSpec = this.getGlyphSpec(rawCol, score, fraction);
                if (glyphSpec?.glyph) {
                    const glyphColor = this.colorRamps.glyph
                        ? (resolveInterpolatedColor(score, this.colorRamps.glyph) ?? glyphSpec.color ?? this.getResolvedGlyphFillStyle())
                        : (glyphSpec.color ?? this.getResolvedGlyphFillStyle());
                    glyphs.push({
                        column: i,
                        glyph: glyphSpec.glyph,
                        color: glyphColor,
                        y: glyphSpec.y ?? heightPx,
                    });
                }
            }
        }
        renderBars(this.context, {
            bars,
            cellWidthPx,
            localScrollLeftPx,
            canvasHeight: plotHeightPx,
            fillStyle: this.style.fillStyle,
            strokeStyle: this.style.strokeStyle,
            lineWidth,
        });
        if (glyphs.length > 0) {
            renderGlyphs(this.context, {
                glyphs,
                cellWidthPx,
                localScrollLeftPx,
                canvasHeight: this.canvas.height,
                font: this.glyphFont,
                fillStyle: this.getResolvedGlyphFillStyle(),
                textAlign: "center",
                textBaseline: "bottom",
            });
        }
    }
}
