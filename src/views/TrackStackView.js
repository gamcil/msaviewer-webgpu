/*
View for managing a stack of individual tracks
*/

export class TrackStackView {
    constructor({ root }) {
        this.root = root;
        this.root.style.position = this.root.style.position || "relative";
        this.tracks = [];
        this.trackState = null;
        this.viewport = null;
        this.theme = null;
        this.renderDirty = false;
        this.frameHandle = 0;
        this.tooltipTrack = null;

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
        this.tooltipEl.style.position = "fixed";
        this.tooltipEl.style.pointerEvents = "none";
        this.tooltipEl.style.display = "none";
        this.tooltipEl.style.minWidth = "120px";
        this.tooltipEl.style.maxWidth = "240px";
        this.tooltipEl.style.padding = "8px 10px";
        this.tooltipEl.style.borderRadius = "6px";
        this.tooltipEl.style.border = "1px solid rgba(0, 0, 0, 0.12)";
        this.tooltipEl.style.boxShadow = "0 6px 20px rgba(0, 0, 0, 0.18)";
        this.tooltipEl.style.fontSize = "12px";
        this.tooltipEl.style.lineHeight = "1.35";
        this.tooltipEl.style.whiteSpace = "nowrap";

        this.tooltipOverlay.appendChild(this.tooltipHitbox);
        this.tooltipOverlay.appendChild(this.tooltipEl);
        this.root.appendChild(this.tooltipOverlay);
        this.applyTooltipTheme();
        this.bindTooltipEvents();
    }

    addTrack(track) {
        this.tracks.push(track);
        this.root.appendChild(track.root);
        if (this.viewport) {
            track.setViewport(this.viewport);
        }
        if (this.trackState) {
            track.setTrackState?.(this.trackState);
        }
        if (this.theme) {
            track.setTheme?.(this.theme);
        }
        this.updateTooltipBounds();
    }

    removeTrack(trackId) {
        const idx = this.tracks.findIndex((track) => track.id === trackId);
        if (idx === -1) return;
        this.tracks[idx].destroy();
        this.tracks.splice(idx, 1);
        this.updateTooltipBounds();
    }

    setViewport(viewport) {
        this.viewport = viewport;
        for (const track of this.tracks) {
            track.viewport = viewport;
        }
        this.updateTooltipBounds();
        this.requestRender();
    }

    setTrackState(trackState) {
        this.trackState = trackState;
        for (const track of this.tracks) {
            track.trackState = trackState;
            track.setTrackState?.(trackState);
        }
        this.updateTooltipBounds();
        this.requestRender();
    }

    setTheme(theme) {
        this.theme = theme;
        for (const track of this.tracks) {
            track.setTheme?.(theme);
        }
        this.applyTooltipTheme();
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

    applyTooltipTheme() {
        const darkMode = !!this.theme?.darkMode;
        this.tooltipEl.style.background = darkMode ? "rgba(24, 24, 28, 0.96)" : "rgba(255, 255, 255, 0.98)";
        this.tooltipEl.style.color = darkMode ? "#f3f3f5" : "#202226";
        this.tooltipEl.style.borderColor = darkMode ? "rgba(255, 255, 255, 0.12)" : "rgba(0, 0, 0, 0.12)";
    }

    getHoveredTrack(clientY) {
        for (const track of this.tracks) {
            const rect = track.root.getBoundingClientRect();
            if (clientY >= rect.top && clientY <= rect.bottom) {
                return track;
            }
        }
        return null;
    }

    getRawColumnFromEvent(event) {
        if (!this.viewport) return null;
        const bodyRect = this.tooltipOverlay.getBoundingClientRect();
        const contentX = event.clientX - bodyRect.left + this.viewport.scrollLeft;
        const visibleColumn = Math.floor(contentX / this.viewport.cellWidth);
        if (visibleColumn < 0 || visibleColumn >= this.viewport.totalCols) {
            return null;
        }
        return this.viewport.columnVisibility?.visibleToRaw?.[visibleColumn] ?? visibleColumn;
    }

    handleTooltipPointerMove(event) {
        const track = this.getHoveredTrack(event.clientY);
        const rawColumn = this.getRawColumnFromEvent(event);
        if (!track || rawColumn == null) {
            this.hideTooltip();
            return;
        }
        const tooltipData = track.getTooltipData?.(rawColumn, {
            visibleColumn: Math.floor((event.clientX - this.root.getBoundingClientRect().left + this.viewport.scrollLeft) / this.viewport.cellWidth),
            viewport: this.viewport,
            trackState: this.trackState,
        });
        if (!tooltipData) {
            this.hideTooltip();
            return;
        }
        this.showTooltip(tooltipData, event);
    }

    showTooltip(data, event) {
        const title = data.title ? `<div style="font-weight:600;">${data.title}</div>` : "";
        const subtitle = data.subtitle ? `<div style="font-size:11px; opacity:0.75; margin-top:2px;">${data.subtitle}</div>` : "";
        const lines = (data.lines ?? []).map((line) =>
            `<div style="margin-top:2px;">${line}</div>`
        ).join("");
        this.tooltipEl.innerHTML = `${title}${subtitle}${lines ? `<div style="margin-top:6px;">${lines}</div>` : ""}`;
        this.tooltipEl.style.display = "block";

        const offset = 12;
        const tooltipWidth = this.tooltipEl.offsetWidth;
        const tooltipHeight = this.tooltipEl.offsetHeight;
        const maxLeft = Math.max(0, window.innerWidth - tooltipWidth);
        const maxTop = Math.max(0, window.innerHeight - tooltipHeight);
        let left = event.clientX + offset;
        let top = event.clientY + offset;

        if (left > maxLeft) {
            left = event.clientX - tooltipWidth - offset;
        }
        if (top > maxTop) {
            top = event.clientY - tooltipHeight - offset;
        }

        left = Math.max(0, Math.min(maxLeft, left));
        top = Math.max(0, Math.min(maxTop, top));
        this.tooltipEl.style.left = `${left}px`;
        this.tooltipEl.style.top = `${top}px`;
    }

    hideTooltip() {
        this.tooltipEl.style.display = "none";
    }

    requestRender() {
        this.renderDirty = true;
        if (this.frameHandle) return;
        this.frameHandle = window.requestAnimationFrame(() => {
            this.frameHandle = 0;
            if (!this.renderDirty) return;
            this.renderDirty = false;
            this.render();
            this.updateTooltipBounds();
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
