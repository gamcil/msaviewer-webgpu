/*
View for managing a stack of individual tracks
*/
import { TrackTooltipPresenter } from "./helpers/TrackTooltipPresenter.js";

export class TrackStackView {
    constructor({ root = null, labelRoot = null, bodyRoot = null }) {
        this.root = root ?? bodyRoot ?? labelRoot ?? null;
        this.labelRoot = labelRoot ?? this.root;
        this.bodyRoot = bodyRoot ?? this.root;
        this.tracks = [];
        this.trackByBodyRow = new Map();
        this.trackContext = null;
        this.viewport = null;
        this.theme = null;
        this.renderDirty = false;
        this.frameHandle = 0;

        this.tooltipEl = document.createElement("div");
        this.tooltipPortalRoot = this.bodyRoot?.ownerDocument?.body ?? document.body;
        this.tooltipPortalRoot.appendChild(this.tooltipEl);
        this.tooltipPresenter = new TrackTooltipPresenter({ tooltipEl: this.tooltipEl });
        this.tooltipPresenter.applyTheme(this.theme);
        this.bindTooltipEvents();
    }

    addTrackAt(track, index) {
        const insertIndex = Math.max(0, Math.min(index, this.tracks.length));
        this.tracks.splice(insertIndex, 0, track);
        this.trackByBodyRow.set(track.bodyRowEl, track);
        const nextTrack = this.tracks[insertIndex + 1] ?? null;
        this.labelRoot?.insertBefore(track.labelRowEl, nextTrack?.labelRowEl ?? null);
        this.bodyRoot?.insertBefore(track.bodyRowEl, nextTrack?.bodyRowEl ?? null);
        if (this.viewport) {
            track.setViewport(this.viewport);
        }
        if (this.trackContext) {
            track.setTrackContext(this.trackContext);
        }
        if (this.theme) {
            track.setTheme(this.theme);
        }
    }

    hasTrack(trackId) {
        return this.tracks.some((track) => track.id === trackId);
    }

    removeTrack(trackId) {
        const idx = this.tracks.findIndex((track) => track.id === trackId);
        if (idx === -1) return;
        const track = this.tracks[idx];
        this.trackByBodyRow.delete(track.bodyRowEl);
        track.destroy();
        this.tracks.splice(idx, 1);
    }

    setViewport(viewport) {
        this.viewport = viewport;
        for (const track of this.tracks) {
            track.setViewport(viewport);
        }
        this.hideTooltip();
        this.requestRender();
    }

    setTrackContext(trackContext) {
        this.trackContext = trackContext;
        for (const track of this.tracks) {
            track.setTrackContext(trackContext);
        }
        this.requestRender();
    }

    setTheme(theme) {
        this.theme = theme;
        for (const track of this.tracks) {
            track.setTheme(theme);
        }
        this.tooltipPresenter.applyTheme(theme);
        this.requestRender();
    }

    bindTooltipEvents() {
        this.onTooltipPointerMove = (event) => this.handleTooltipPointerMove(event);
        this.onTooltipPointerLeave = () => this.hideTooltip();
        this.bodyRoot.addEventListener("pointermove", this.onTooltipPointerMove);
        this.bodyRoot.addEventListener("pointerleave", this.onTooltipPointerLeave);
    }

    handleTooltipPointerMove(point) {
        const row = point.target instanceof Element
            ? point.target.closest(".msa-track-body-row")
            : null;
        const track = row ? this.trackByBodyRow.get(row) ?? null : null;
        const bodyRect = track?.bodyEl?.getBoundingClientRect?.() ?? null;
        const viewport = this.viewport;
        if (!track || !viewport || !bodyRect) {
            this.hideTooltip();
            return;
        }
        const contentX = point.clientX - bodyRect.left + viewport.scrollLeft;
        const visibleColumn = Math.floor(contentX / viewport.cellWidth);
        if (visibleColumn < 0 || visibleColumn >= viewport.totalCols) {
            this.hideTooltip();
            return;
        }
        const rawColumn = viewport.columnVisibility?.visibleToRaw?.[visibleColumn] ?? visibleColumn;
        const tooltipData = track.getTooltipData(rawColumn, {
            visibleColumn,
            viewport,
            trackState: track.trackState,
        });
        if (!tooltipData) {
            this.hideTooltip();
            return;
        }
        this.tooltipPresenter.show(tooltipData, point);
    }

    hideTooltip() {
        this.tooltipPresenter.hide();
    }

    requestRender() {
        this.renderDirty = true;
        if (this.frameHandle) return;
        this.frameHandle = window.requestAnimationFrame(() => {
            this.frameHandle = 0;
            if (!this.renderDirty) return;
            this.renderDirty = false;
            this.render();
            if (this.renderDirty && !this.frameHandle) {
                this.requestRender();
            }
        });
    }

    render() {
        for (const track of this.tracks) {
            track.render();
        }
    }

    clear() {
        this.hideTooltip();
        if (this.frameHandle) {
            window.cancelAnimationFrame(this.frameHandle);
            this.frameHandle = 0;
        }
        this.renderDirty = false;
        for (const track of this.tracks) {
            track.destroy();
        }
        this.tracks = [];
        this.trackByBodyRow.clear();
        if (this.labelRoot && this.labelRoot !== this.bodyRoot) {
            this.labelRoot.replaceChildren();
        }
        this.bodyRoot.replaceChildren();
    }

    destroy() {
        this.hideTooltip();
        this.clear();
        if (this.onTooltipPointerMove) {
            this.bodyRoot.removeEventListener("pointermove", this.onTooltipPointerMove);
        }
        if (this.onTooltipPointerLeave) {
            this.bodyRoot.removeEventListener("pointerleave", this.onTooltipPointerLeave);
        }
        this.tooltipEl.remove();
    }
}
