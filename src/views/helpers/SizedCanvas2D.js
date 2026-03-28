export class SizedCanvas2D {
    constructor({
        root,
        canvas,
        getCssHeight,
    }) {
        this.root = root;
        this.canvas = canvas;
        this.getCssHeight = getCssHeight;
        this.cachedCssWidth = 0;
        this.cachedDpr = 0;
        this.sizeDirty = true;
        this.resizeObserver = null;
        this.installResizeObserver();
    }

    installResizeObserver() {
        if (typeof ResizeObserver === "undefined") {
            return;
        }
        this.resizeObserver = new ResizeObserver((entries) => {
            const entry = entries[0];
            const width = entry?.contentRect?.width ?? this.root.clientWidth ?? 0;
            if (width !== this.cachedCssWidth) {
                this.cachedCssWidth = width;
                this.sizeDirty = true;
            }
        });
        this.resizeObserver.observe(this.root);
    }

    markDirty() {
        this.sizeDirty = true;
    }

    ensureSize() {
        const dpr = window.devicePixelRatio || 1;
        const cssWidth = this.cachedCssWidth || this.root.clientWidth || this.root.getBoundingClientRect().width;
        const cssHeight = this.getCssHeight();
        const width = Math.max(1, Math.round(cssWidth * dpr));
        const height = Math.max(1, Math.round(cssHeight * dpr));
        if (
            !this.sizeDirty &&
            this.cachedDpr === dpr &&
            this.canvas.width === width &&
            this.canvas.height === height
        ) {
            return { dpr, width, height };
        }

        this.cachedCssWidth = cssWidth;
        this.cachedDpr = dpr;
        this.sizeDirty = false;
        this.canvas.style.width = `${cssWidth}px`;
        this.canvas.style.height = `${cssHeight}px`;
        if (this.canvas.width !== width || this.canvas.height !== height) {
            this.canvas.width = width;
            this.canvas.height = height;
        }
        return { dpr, width, height };
    }

    clear(context) {
        if (!context) return;
        context.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }

    destroy() {
        this.resizeObserver?.disconnect();
    }
}
