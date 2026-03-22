import { BaseTrackView } from "./BaseTrackView.js";
import { getTrackRenderGeometry, renderLine } from "./renderers/trackRenderers.js";


export class LineTrackView extends BaseTrackView {
    setTrackState(trackState) {
        super.setTrackState(trackState);
        const nextData = trackState?.metrics?.[this.id] ?? null;
        this.setData(nextData);
    }

    render() {
        this.clear();
        if (!this.data || !this.viewport || !this.context) return;

        const { colStart, colEnd } = this.viewport;
        const { dpr, cellWidthPx, localScrollLeftPx } = getTrackRenderGeometry(this.viewport);
        const heightPx = this.canvas.height;
        const radius = 5;
        const points = [];
        for (let i = colStart; i < colEnd; i += 1) {
            const x = (i - colStart) * cellWidthPx + (cellWidthPx / 2) - localScrollLeftPx;
            const y = heightPx - (heightPx * this.data[i]);
            points.push({ score: this.data[i], x, y });
        }
        renderLine(this.context, {
            points,
            canvasHeight: heightPx,
            strokeStyle: "rgb(0, 122, 178)",
            fillStyle: "rgba(89, 211, 255, 0.25)",
            lineWidth: Math.max(1, Math.round(dpr)),
            showPoints: true,
            pointRadius: radius,
            skipZeroPoints: true,
        });
    }
}
