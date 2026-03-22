import { BaseTrackView } from "./BaseTrackView.js";
import { getTrackRenderGeometry, renderGlyphs } from "./renderers/trackRenderers.js";

export class GlyphTrackView extends BaseTrackView {
    render() {
        this.clear();
        if (!this.data || !this.viewport || !this.context) return;

        const { colStart, colEnd } = this.viewport;
        const { dpr, cellWidthPx, localScrollLeftPx } = getTrackRenderGeometry(this.viewport);
        const glyphs = [];
        for (const item of this.data) {
            if (item.col < colStart || item.col >= colEnd) continue;
            glyphs.push({
                column: item.col - colStart,
                glyph: item.glyph,
                color: item.color ?? "#333",
            });
        }
        renderGlyphs(this.context, {
            glyphs,
            cellWidthPx,
            localScrollLeftPx,
            canvasHeight: this.canvas.height,
            font: `${14 * dpr}px "IBM Plex Mono", monospace`,
            fillStyle: "#333",
            textAlign: "center",
            textBaseline: "bottom",
        });
    }
}
