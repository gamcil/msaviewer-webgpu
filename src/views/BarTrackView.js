import { BaseTrackView } from "./BaseTrackView.js";
import { getTrackRenderGeometry, renderBars, resolveInterpolatedColor } from "./renderers/trackRenderers.js";
import { createBarTrackStyle, createColorRamp } from "./trackStyles.js";


export class BarTrackView extends BaseTrackView {
    constructor({
        root,
        height,
        id,
        label,
        style = {},
        colorRamp = null,
    }) {
        super({ root, height, id, label });
        this.style = createBarTrackStyle(style);
        this.colorRamp = colorRamp ? createColorRamp(colorRamp) : null;
    }

    setOptions({ style, colorRamp } = {}) {
        if (style) {
            this.style = createBarTrackStyle({
                ...this.style,
                ...style,
            });
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
        const nextData = trackState?.metrics?.[this.id] ?? null;
        this.setData(nextData);
    }

    render() {
        this.clear();
        if (!this.data || !this.viewport || !this.context) return;

        const { colStart, colEnd } = this.viewport;
        const visibleRawColumns = this.viewport.visibleRawColumns ?? null;
        const { dpr, cellWidthPx, localScrollLeftPx } = getTrackRenderGeometry(this.viewport);
        const bars = [];
        const lineWidth = this.style.lineWidth ?? Math.max(1, Math.round(dpr));
        for (let i = 0; i < (colEnd - colStart); i += 1) {
            const rawCol = visibleRawColumns?.[i] ?? (colStart + i);
            const score = this.data[rawCol] ?? 0;
            const interpolatedColor = this.colorRamp
                ? resolveInterpolatedColor(score, this.colorRamp)
                : null;
            const target = this.colorRamp?.target ?? "fill";
            bars.push({
                column: i,
                fraction: score,
                fillStyle: target === "fill" || target === "both"
                    ? (interpolatedColor ?? this.style.fillStyle)
                    : this.style.fillStyle,
                strokeStyle: target === "stroke" || target === "both"
                    ? (interpolatedColor ?? this.style.strokeStyle)
                    : this.style.strokeStyle,
                lineWidth,
            });
        }
        renderBars(this.context, {
            bars,
            cellWidthPx,
            localScrollLeftPx,
            canvasHeight: this.canvas.height,
            fillStyle: this.style.fillStyle,
            strokeStyle: this.style.strokeStyle,
            lineWidth,
        });
    }
}
