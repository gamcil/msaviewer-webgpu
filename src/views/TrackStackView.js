/*
View for managing a stack of individual tracks
*/
import {
    getHoveredTrack,
    getRawColumnFromVisibleColumn,
    getVisibleColumnFromPointerEvent,
} from "./models/trackTooltipModel.js";
import { TrackTooltipPresenter } from "./helpers/TrackTooltipPresenter.js";

export class TrackStackView {
    constructor({ root }) {
        this.root = root;
        this.root.style.position = this.root.style.position || "relative";
        this.tracks = [];
        this.trackState = null;
        this.trackContext = null;
        this.viewport = null;
        this.theme = null;
        this.renderDirty = false;
        this.frameHandle = 0;

        this.tooltipOverlay = document.createElement("div");
        this.tooltipOverlay.style.position = "absolute";
        this.tooltipOverlay.style.left = "0";
        this.tooltipOverlay.style.top = "0";
        this.tooltipOverlay.style.width = "0";
        this.tooltipOverlay.style.height = "0";
        this.tooltipOverlay.style.zIndex = "10";
        this.tooltipOverlay.style.pointerEvents = "none";
        this.tooltipOverlay.style.background = "transparent";

        this.tooltipHitbox = document.createElement("div");
        this.tooltipHitbox.style.position = "absolute";
        this.tooltipHitbox.style.inset = "0";
        this.tooltipHitbox.style.pointerEvents = "auto";
        this.tooltipHitbox.style.background = "transparent";

        this.tooltipEl = document.createElement("div");

        this.tooltipOverlay.appendChild(this.tooltipHitbox);
        this.tooltipOverlay.appendChild(this.tooltipEl);
        this.root.appendChild(this.tooltipOverlay);
        this.tooltipPresenter = new TrackTooltipPresenter({ tooltipEl: this.tooltipEl });
        this.tooltipPresenter.applyTheme(this.theme);
        this.bindTooltipEvents();
    }

    addTrack(track) {
        this.addTrackAt(track, this.tracks.length);
    }

    addTrackAt(track, index) {
        const insertIndex = Math.max(0, Math.min(index, this.tracks.length));
        this.tracks.splice(insertIndex, 0, track);
        const nextTrack = this.tracks[insertIndex + 1] ?? null;
        this.root.insertBefore(track.root, nextTrack?.root ?? this.tooltipOverlay);
        if (this.viewport) {
            track.setViewport(this.viewport);
        }
        if (this.trackState) {
            track.setTrackState?.(this.trackState);
        }
        if (this.trackContext) {
            track.setTrackContext?.(this.trackContext);
        }
        if (this.theme) {
            track.setTheme?.(this.theme);
        }
        this.updateTooltipBounds();
    }

    hasTrack(trackId) {
        return this.tracks.some((track) => track.id === trackId);
    }

    getTrack(trackId) {
        return this.tracks.find((track) => track.id === trackId) ?? null;
    }

    removeTrack(trackId) {
        const idx = this.tracks.findIndex((track) => track.id === trackId);
        if (idx === -1) return;
        const track = this.tracks[idx];
        track.destroy();
        track.root.remove();
        this.tracks.splice(idx, 1);
        this.updateTooltipBounds();
    }

    setViewport(viewport) {
        this.viewport = viewport;
        for (const track of this.tracks) {
            track.setViewport?.(viewport);
        }
        this.hideTooltip();
        this.requestRender();
    }

    setTrackState(trackState) {
        this.trackState = trackState;
        for (const track of this.tracks) {
            track.setTrackState?.(trackState);
        }
        this.updateTooltipBounds();
        this.requestRender();
    }

    setTrackContext(trackContext) {
        this.trackContext = trackContext;
        this.trackState = trackContext?.activeTrackState ?? null;
        for (const track of this.tracks) {
            if (track.setTrackContext) {
                track.setTrackContext(trackContext);
            } else {
                track.setTrackState?.(this.trackState);
            }
        }
        this.updateTooltipBounds();
        this.requestRender();
    }

    setTheme(theme) {
        this.theme = theme;
        for (const track of this.tracks) {
            track.setTheme?.(theme);
        }
        this.tooltipPresenter.applyTheme(theme);
        this.requestRender();
    }

    bindTooltipEvents() {
        this.onTooltipPointerMove = (event) => this.handleTooltipPointerMove(event);
        this.onTooltipPointerLeave = () => this.hideTooltip();
        this.tooltipHitbox.addEventListener("pointermove", this.onTooltipPointerMove);
        this.tooltipHitbox.addEventListener("pointerleave", this.onTooltipPointerLeave);
    }

    updateTooltipBounds() {
        if (this.tracks.length === 0) {
            this.tooltipOverlay.style.width = "0";
            this.tooltipOverlay.style.height = "0";
            return;
        }

        const rootRect = this.root.getBoundingClientRect();
        let left = Infinity;
        let top = Infinity;
        let right = -Infinity;
        let bottom = -Infinity;

        for (const track of this.tracks) {
            const bodyRect = track.bodyEl.getBoundingClientRect();
            left = Math.min(left, bodyRect.left - rootRect.left);
            top = Math.min(top, bodyRect.top - rootRect.top);
            right = Math.max(right, bodyRect.right - rootRect.left);
            bottom = Math.max(bottom, bodyRect.bottom - rootRect.top);
        }

        if (!Number.isFinite(left) || !Number.isFinite(top)) {
            return;
        }

        this.tooltipOverlay.style.left = `${Math.max(0, left)}px`;
        this.tooltipOverlay.style.top = `${Math.max(0, top)}px`;
        this.tooltipOverlay.style.width = `${Math.max(0, right - left)}px`;
        this.tooltipOverlay.style.height = `${Math.max(0, bottom - top)}px`;
    }

    handleTooltipPointerMove(event) {
        const track = getHoveredTrack(this.tracks, event.clientY);
        const overlayBounds = this.tooltipOverlay.getBoundingClientRect();
        const visibleColumn = getVisibleColumnFromPointerEvent(event, overlayBounds, this.viewport);
        const rawColumn = getRawColumnFromVisibleColumn(visibleColumn, this.viewport?.columnVisibility);
        if (!track || visibleColumn == null || rawColumn == null) {
            this.hideTooltip();
            return;
        }
        const tooltipData = track.getTooltipData?.(rawColumn, {
            visibleColumn,
            viewport: this.viewport,
            trackState: track.trackState ?? this.trackState,
        });
        if (!tooltipData) {
            this.hideTooltip();
            return;
        }
        this.showTooltip(tooltipData, event);
    }

    showTooltip(data, event) {
        this.tooltipPresenter.show(data, event);
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
        this.root.replaceChildren(this.tooltipOverlay);
        this.updateTooltipBounds();
    }
}
