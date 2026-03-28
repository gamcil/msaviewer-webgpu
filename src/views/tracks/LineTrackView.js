import { MetricTrackView } from "./MetricTrackView.js";
import { renderLine } from "../renderers/trackRenderers.js";
import { createLineTrackStyle } from "../trackStyles.js";
import { buildLinePoints, createPreparedLineColorRamp } from "../models/lineRenderModel.js";

export class LineTrackView extends MetricTrackView {
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
        colorRamp = null,
    }) {
        super({ root, height, id, label, sublabel, metric, valueRange, tooltip });
        this.style = createLineTrackStyle(style);
        this.colorRamp = createPreparedLineColorRamp(colorRamp);
    }

    setOptions({ style, colorRamp, valueRange } = {}) {
        if (style) {
            this.style = createLineTrackStyle({
                ...this.style,
                ...style,
            });
        }
        if (valueRange !== undefined) {
            this.setValueRange(valueRange);
        }
        if (colorRamp !== undefined) {
            this.colorRamp = colorRamp ? createPreparedLineColorRamp({
                ...this.colorRamp,
                ...colorRamp,
            }) : null;
        }
        this.invalidateRenderCache();
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
        if (!this.data) return;
        const lineWidth = this.style.lineWidth ?? Math.max(1, Math.round(dpr));
        const pointRadius = this.style.pointRadius;
        const points = buildLinePoints(this.data, {
            visibleStart,
            visibleEnd,
            columnVisibility,
            normalizeValue: (value) => this.normalizeValue(value),
            cellWidthPx,
            localScrollLeftPx,
            heightPx,
            colorRamp: this.colorRamp,
            style: this.style,
            lineWidth,
        });
        renderLine(context, {
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
