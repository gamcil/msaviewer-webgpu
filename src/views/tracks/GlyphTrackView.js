import { BaseTrackView } from "./BaseTrackView.js";
import { renderGlyphs } from "../renderers/trackRenderers.js";
import { buildVisibleGlyphs } from "../models/glyphRenderModel.js";

export class GlyphTrackView extends BaseTrackView {
    renderCachedWindow(context, {
        visibleStart,
        visibleEnd,
        cellWidthPx,
        localScrollLeftPx,
        dpr,
        heightPx,
        columnVisibility,
    }) {
        if (!this.data) return;
        const glyphs = buildVisibleGlyphs(this.data, {
            visibleStart,
            visibleEnd,
            columnVisibility,
        });
        renderGlyphs(context, {
            glyphs,
            cellWidthPx,
            localScrollLeftPx,
            canvasHeight: heightPx,
            font: `${14 * dpr}px "IBM Plex Mono", monospace`,
            fillStyle: "#333",
            textAlign: "center",
            textBaseline: "bottom",
        });
    }
}
