import { BaseTrackView } from "./BaseTrackView.js";
import { getTrackRenderGeometry, renderLine, resolveInterpolatedColor } from "./renderers/trackRenderers.js";
import { createColorRamp, createLineTrackStyle } from "./trackStyles.js";


export class LineTrackView extends BaseTrackView {
    constructor({
        root,
        height,
        id,
        label,
        sublabel = null,
        metric = null,
        valueRange = null,
        style = {},
        colorRamp = null,
    }) {
        super({ root, height, id, label, sublabel, metric, valueRange });
        this.style = createLineTrackStyle(style);
        this.colorRamp = colorRamp ? createColorRamp(colorRamp) : null;
    }

    setOptions({ style, colorRamp, valueRange } = {}) {
        if (style) {
            this.style = createLineTrackStyle({
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
        if (colorRamp !== undefined) {
            this.colorRamp = colorRamp ? createColorRamp({
                ...this.colorRamp,
                ...colorRamp,
            }) : null;
        }
    }

    setTrackState(trackState) {
        super.setTrackState(trackState);
        const nextData = this.getMetricData(trackState);
        this.setData(nextData);
    }

    render() {
        this.clear();
        if (!this.data || !this.viewport || !this.context) return;

        const { colStart, colEnd } = this.viewport;
        const visibleRawColumns = this.viewport.visibleRawColumns ?? null;
        const { dpr, cellWidthPx, localScrollLeftPx } = getTrackRenderGeometry(this.viewport);
        const heightPx = this.canvas.height;
        const lineWidth = this.style.lineWidth ?? Math.max(1, Math.round(dpr));
        const pointRadius = this.style.pointRadius;
        const points = [];
        for (let i = 0; i < (colEnd - colStart); i += 1) {
            const rawCol = visibleRawColumns?.[i] ?? (colStart + i);
            const score = this.data[rawCol] ?? 0;
            const fraction = this.normalizeValue(score);
            const x = i * cellWidthPx + (cellWidthPx / 2) - localScrollLeftPx;
            const y = heightPx - (heightPx * fraction);
            const interpolatedColor = this.colorRamp
                ? resolveInterpolatedColor(score, this.colorRamp)
                : null;
            const target = this.colorRamp?.target ?? "points";
            points.push({
                score,
                x,
                y,
                pointFillStyle: target === "points"
                    ? (interpolatedColor ?? this.style.pointFillStyle ?? this.style.fillStyle)
                    : this.style.pointFillStyle,
                pointStrokeStyle: target === "points"
                    ? (interpolatedColor ?? this.style.pointStrokeStyle ?? this.style.strokeStyle)
                    : this.style.pointStrokeStyle,
                pointLineWidth: this.style.pointLineWidth ?? lineWidth,
            });
        }
        renderLine(this.context, {
            points,
            canvasHeight: heightPx,
            strokeStyle: this.style.strokeStyle,
            fillStyle: this.style.fillStyle,
            lineWidth,
            showPoints: this.style.showPoints,
            pointRadius,
            skipZeroPoints: this.style.skipZeroPoints,
        });
    }
}
