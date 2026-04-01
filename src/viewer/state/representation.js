/**
 * @typedef {Object} AlignmentRepresentation
 * @property {string} id
 * @property {string} alphabetId
 * @property {Object} store
 * @property {{ colProfileBuffer: GPUBuffer, totalCols: number, totalRows: number, profileSchemeKey?: string|null }} alignmentState
 * @property {Object|null} columnMetrics
 * @property {Object|null} columnVisibility
 * @property {{ query: string, visibilitySignature: string, hitsByRow: Array<Array<{ start: number, len: number }>>, matchCount: number }|null} motifSearch
 * @property {Object|null} trackState
 * @property {{ key: string, width: number, height: number, pixels: Uint8ClampedArray }|null} minimapCache
 */

/**
 * @param {{
 *   id: string,
 *   alphabetId: string,
 *   store: Object,
 *   alignmentState: { colProfileBuffer: GPUBuffer, totalCols: number, totalRows: number, profileSchemeKey?: string|null },
 *   columnMetrics?: Object|null,
 *   columnVisibility?: Object|null,
 *   motifSearch?: { query: string, visibilitySignature: string, hitsByRow: Array<Array<{ start: number, len: number }>>, matchCount: number }|null,
 *   trackState?: Object|null,
 *   minimapCache?: { key: string, width: number, height: number, pixels: Uint8ClampedArray }|null,
 * }} params
 * @returns {AlignmentRepresentation}
 */
export function createRepresentation({
    id,
    alphabetId,
    store,
    alignmentState,
    columnMetrics = null,
    columnVisibility = null,
    motifSearch = null,
    trackState = null,
    minimapCache = null,
}) {
    return {
        id,
        alphabetId,
        store,
        alignmentState,
        columnMetrics,
        columnVisibility,
        motifSearch,
        trackState,
        minimapCache,
    };
}
