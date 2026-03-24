/*
View for managing a stack of individual tracks
*/

export class TrackStackView {
    constructor({ root }) {
        this.root = root;
        this.tracks = [];
        this.trackState = null;
        this.viewport = null;
        this.theme = null;
        this.renderDirty = false;
        this.frameHandle = 0;
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
    }

    removeTrack(trackId) {
        const idx = this.tracks.findIndex((track) => track.id === trackId);
        if (idx === -1) return;
        this.tracks[idx].destroy();
        this.tracks.splice(idx, 1);
    }

    setViewport(viewport) {
        this.viewport = viewport;
        for (const track of this.tracks) {
            track.viewport = viewport;
        }
        this.requestRender();
    }

    setTrackState(trackState) {
        this.trackState = trackState;
        for (const track of this.tracks) {
            track.trackState = trackState;
            track.setTrackState?.(trackState);
        }
        this.requestRender();
    }

    setTheme(theme) {
        this.theme = theme;
        for (const track of this.tracks) {
            track.setTheme?.(theme);
        }
        this.requestRender();
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
        if (this.frameHandle) {
            window.cancelAnimationFrame(this.frameHandle);
            this.frameHandle = 0;
        }
        this.renderDirty = false;
        for (const track of this.tracks) {
            track.destroy();
        }
        this.root.replaceChildren();
    }
}
