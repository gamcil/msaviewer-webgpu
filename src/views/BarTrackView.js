import { BaseTrackView } from "./BaseTrackView.js";
import { getTrackRenderGeometry, renderBars } from "./renderers/trackRenderers.js";


export class BarTrackView extends BaseTrackView {
    render() {
        this.clear();
        if (!this.data || !this.viewport || !this.context) return;

        const { colStart, colEnd } = this.viewport;
        const { dpr, cellWidthPx, localScrollLeftPx } = getTrackRenderGeometry(this.viewport);
        const bars = [];
        for (let i = colStart; i < colEnd; i += 1) {
            bars.push({ column: i - colStart, fraction: this.data[i] });
        }
        renderBars(this.context, {
            bars,
            cellWidthPx,
            localScrollLeftPx,
            canvasHeight: this.canvas.height,
            fillStyle: "rgba(89, 211, 255, 0.25)",
            strokeStyle: "rgb(0, 122, 178)",
            lineWidth: Math.max(1, Math.round(dpr)),
        });
    }
}
