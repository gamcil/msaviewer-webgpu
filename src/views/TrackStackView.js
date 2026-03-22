/*
View for managing a stack of individual tracks
*/

export class TrackStackView {
    constructor({ root }) {
        this.root = root;
        this.tracks = [];
        this.trackState = null;
    }

    addTrack(track) {
        this.tracks.push(track);
        this.root.appendChild(track.root);
        if (this.trackState) {
            track.setTrackState?.(this.trackState);
        }
    }

    removeTrack(trackId) {
        const idx = this.tracks.findIndex((track) => track.id === trackId);
        if (idx === -1) return;
        this.tracks[idx].destroy();
        this.tracks.splice(idx, 1);
    }

    setViewport(viewport) {
        for (const track of this.tracks) {
            track.setViewport(viewport);
        }
    }

    setTrackState(trackState) {
        this.trackState = trackState;
        for (const track of this.tracks) {
            track.setTrackState?.(trackState);
        }
    }

    setTheme(theme) {
        for (const track of this.tracks) {
            track.setTheme?.(theme);
        }
    }

    render() {
        for (const track of this.tracks) {
            track.render();
        }
    }

    clear() {
        for (const track of this.tracks) {
            track.destroy();
        }
        this.root.replaceChildren();
    }
}
