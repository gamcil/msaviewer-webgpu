import { CachedVisibleWindowCanvas } from "./helpers/CachedVisibleWindowCanvas.js";
import { SizedCanvas2D } from "./helpers/SizedCanvas2D.js";

export class RulerView {
    constructor({ root, tickInterval = 10, height = 28 }) {
        this.root = root;
        this.tickInterval = Math.max(1, tickInterval);
        this.height = height;
        this.viewport = null;
        this.theme = null;
        this.prerenderWindow = new CachedVisibleWindowCanvas({
            getViewport: () => this.viewport,
            getCacheKey: ({ dpr, cellWidthPx, heightPx }) => this.getRenderCacheKey({ dpr, cellWidthPx, heightPx }),
            getOverscanCols: (visibleColCount) => this.getRenderCacheOverscanCols(visibleColCount),
            renderWindow: (context, {
                visibleStart,
                visibleEnd,
                cellWidthPx,
                heightPx,
                dpr,
            }) => this.renderCachedWindow(context, {
                visibleStart,
                visibleEnd,
                cellWidthPx,
                heightPx,
                dpr,
            }),
        });

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
        this.sizedCanvas = new SizedCanvas2D({
            root: this.root,
            canvas: this.canvas,
            getCssHeight: () => this.height,
        });
    }

    setTickInterval(tickInterval) {
        const nextTickInterval = Math.max(1, tickInterval);
        if (nextTickInterval === this.tickInterval) return;
        this.tickInterval = nextTickInterval;
        this.refreshRendering();
    }

    setTheme(theme) {
        const nextDarkMode = !!theme?.darkMode;
        const prevDarkMode = !!this.theme?.darkMode;
        this.theme = theme;
        if (nextDarkMode !== prevDarkMode) {
            this.invalidateRenderCache();
        }
        this.render();
    }

    setViewport(viewport) {
        this.viewport = viewport;
        this.render();
    }

    invalidateRenderCache() {
        this.prerenderWindow.invalidate();
    }

    refreshRendering() {
        this.invalidateRenderCache();
        this.render();
    }

    getStrokeStyle() {
        return this.theme?.darkMode ? "rgba(255, 255, 255, 0.55)" : "rgba(30, 30, 30, 0.55)";
    }

    getTextStyle() {
        return this.theme?.darkMode ? "#e6e6e6" : "#333";
    }

    getRenderCacheOverscanCols(visibleColCount) {
        return Math.max(32, visibleColCount);
    }

    getRenderCacheKey({ dpr, cellWidthPx, heightPx }) {
        return [
            dpr,
            cellWidthPx,
            heightPx,
            this.tickInterval,
            this.theme?.darkMode ? "dark" : "light",
            this.viewport?.totalCols ?? 0,
            this.viewport?.columnVisibility?.signature ?? "unmasked",
        ].join("|");
    }

    renderCachedWindow(context, {
        visibleStart,
        visibleEnd,
        cellWidthPx,
        heightPx,
        dpr,
    }) {
        const axisY = Math.max(1, heightPx - Math.round(5 * dpr));
        const longTickHeight = Math.max(6, Math.round(7 * dpr));
        const shortTickHeight = Math.max(4, Math.round(4 * dpr));
        const fontSize = Math.max(10, Math.round(11 * dpr));
        const labelTop = Math.max(1, Math.round(1 * dpr));
        const windowWidth = Math.max(1, (visibleEnd - visibleStart) * cellWidthPx);

        context.clearRect(0, 0, windowWidth, heightPx);
        context.strokeStyle = this.getStrokeStyle();
        context.lineWidth = Math.max(1, Math.round(dpr));
        context.beginPath();
        context.moveTo(0, axisY);
        context.lineTo(windowWidth, axisY);
        context.stroke();

        context.fillStyle = this.getTextStyle();
        context.font = `${fontSize}px "IBM Plex Mono", monospace`;
        context.textAlign = "center";
        context.textBaseline = "top";

        for (let visibleCol = visibleStart; visibleCol < visibleEnd; visibleCol += 1) {
            const position = visibleCol + 1;
            if (position % this.tickInterval !== 0) {
                continue;
            }
            const x = ((visibleCol - visibleStart) * cellWidthPx) + (cellWidthPx / 2);
            context.beginPath();
            context.moveTo(x, axisY);
            context.lineTo(x, axisY - longTickHeight);
            context.stroke();
            context.fillText(String(position), x, labelTop);
        }

        const minorStep = Math.max(1, Math.floor(this.tickInterval / 2));
        if (minorStep >= 2) {
            for (let visibleCol = visibleStart; visibleCol < visibleEnd; visibleCol += 1) {
                const position = visibleCol + 1;
                if (position % this.tickInterval === 0 || position % minorStep !== 0) {
                    continue;
                }
                const x = ((visibleCol - visibleStart) * cellWidthPx) + (cellWidthPx / 2);
                context.beginPath();
                context.moveTo(x, axisY);
                context.lineTo(x, axisY - shortTickHeight);
                context.stroke();
            }
        }
    }

    render() {
        if (!this.context) return;
        this.root.style.height = `${this.height}px`;
        const { dpr, width, height } = this.sizedCanvas.ensureSize();
        this.context.clearRect(0, 0, width, height);
        if (!this.viewport) return;

        const cellWidthPx = Math.max(1, Math.round(this.viewport.cellWidth * dpr));
        const localScrollLeft = this.viewport.scrollLeft - this.viewport.colStart * this.viewport.cellWidth;
        const localScrollLeftPx = Math.round(localScrollLeft * dpr);
        this.prerenderWindow.drawTo(this.context, {
            dpr,
            cellWidthPx,
            heightPx: height,
            localScrollLeftPx,
        });
    }

    clear() {
        this.viewport = null;
        this.prerenderWindow.invalidate();
        if (this.context) {
            this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
        }
    }

    destroy() {
        this.sizedCanvas.destroy();
        this.prerenderWindow.invalidate();
        this.root.replaceChildren();
    }
}
