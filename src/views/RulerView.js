export class RulerView {
    constructor({ root, tickInterval = 10, height = 28 }) {
        this.root = root;
        this.tickInterval = tickInterval;
        this.height = height;
        this.viewport = null;
        this.theme = null;

        this.canvas = document.createElement("canvas");
        this.root.appendChild(this.canvas);

        Object.assign(this.root.style, {
            position: "relative",
            overflow: "hidden",
            minWidth: "0",
            height: `${this.height}px`,
        });
        Object.assign(this.canvas.style, {
            display: "block",
            width: "100%",
            height: `${this.height}px`,
        });

        this.context = this.canvas.getContext("2d");
    }

    setTickInterval(tickInterval) {
        this.tickInterval = Math.max(1, tickInterval);
        this.render();
    }

    setTheme(theme) {
        this.theme = theme;
        this.render();
    }

    setViewport(viewport) {
        this.viewport = viewport;
        this.render();
    }

    ensureCanvasSize() {
        const dpr = window.devicePixelRatio || 1;
        const cssWidth = this.root.getBoundingClientRect().width;
        this.canvas.style.height = `${this.height}px`;
        const width = Math.max(1, Math.round(cssWidth * dpr));
        const height = Math.max(1, Math.round(this.height * dpr));
        if (this.canvas.width !== width || this.canvas.height !== height) {
            this.canvas.width = width;
            this.canvas.height = height;
        }
        return { dpr, width, height };
    }

    getStrokeStyle() {
        return this.theme?.darkMode ? "rgba(255, 255, 255, 0.55)" : "rgba(30, 30, 30, 0.55)";
    }

    getTextStyle() {
        return this.theme?.darkMode ? "#e6e6e6" : "#333";
    }

    render() {
        if (!this.context) return;
        const { dpr, width, height } = this.ensureCanvasSize();
        this.context.clearRect(0, 0, width, height);
        if (!this.viewport) return;

        const {
            scrollLeft,
            cellWidth,
            colStart,
            colEnd,
            visibleRawColumns,
        } = this.viewport;

        const cellWidthPx = Math.max(1, cellWidth * dpr);
        const scrollLeftPx = scrollLeft * dpr;
        const columnOffsetPx = scrollLeftPx - (colStart * cellWidthPx);
        const axisY = Math.max(1, height - Math.round(5 * dpr));
        const longTickHeight = Math.max(6, Math.round(7 * dpr));
        const shortTickHeight = Math.max(4, Math.round(4 * dpr));
        const fontSize = Math.max(10, Math.round(11 * dpr));
        const labelTop = Math.max(1, Math.round(1 * dpr));

        this.context.strokeStyle = this.getStrokeStyle();
        this.context.lineWidth = Math.max(1, Math.round(dpr));
        this.context.beginPath();
        this.context.moveTo(0, axisY);
        this.context.lineTo(width, axisY);
        this.context.stroke();

        this.context.fillStyle = this.getTextStyle();
        this.context.font = `${fontSize}px "IBM Plex Mono", monospace`;
        this.context.textAlign = "center";
        this.context.textBaseline = "top";

        for (let i = 0; i < (colEnd - colStart); i += 1) {
            const position = colStart + i + 1;
            if (position % this.tickInterval !== 0) {
                continue;
            }
            const x = (i * cellWidthPx) - columnOffsetPx + (cellWidthPx / 2);
            this.context.beginPath();
            this.context.moveTo(x, axisY);
            this.context.lineTo(x, axisY - longTickHeight);
            this.context.stroke();
            this.context.fillText(String(position), x, labelTop);
        }

        const minorStep = Math.max(1, Math.floor(this.tickInterval / 2));
        if (minorStep >= 2) {
            for (let i = 0; i < (colEnd - colStart); i += 1) {
                const position = colStart + i + 1;
                if (position % this.tickInterval === 0 || position % minorStep !== 0) {
                    continue;
                }
                const x = (i * cellWidthPx) - columnOffsetPx + (cellWidthPx / 2);
                this.context.beginPath();
                this.context.moveTo(x, axisY);
                this.context.lineTo(x, axisY - shortTickHeight);
                this.context.stroke();
            }
        }
    }

    clear() {
        this.viewport = null;
        if (this.context) {
            this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
        }
    }
}
