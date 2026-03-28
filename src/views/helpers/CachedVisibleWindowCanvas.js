export class CachedVisibleWindowCanvas {
    constructor({
        getViewport,
        getCacheKey,
        getOverscanCols,
        renderWindow,
    }) {
        this.getViewport = getViewport;
        this.getCacheKey = getCacheKey;
        this.getOverscanCols = getOverscanCols;
        this.renderWindow = renderWindow;
        this.windowCanvas = null;
        this.windowState = null;
        this.cacheKey = "";
    }

    invalidate() {
        this.windowCanvas = null;
        this.windowState = null;
        this.cacheKey = "";
    }

    ensureWindow({ dpr, cellWidthPx, heightPx }) {
        const viewport = this.getViewport?.();
        if (!viewport) {
            return;
        }
        const visibleColCount = Math.max(1, (viewport.colEnd ?? 0) - (viewport.colStart ?? 0));
        const overscanCols = this.getOverscanCols(visibleColCount);
        const totalCols = viewport.totalCols ?? 0;
        const visibleStart = Math.max(0, (viewport.colStart ?? 0) - overscanCols);
        const visibleEnd = Math.min(totalCols, (viewport.colEnd ?? 0) + overscanCols);
        const nextState = {
            colStart: visibleStart,
            colEnd: visibleEnd,
            cellWidthPx,
            heightPx,
        };
        const prevState = this.windowState;
        const nextCacheKey = this.getCacheKey({ dpr, cellWidthPx, heightPx });
        const canReuse =
            this.windowCanvas &&
            nextCacheKey === this.cacheKey &&
            prevState &&
            viewport.colStart >= prevState.colStart &&
            viewport.colEnd <= prevState.colEnd &&
            prevState.cellWidthPx === cellWidthPx &&
            prevState.heightPx === heightPx;
        if (canReuse) {
            return;
        }

        this.cacheKey = nextCacheKey;
        const windowCanvas = document.createElement("canvas");
        windowCanvas.width = Math.max(1, (visibleEnd - visibleStart) * cellWidthPx);
        windowCanvas.height = heightPx;
        const windowContext = windowCanvas.getContext("2d");
        if (windowContext) {
            windowContext.clearRect(0, 0, windowCanvas.width, windowCanvas.height);
            this.renderWindow(windowContext, {
                visibleStart,
                visibleEnd,
                cellWidthPx,
                heightPx,
                dpr,
                viewport,
            });
        }
        this.windowCanvas = windowCanvas;
        this.windowState = nextState;
    }

    drawTo(targetContext, { dpr, cellWidthPx, heightPx, localScrollLeftPx }) {
        const viewport = this.getViewport?.();
        if (!viewport || !targetContext) {
            return;
        }
        this.ensureWindow({ dpr, cellWidthPx, heightPx });
        if (!this.windowCanvas || !this.windowState) {
            return;
        }
        const drawX = (this.windowState.colStart - viewport.colStart) * cellWidthPx - localScrollLeftPx;
        targetContext.drawImage(this.windowCanvas, drawX, 0);
    }
}
