/**
 * @typedef {Object} AlignmentRepresentation
 * @property {string} id
 * @property {string} alphabetId
 * @property {Object} store
 * @property {{ colProfileBuffer: GPUBuffer, totalCols: number, totalRows: number }} alignmentState
 * @property {Object|null} columnMetrics
 * @property {Object|null} trackState
 * @property {{ key: string, width: number, height: number, pixels: Uint8ClampedArray }|null} minimapCache
 */

/**
 * @param {{
 *   id: string,
 *   alphabetId: string,
 *   store: Object,
 *   alignmentState: { colProfileBuffer: GPUBuffer, totalCols: number, totalRows: number },
 *   columnMetrics?: Object|null,
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
    trackState = null,
    minimapCache = null,
}) {
    return {
        id,
        alphabetId,
        store,
        alignmentState,
        columnMetrics,
        trackState,
        minimapCache,
    };
}
