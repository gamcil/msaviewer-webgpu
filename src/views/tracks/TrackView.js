import { BaseTrackView } from "./BaseTrackView.js";
import { buildTrackLayerCaches, warmTrackLogoGlyphCaches } from "./trackLayerCaches.js";
import { buildRenderedTrackLayers, renderTrackLayer } from "./trackLayerRenderer.js";
import { normalizeTrackLayers, resolveTrackSourceData, resolveTrackSourceTrackState } from "./trackRuntime.js";

export class TrackView extends BaseTrackView {
    constructor({
        source = null,
        coloring = null,
        valueRange = null,
        layers = [],
        ...options
    }) {
        super({
            ...options,
            valueRange,
        });
        this.source = source;
        this.coloring = coloring;
        this.layers = normalizeTrackLayers(layers);
        this.layerCaches = [];
    }

    setTrackState(trackState) {
        super.setTrackState(trackState);
        const nextData = this.resolveSourceData({
            activeRepresentationId: "active",
            activeTrackState: trackState,
            getRepresentation: () => null,
        });
        if (nextData !== undefined) {
            this.setData(nextData);
        }
    }

    setTrackContext(trackContext) {
        this.trackContext = trackContext;
        super.setTrackState(resolveTrackSourceTrackState(this.source, trackContext));
        const nextData = this.resolveSourceData(trackContext);
        if (nextData !== undefined) {
            this.setData(nextData);
        }
    }

    setData(data) {
        super.setData(data);
        this.rebuildLayerCaches();
    }

    setTheme(theme) {
        super.setTheme(theme);
        this.rebuildLayerCaches();
    }

    setLayers(layers) {
        this.layers = normalizeTrackLayers(layers);
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

    resolveSourceData(trackContext = this.trackContext) {
        return resolveTrackSourceData(this.source, trackContext);
    }

    rebuildLayerCaches() {
        this.layerCaches = buildTrackLayerCaches({
            source: this.source,
            coloring: this.coloring,
            trackContext: this.trackContext,
            data: this.data,
            layers: this.layers,
            theme: this.theme,
            normalizeValue: (value) => this.normalizeValue(value),
        });
        warmTrackLogoGlyphCaches({
            source: this.source,
            layers: this.layers,
            layerCaches: this.layerCaches,
        });
    }

    renderCachedWindow(context, renderContext) {
        const renderedLayers = buildRenderedTrackLayers({
            source: this.source,
            data: this.data,
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
            renderTrackLayer(context, layer);
        }
    }
}
