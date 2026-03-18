import { iterateLines } from "./stream.js";
import { createTiledAlignmentBuilder } from "./tiledStorage.js";

function createA3MLineSource(input) {
    if (typeof input === "string") {
        return () => iterateLines(input, "A3M");
    }
    if (typeof Blob !== "undefined" && input instanceof Blob) {
        return () => iterateLines(input, "A3M");
    }
    if (input && typeof input.stream === "function" && !(input instanceof ReadableStream)) {
        return () => iterateLines(input, "A3M");
    }
    throw new Error("Unsupported A3M input type.");
}

function measureA3MSequence(sequence) {
    let leadingLength = 0;
    let trailingLength = 0;
    let coreLength = 0;
    let seenCore = false;
    let pendingInsertionLength = 0;
    const insertionLengths = [];

    for (let i = 0; i < sequence.length; i += 1) {
        const charCode = sequence.charCodeAt(i);
        const isLowercase = charCode >= 97 && charCode <= 122;
        if (isLowercase) {
            pendingInsertionLength += 1;
            continue;
        }

        if (!seenCore) {
            leadingLength = pendingInsertionLength;
            seenCore = true;
        } else {
            insertionLengths.push(pendingInsertionLength);
        }

        pendingInsertionLength = 0;
        coreLength += 1;
    }

    if (seenCore) {
        trailingLength = pendingInsertionLength;
    } else {
        leadingLength = pendingInsertionLength;
    }

    return {
        leadingLength,
        coreLength,
        insertionLengths,
        trailingLength,
    };
}

function splitA3MSequence(sequence) {
    const leadingInsertion = [];
    const core = [];
    const insertions = [];
    let pendingInsertion = [];

    for (let i = 0; i < sequence.length; i += 1) {
        const charCode = sequence.charCodeAt(i);
        const isLowercase = charCode >= 97 && charCode <= 122;
        if (isLowercase) {
            pendingInsertion.push(charCode);
            continue;
        }
        if (core.length === 0) {
            leadingInsertion.push(...pendingInsertion);
        } else {
            insertions.push(pendingInsertion);
        }
        pendingInsertion = [];
        core.push(String.fromCharCode(charCode).toUpperCase().charCodeAt(0));
    }

    while (insertions.length < Math.max(0, core.length - 1)) {
        insertions.push([]);
    }

    return {
        leadingInsertion: Uint8Array.from(leadingInsertion),
        core: Uint8Array.from(core),
        insertions: insertions.map((insertion) => Uint8Array.from(insertion)),
        trailingInsertion: Uint8Array.from(pendingInsertion),
    };
}

function encodeA3MRow(record, totalCols, leadingWidth, insertionWidths, trailingWidth) {
    const row = new Uint8Array(totalCols);
    row.fill(45);
    let offset = 0;

    row.set(record.leadingInsertion, offset);
    offset += leadingWidth;

    for (let coreIndex = 0; coreIndex < record.core.length; coreIndex += 1) {
        row[offset] = record.core[coreIndex];
        offset += 1;

        if (coreIndex < insertionWidths.length) {
            const insertion = record.insertions[coreIndex] ?? new Uint8Array(0);
            row.set(insertion, offset);
            offset += insertionWidths[coreIndex];
        }
    }

    row.set(record.trailingInsertion, offset);

    return row;
}

export async function parseA3MAlignment(input, options = {}) {
    const lineSource = createA3MLineSource(input);
    const records = [];
    let currentName = null;
    let currentSequence = "";
    let coreLength = null;
    let leadingWidth = 0;
    let trailingWidth = 0;
    let insertionWidths = null;

    const finalizeFirstPassRecord = () => {
        if (currentName === null) {
            return;
        }

        const metrics = measureA3MSequence(currentSequence);
        if (coreLength === null) {
            coreLength = metrics.coreLength;
            if (coreLength === 0) {
                throw new Error("The alignment contains no aligned columns.");
            }
            insertionWidths = new Uint32Array(Math.max(0, coreLength - 1));
        } else if (metrics.coreLength !== coreLength) {
            throw new Error("All A3M sequences must have the same aligned match-state length.");
        }

        leadingWidth = Math.max(leadingWidth, metrics.leadingLength);
        trailingWidth = Math.max(trailingWidth, metrics.trailingLength);
        for (let slot = 0; slot < insertionWidths.length; slot += 1) {
            insertionWidths[slot] = Math.max(insertionWidths[slot], metrics.insertionLengths[slot] ?? 0);
        }

        records.push({ name: currentName });
    };

    for await (const rawLine of lineSource()) {
        const line = rawLine.trim();
        if (!line || line.startsWith("#")) continue;
        if (line.startsWith(">")) {
            finalizeFirstPassRecord();
            currentName = line.slice(1).trim() || `sequence_${records.length + 1}`;
            currentSequence = "";
            continue;
        }
        if (currentName === null) {
            throw new Error("A3M parsing failed: sequence data appeared before the first header.");
        }
        currentSequence += line.replace(/\s+/g, "");
    }
    finalizeFirstPassRecord();

    if (records.length === 0) {
        throw new Error("No A3M records were found.");
    }

    let totalCols = leadingWidth + coreLength + trailingWidth;
    for (let slot = 0; slot < insertionWidths.length; slot += 1) {
        totalCols += insertionWidths[slot];
    }

    const builder = createTiledAlignmentBuilder(totalCols, options);
    let encodedRows = 0;
    currentName = null;
    currentSequence = "";

    const finalizeSecondPassRecord = () => {
        if (currentName === null) {
            return;
        }

        const parsed = splitA3MSequence(currentSequence);
        builder.appendRow(encodeA3MRow(parsed, totalCols, leadingWidth, insertionWidths, trailingWidth));
        encodedRows += 1;
    };

    for await (const rawLine of lineSource()) {
        const line = rawLine.trim();
        if (!line || line.startsWith("#")) continue;
        if (line.startsWith(">")) {
            finalizeSecondPassRecord();
            currentName = line.slice(1).trim() || `sequence_${encodedRows + 1}`;
            currentSequence = "";
            continue;
        }
        if (currentName === null) {
            throw new Error("A3M parsing failed: sequence data appeared before the first header.");
        }
        currentSequence += line.replace(/\s+/g, "");
    }
    finalizeSecondPassRecord();

    return builder.finalize(records);
}
