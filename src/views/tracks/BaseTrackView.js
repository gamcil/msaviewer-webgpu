/*
Base class for sequence score tracks
*/

import { CachedVisibleWindowCanvas } from "../helpers/CachedVisibleWindowCanvas.js";
import { SizedCanvas2D } from "../helpers/SizedCanvas2D.js";

export class BaseTrackView {
    constructor({
        root,
        height,
        id,
        label,
        sublabel = null,
        valueRange = null,
        tooltip = null,
    }) {
        this.root = root;
        this.id = id;
        this.height = height;
        this.label = label;
        this.sublabel = sublabel;
        this.tooltip = tooltip;
        this.valueRange = valueRange ? {
            min: valueRange.min ?? 0,
            max: valueRange.max ?? 1,
        } : null;

        this.viewport = null;
        this.data = null;
        this.trackState = null;
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
                viewport,
            }) => this.renderCachedWindow(context, {
                visibleStart,
                visibleEnd,
                cellWidthPx,
                localScrollLeftPx: 0,
                dpr,
                heightPx,
                columnVisibility: viewport?.columnVisibility ?? null,
            }),
        });
        
        this.root.classList.add("msa-track-row");

        this.labelEl = document.createElement("div");
        this.labelEl.className = "msa-track-label";

        this.labelTextEl = document.createElement("div");
        this.labelTextEl.className = "msa-track-label-text";
        this.labelTextEl.textContent = label;
        this.labelEl.appendChild(this.labelTextEl);

        this.sublabelEl = document.createElement("div");
        this.sublabelEl.className = "msa-track-sublabel";
        this.labelEl.appendChild(this.sublabelEl);
        this.setSublabel(sublabel);

        this.bodyEl = document.createElement("div");
        this.bodyEl.className = "msa-track-body";
        
        this.canvas = document.createElement("canvas");
        this.canvas.className = "msa-track-canvas";
        
        this.bodyEl.appendChild(this.canvas);
        this.root.appendChild(this.labelEl);
        this.root.appendChild(this.bodyEl);

        this.context = this.canvas.getContext("2d");
        this.root.style.height = `${this.height}px`;
        this.bodyEl.style.height = `${this.height}px`;
        this.bodyEl.style.width = "100%";
        this.sizedCanvas = new SizedCanvas2D({
            root: this.bodyEl,
            canvas: this.canvas,
            getCssHeight: () => this.height,
        });
    }

    setViewport(viewport) {
        this.viewport = viewport;
        this.sizedCanvas.markDirty();
    }

    setData(data) {
        this.data = data;
        this.invalidateRenderCache();
    }

    setTrackState(trackState) {
        this.trackState = trackState;
    }

    setTheme(theme) {
        this.theme = theme;
        this.invalidateRenderCache();
    }

    setSublabel(sublabel) {
        this.sublabel = sublabel;
        const text = sublabel == null ? "" : String(sublabel);
        const hasSublabel = text.trim().length > 0;
        this.sublabelEl.textContent = hasSublabel ? text : "";
        if (hasSublabel) {
            this.sublabelEl.hidden = false;
            this.sublabelEl.removeAttribute("hidden");
        } else {
            this.sublabelEl.hidden = true;
        }
    }

    formatTooltipValue(value) {
        if (!Number.isFinite(value)) {
            return null;
        }
        if (Number.isInteger(value)) {
            return String(value);
        }
        if (Math.abs(value) >= 10) {
            return value.toFixed(1);
        }
        return value.toFixed(3).replace(/\.?0+$/, "");
    }

    getTooltipData(rawColumn, context = {}) {
        const value = this.data?.[rawColumn];
        if (this.tooltip) {
            return this.tooltip({
                rawColumn,
                value,
                track: this,
                trackState: this.trackState,
                ...context,
            });
        }
        if (!Number.isFinite(value)) {
            return null;
        }
        return {
            title: this.label,
            subtitle: this.sublabel,
            lines: [
                `Column: ${rawColumn + 1}`,
                `Value: ${this.formatTooltipValue(value)}`,
            ],
        };
    }

    normalizeValue(value) {
        if (!Number.isFinite(value)) {
            return 0;
        }
        if (!this.valueRange) {
            return value;
        }
        const min = this.valueRange.min ?? 0;
        const max = this.valueRange.max ?? 1;
        if (max <= min) {
            return 0;
        }
        const t = (value - min) / (max - min);
        return Math.max(0, Math.min(1, t));
    }

    invalidateRenderCache() {
        this.prerenderWindow.invalidate();
    }

    getRenderCacheOverscanCols(visibleColCount) {
        return Math.max(32, visibleColCount);
    }

    getRenderCacheKey({ dpr, cellWidthPx, heightPx }) {
        return [
            dpr,
            cellWidthPx,
            heightPx,
            this.viewport?.totalCols ?? 0,
            this.viewport?.columnVisibility?.signature ?? "unmasked",
        ].join("|");
    }

    renderCachedWindow() {
        // overwrite in subclasses
    }

    render() {
        this.sizedCanvas.ensureSize();
        this.sizedCanvas.clear(this.context);
        if (!this.viewport || !this.context) return;
        const totalCols = this.viewport.totalCols ?? 0;
        if (totalCols <= 0) return;
        const dpr = window.devicePixelRatio || 1;
        const cellWidthPx = Math.max(1, Math.round(this.viewport.cellWidth * dpr));
        const localScrollLeft = this.viewport.scrollLeft - this.viewport.colStart * this.viewport.cellWidth;
        const localScrollLeftPx = Math.round(localScrollLeft * dpr);
        const heightPx = this.canvas.height;
        this.prerenderWindow.drawTo(this.context, {
            dpr,
            cellWidthPx,
            heightPx,
            localScrollLeftPx,
        });
    }
    
    destroy() {
        this.sizedCanvas.destroy();
        this.prerenderWindow.invalidate();
        this.root.replaceChildren();
    }
}
