import { CachedVisibleWindowCanvas } from "../helpers/CachedVisibleWindowCanvas.js";
import { SizedCanvas2D } from "../helpers/SizedCanvas2D.js";
import { buildTrackLayerCaches, warmTrackLogoGlyphCaches } from "./trackLayerCaches.js";
import { buildRenderedTrackLayers, renderTrackLayer } from "./trackLayerRenderer.js";
import { normalizeTrackLayers, resolveTrackData, resolveTrackState } from "./trackRuntime.js";

function flattenTrackLayers(lanes = []) {
    if (!Array.isArray(lanes)) {
        return [];
    }
    return lanes.flatMap((lane, laneIndex) =>
        (lane.layers ?? []).map((layer) => ({
            ...layer,
            laneIndex,
        }))
    );
}

export class TrackView {
    constructor({
        id,
        label,
        sublabel = null,
        valueRange = null,
        tooltip = null,
        lanes = [],
        source = null,
        coloring = null,
    }) {
        this.id = id;
        this.height = lanes.reduce((sum, lane) => sum + Math.max(0, lane?.height ?? 0), 0);
        this.label = label;
        this.sublabel = sublabel;
        this.tooltip = tooltip;
        this.valueRange = valueRange ? {
            min: valueRange.min ?? 0,
            max: valueRange.max ?? 1,
        } : null;
        this.lanes = lanes;
        this.source = source;
        this.coloring = coloring;
        this.layers = normalizeTrackLayers(flattenTrackLayers(lanes));
        this.layerCaches = [];

        this.viewport = null;
        this.data = null;
        this.trackState = null;
        this.trackContext = null;
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

        this.labelEl = document.createElement("div");
        this.labelEl.className = "msa-track-label";

        this.labelTextEl = document.createElement("div");
        this.labelTextEl.className = "msa-track-label-text";
        this.labelTextEl.textContent = label;
        this.labelEl.appendChild(this.labelTextEl);

        this.sublabelEl = document.createElement("div");
        this.sublabelEl.className = "msa-track-sublabel";
        this.labelEl.appendChild(this.sublabelEl);

        this.bodyEl = document.createElement("div");
        this.bodyEl.className = "msa-track-body";

        this.labelRowEl = document.createElement("div");
        this.labelRowEl.className = "msa-track-row msa-track-label-row";

        this.bodyRowEl = document.createElement("div");
        this.bodyRowEl.className = "msa-track-row msa-track-body-row";

        this.canvas = document.createElement("canvas");
        this.canvas.className = "msa-track-canvas";

        this.bodyEl.appendChild(this.canvas);
        this.labelRowEl.appendChild(this.labelEl);
        this.bodyRowEl.appendChild(this.bodyEl);

        this.context = this.canvas.getContext("2d");
        this.setSublabel(sublabel);
        this.syncViewHeight();
        this.sizedCanvas = new SizedCanvas2D({
            root: this.bodyEl,
            canvas: this.canvas,
            getCssHeight: () => this.height,
        });
    }

    setViewport(viewport) {
        this.viewport = viewport;
    }

    setTrackContext(trackContext) {
        this.trackContext = trackContext;
        this.trackState = resolveTrackState(this.source, trackContext);
        this.#syncData(trackContext);
    }

    #syncData(trackContext) {
        const nextData = resolveTrackData(this.source, trackContext);
        if (nextData !== undefined) {
            this.setData(nextData, trackContext);
            return;
        }
        this.rebuildLayerCaches(trackContext);
    }

    setData(data, trackContext = this.trackContext) {
        this.data = data;
        this.rebuildLayerCaches(trackContext);
        this.invalidateRenderCache();
    }

    setTheme(theme) {
        this.theme = theme;
        this.rebuildLayerCaches();
        this.invalidateRenderCache();
    }

    setValueRange(valueRange) {
        this.valueRange = valueRange ? {
            min: valueRange.min ?? 0,
            max: valueRange.max ?? 1,
        } : null;
        this.rebuildLayerCaches();
        this.invalidateRenderCache();
    }

    syncViewHeight() {
        this.labelRowEl.style.setProperty("--msa-track-view-height", `${this.height}px`);
        this.bodyRowEl.style.setProperty("--msa-track-view-height", `${this.height}px`);
        this.labelEl.style.setProperty("--msa-track-view-height", `${this.height}px`);
        this.bodyEl.style.setProperty("--msa-track-view-height", `${this.height}px`);
    }

    setSublabel(sublabel) {
        this.sublabel = sublabel;
        const text = sublabel == null ? "" : String(sublabel);
        const hasSublabel = text.trim().length > 0;
        this.sublabelEl.textContent = hasSublabel ? text : "";
        this.sublabelEl.hidden = !hasSublabel;
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

    rebuildLayerCaches(trackContext = this.trackContext) {
        this.layerCaches = buildTrackLayerCaches({
            source: this.source,
            coloring: this.coloring,
            trackContext,
            data: this.data,
            layers: this.layers,
            theme: this.theme,
            normalizeValue: (value) => this.normalizeValue(value),
        });
        warmTrackLogoGlyphCaches({
            source: this.source,
            layers: this.layers,
            layerCaches: this.layerCaches,
            theme: this.theme,
        });
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

    renderCachedWindow(context, renderContext) {
        const renderedLayers = buildRenderedTrackLayers({
            source: this.source,
            data: this.data,
            lanes: this.lanes,
            layers: this.layers,
            layerCaches: this.layerCaches,
            theme: this.theme,
            track: this,
            trackState: this.trackState,
            viewport: this.viewport,
            normalizeValue: (value) => this.normalizeValue(value),
            renderContext,
        });
        for (const layer of renderedLayers) {
            context.save();
            context.translate(0, layer.offsetTopPx ?? 0);
            renderTrackLayer(context, layer);
            context.restore();
        }
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
        this.labelRowEl.remove();
        this.bodyRowEl.remove();
    }
}
