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
        if (this.device && (!colProfileBuffer || previous?.alignmentState?.totalCols !== totalCols)) {
            colProfileBuffer?.destroy?.();
            colProfileBuffer = this.device.createBuffer({
                size: totalCols * this.getProfileStride(),
                usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
            });
        } else if (!this.device) {
            colProfileBuffer = null;
        }

        const preserveProfileSchemeKey = Boolean(colProfileBuffer && previous?.alignmentState?.totalCols === totalCols);
        const representation = createRepresentation({
            id,
            alphabetId: resolvedAlphabet.id,
            store,
            alignmentState: {
                colProfileBuffer,
                colProfileData: null,
                totalCols,
                totalRows,
                profileSchemeKey: preserveProfileSchemeKey ? (previous?.alignmentState?.profileSchemeKey ?? null) : null,
            },
        });
        this.representations.set(id, representation);
        return representation;
    }

    setProfileSchemeKey(id, schemeKey) {
        const representation = this.get(id);
        if (!representation) return null;
        representation.alignmentState.profileSchemeKey = schemeKey ?? null;
        return representation;
    }

    setProfileData(id, colProfileData) {
        const representation = this.get(id);
        if (!representation) return null;
        representation.alignmentState.colProfileData = colProfileData ?? null;
        return representation;
    }

    setAlphabetId(id, alphabetId) {
        const representation = this.get(id);
        if (!representation) return null;
        representation.alphabetId = alphabetId;
        representation.alignmentState.profileSchemeKey = null;
        representation.alignmentState.colProfileData = null;
        return representation;
    }

    setColumnMetrics(id, columnMetrics) {
        const representation = this.get(id);
        if (!representation) return null;
        representation.columnMetrics = columnMetrics;
        return representation;
    }

    setColumnVisibility(id, columnVisibility) {
        const representation = this.get(id);
        if (!representation) return null;
        representation.columnVisibility = columnVisibility;
        representation.motifSearch = null;
        return representation;
    }

    setMotifSearch(id, motifSearch) {
        const representation = this.get(id);
        if (!representation) return null;
        representation.motifSearch = motifSearch;
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
        representation.columnVisibility = null;
        representation.motifSearch = null;
        representation.trackState = null;
        representation.minimapCache = null;
        representation.alignmentState.profileSchemeKey = null;
        representation.alignmentState.colProfileData = null;
        return representation;
    }

    destroy() {
        for (const representation of this.representations.values()) {
            representation.alignmentState?.colProfileBuffer?.destroy?.();
        }
        this.representations.clear();
    }
}
