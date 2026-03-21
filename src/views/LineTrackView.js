import { BaseTrackView } from "./BaseTrackView.js";


export class LineTrackView extends BaseTrackView {
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
        
        const radius = 5;
        const points = [];
        for (let i = colStart; i < colEnd; i += 1) {
            const x = (i - colStart) * cellWidthPx + (cellWidthPx / 2) - localScrollLeftPx;
            const y = heightPx - (heightPx * this.data[i]);
            points.push({ score: this.data[i], x, y });
        }

        // Area
        this.context.beginPath();
        this.context.moveTo(points[0].x, heightPx);
        for (const { x, y } of points) {
            this.context.lineTo(x, y);
        }
        this.context.lineTo(points[points.length - 1].x, heightPx);
        this.context.closePath();
        this.context.fill();

        // Line
        this.context.beginPath();
        this.context.moveTo(points[0].x, points[0].y);
        for (const { x, y } of points) {
            this.context.lineTo(x, y);
        }
        this.context.stroke();
        
        // Points
        for (const { score, x, y } of points) {
            if (score === 0) continue;
            this.context.beginPath();
            this.context.arc(x, y, radius, 0, Math.PI * 2, false);
            this.context.fill();
            this.context.stroke();
        }
    }
}