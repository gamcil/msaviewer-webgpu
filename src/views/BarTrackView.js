import { BaseTrackView } from "./BaseTrackView.js";


export class BarTrackView extends BaseTrackView {
    render() {
        this.clear();
        if (!this.data || !this.viewport || !this.context) return;

        const { colStart, colEnd, scrollLeft, cellWidth } = this.viewport;
        const dpr = window.devicePixelRatio || 1;
        const cellWidthPx = Math.max(1, Math.round(cellWidth * dpr));
        const heightPx = this.canvas.height;

        const localScrollLeft = scrollLeft - colStart * cellWidth;
        const localScrollLeftPx = Math.round(localScrollLeft * dpr);

        this.context.strokeStyle = "rgb(0, 122, 178)";
        this.context.fillStyle = "rgba(89, 211, 255, 0.25)"; 
        this.context.lineWidth = Math.max(1, Math.round(dpr));
        this.context.beginPath();
        for (let i = colStart; i < colEnd; i += 1) {
            const x = (i - colStart) * cellWidthPx - localScrollLeftPx;
            const colHeight = heightPx * this.data[i];
            this.context.rect(x, (heightPx - colHeight), cellWidthPx, colHeight);
        }
        this.context.fill();
        this.context.stroke();
    }
}