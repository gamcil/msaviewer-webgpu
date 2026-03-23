import { createRepresentation } from "./representation.js";

export class RepresentationStore {
    constructor({
        device,
        alphabetRegistry,
        getProfileStride,
    }) {
        this.device = device;
        this.alphabetRegistry = alphabetRegistry;
        this.getProfileStride = getProfileStride;
        this.representations = new Map();
    }

    get(id) {
        return this.representations.get(id) ?? null;
    }

    values() {
        return this.representations.values();
    }

    findByAlphabetId(alphabetId) {
        for (const representation of this.representations.values()) {
            if (representation.alphabetId === alphabetId) {
                return representation;
            }
        }
        return null;
    }

    register(id, store, { alphabetId = id } = {}) {
        const resolvedAlphabet = this.alphabetRegistry.get(alphabetId);
        if (!resolvedAlphabet) {
            throw new Error(`Unknown alphabet: ${alphabetId}`);
        }

        const { totalCols, totalRows } = store;
        const previous = this.get(id);
        let colProfileBuffer = previous?.alignmentState?.colProfileBuffer ?? null;
        if (!colProfileBuffer || previous?.alignmentState?.totalCols !== totalCols) {
            colProfileBuffer?.destroy?.();
            colProfileBuffer = this.device.createBuffer({
                size: totalCols * this.getProfileStride(),
                usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
            });
        }

        const representation = createRepresentation({
            id,
            alphabetId: resolvedAlphabet.id,
            store,
            alignmentState: { colProfileBuffer, totalCols, totalRows },
        });
        this.representations.set(id, representation);
        return representation;
    }

    setAlphabetId(id, alphabetId) {
        const representation = this.get(id);
        if (!representation) return null;
        representation.alphabetId = alphabetId;
        return representation;
    }

    setColumnMetrics(id, columnMetrics) {
        const representation = this.get(id);
        if (!representation) return null;
        representation.columnMetrics = columnMetrics;
        return representation;
    }

    setTrackState(id, trackState) {
        const representation = this.get(id);
        if (!representation) return null;
        representation.trackState = trackState;
        return representation;
    }

    setMinimapCache(id, minimapCache) {
        const representation = this.get(id);
        if (!representation) return null;
        representation.minimapCache = minimapCache;
        return representation;
    }

    invalidateDerived(id) {
        const representation = this.get(id);
        if (!representation) return null;
        representation.trackState = null;
        representation.minimapCache = null;
        return representation;
    }

    destroy() {
        for (const representation of this.representations.values()) {
            representation.alignmentState?.colProfileBuffer?.destroy?.();
        }
        this.representations.clear();
    }
}
