import { compileMotifQuery, searchVisibleMotifHits } from "../motifSearch.js";

export class MotifController {
    constructor({
        alignmentView,
        decodedTileCache,
        representationStore,
        getActiveRepresentation,
        getAlignmentStore,
        getColumnVisibility,
    }) {
        this.alignmentView = alignmentView;
        this.decodedTileCache = decodedTileCache;
        this.representationStore = representationStore;
        this.getActiveRepresentation = getActiveRepresentation;
        this.getAlignmentStore = getAlignmentStore;
        this.getColumnVisibility = getColumnVisibility;
        this.query = "";
        this.generation = 0;
    }

    syncOverlay() {
        const representation = this.getActiveRepresentation?.();
        const motifSearch = representation?.motifSearch ?? null;
        if (!this.alignmentView) return;
        this.alignmentView.setMotifState({
            motifHitsByRow: motifSearch?.query === this.query ? motifSearch.hitsByRow : null,
        });
    }

    getMatchCount() {
        const motifSearch = this.getActiveRepresentation?.()?.motifSearch;
        if (!motifSearch || motifSearch.query !== this.query) return 0;
        return motifSearch.matchCount ?? 0;
    }

    async refreshActiveRepresentation() {
        const representation = this.getActiveRepresentation?.();
        const alignmentStore = this.getAlignmentStore?.();
        const columnVisibility = this.getColumnVisibility?.() ?? null;
        const query = this.query.trim();
        const generation = ++this.generation;

        if (!representation || !alignmentStore || !query) {
            if (representation) {
                this.representationStore?.setMotifSearch(representation.id, null);
            }
            this.syncOverlay();
            return;
        }

        const cached = representation.motifSearch;
        const visibilitySignature = columnVisibility?.signature ?? "unmasked";
        if (cached?.query === query && cached?.visibilitySignature === visibilitySignature) {
            this.syncOverlay();
            return;
        }

        const compiledQuery = compileMotifQuery(query);
        if (!compiledQuery) {
            this.representationStore?.setMotifSearch(representation.id, null);
            this.syncOverlay();
            return;
        }

        const result = await searchVisibleMotifHits({
            alignmentStore,
            columnVisibility,
            compiledQuery,
            decodedTileCache: this.decodedTileCache,
            shouldContinue: () => generation === this.generation,
        });
        if (!result || generation !== this.generation) {
            return;
        }
        this.representationStore?.setMotifSearch(representation.id, result);
        this.syncOverlay();
    }

    async setQuery(query) {
        this.query = (query || "").trim();
        await this.refreshActiveRepresentation();
        return this.getMatchCount();
    }
}
