/**
 * @typedef {{
 *   id: string,
 *   label?: string,
 *   store: Object,
 *   alphabetId?: string,
 * }} RepresentationInput
 */

export function normalizeRepresentationInput(input, fallback = null) {
    const candidate = input ?? fallback;
    if (!candidate) {
        throw new Error("Representation input is required.");
    }
    if (!candidate.id || !candidate.store) {
        throw new Error("Representation input must include an id and store.");
    }
    return {
        id: candidate.id,
        label: candidate.label ?? candidate.id,
        store: candidate.store,
        alphabetId: candidate.alphabetId ?? candidate.id,
    };
}

export function normalizeRepresentationInputs(inputs) {
    if (!Array.isArray(inputs) || inputs.length === 0) {
        throw new Error("Representation ingestion requires a non-empty array.");
    }
    return inputs.map((input) => normalizeRepresentationInput(input));
}
