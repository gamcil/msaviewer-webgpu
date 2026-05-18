import { parseA3MAlignment } from "../../alignment/a3m.js";
import { parseFastaAlignment } from "../../alignment/fasta.js";

function normalizeRep(input, defaultAlphabetId = null) {
    if (!input?.id || !input?.store) {
        throw new Error("Representation input must include an id and store.");
    }
    return {
        id: input.id,
        label: input.label ?? input.id,
        store: input.store,
        alphabetId: input.alphabetId ?? defaultAlphabetId ?? input.id,
    };
}

function inferAlignmentFormat(name = "") {
    return name.toLowerCase().endsWith(".a3m") ? "a3m" : "fasta";
}

function toRepId(value = "", fallback = "default") {
    const id = value
        .replace(/\.[^.]+$/, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
    return id || fallback;
}

async function parseAlignment(input, format) {
    if (format === "a3m") {
        return parseA3MAlignment(input);
    }
    if (format === "fasta") {
        return parseFastaAlignment(input);
    }
    throw new Error(`Unsupported alignment format: ${format}.`);
}

async function loadRep({
    source,
    file = null,
    store = null,
    format = "auto",
    id,
    label,
    alphabetId,
} = {}, index = 0, { defaultAlphabetId = null } = {}) {
    const sourceName = file?.name ?? source?.name ?? label ?? id ?? "";
    const nextId = id ?? toRepId(sourceName, `representation-${index + 1}`);
    const nextFormat = format === "auto" ? inferAlignmentFormat(sourceName) : format;
    const nextStore = store ?? await parseAlignment(source ?? file, nextFormat);
    return normalizeRep({
        id: nextId,
        label: label ?? file?.name ?? source?.name ?? nextId,
        store: nextStore,
        alphabetId,
    }, defaultAlphabetId);
}

export function loadRepresentations(input, options = {}) {
    return Promise.all(
        (Array.isArray(input) ? input : [input])
            .map((entry, index) => loadRep(entry, index, options))
    );
}
