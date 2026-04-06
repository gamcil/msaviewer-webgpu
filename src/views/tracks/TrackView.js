import { BaseTrackView } from "./BaseTrackView.js";
import { buildTrackLayerCaches, warmTrackLogoGlyphCaches } from "./trackLayerCaches.js";
import { buildRenderedTrackLayers, renderTrackLayer } from "./trackLayerRenderer.js";
import { normalizeTrackLayers, resolveTrackSourceData, resolveTrackSourceTrackState } from "./trackRuntime.js";

function flattenTrackLayoutLayers(layout = null) {
    if (!Array.isArray(layout?.lanes)) {
        return [];
    }
    return layout.lanes.flatMap((lane, laneIndex) =>
        (lane.layers ?? []).map((layer) => ({
            ...layer,
            laneIndex,
        }))
    );
}

export class TrackView extends BaseTrackView {
    constructor({
        layout = null,
        source = null,
        coloring = null,
        valueRange = null,
        ...options
    }) {
        super({
            ...options,
            height: layout?.totalHeight ?? options.height,
            valueRange,
        });
        this.layout = layout;
        this.source = source;
        this.coloring = coloring;
        this.layers = normalizeTrackLayers(flattenTrackLayoutLayers(layout));
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
            theme: this.theme,
        });
    }

    renderCachedWindow(context, renderContext) {
        const renderedLayers = buildRenderedTrackLayers({
            source: this.source,
            data: this.data,
            layout: this.layout,
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
}
