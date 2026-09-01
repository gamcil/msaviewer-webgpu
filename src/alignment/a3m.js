import { firstNonWhitespaceIndex, isAsciiWhitespace, iterateLines } from "./stream.js";
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

async function* iterateA3MRecords(lineSource) {
    let currentName = null;
    let currentSequence = "";
    let recordCount = 0;

    for await (const rawLine of lineSource()) {
        const first = firstNonWhitespaceIndex(rawLine);
        if (first === rawLine.length || rawLine.charCodeAt(first) === 35) {
            continue;
        }
        if (rawLine.charCodeAt(first) === 62) {
            if (currentName !== null) {
                yield { name: currentName, sequence: currentSequence };
            }
            recordCount += 1;
            currentName = rawLine.slice(first + 1).trim() || `sequence_${recordCount}`;
            currentSequence = "";
            continue;
        }
        if (currentName === null) {
            throw new Error("A3M parsing failed: sequence data appeared before the first header.");
        }
        currentSequence += rawLine;
    }

    if (currentName !== null) {
        yield { name: currentName, sequence: currentSequence };
    }
}

function measureA3MSequence(sequence, insertionWidths = null) {
    let leadingLength = 0;
    let trailingLength = 0;
    let coreLength = 0;
    let seenCore = false;
    let pendingInsertionLength = 0;

    for (let i = 0; i < sequence.length; i += 1) {
        const charCode = sequence.charCodeAt(i);
        if (isAsciiWhitespace(charCode)) {
            continue;
        }
        const isLowercase = charCode >= 97 && charCode <= 122;
        if (isLowercase) {
            pendingInsertionLength += 1;
            continue;
        }

        if (!seenCore) {
            leadingLength = pendingInsertionLength;
            seenCore = true;
        } else if (insertionWidths && coreLength <= insertionWidths.length) {
            const slot = coreLength - 1;
            insertionWidths[slot] = Math.max(insertionWidths[slot], pendingInsertionLength);
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
        trailingLength,
    };
}

function encodeA3MRow(sequence, totalCols, leadingWidth, insertionWidths) {
    const row = new Uint8Array(totalCols);
    row.fill(45);
    let offset = 0;
    let coreLength = 0;
    let insertionStart = 0;

    for (let i = 0; i < sequence.length; i += 1) {
        const charCode = sequence.charCodeAt(i);
        if (isAsciiWhitespace(charCode)) {
            continue;
        }
        if (charCode >= 97 && charCode <= 122) {
            row[offset] = charCode;
            offset += 1;
            continue;
        }

        offset = coreLength === 0
            ? leadingWidth
            : insertionStart + insertionWidths[coreLength - 1];
        row[offset] = charCode;
        offset += 1;
        insertionStart = offset;
        coreLength += 1;
    }

    return row;
}

function buildA3MColumnMetadata(totalCols, leadingWidth, coreLength, insertionWidths, trailingWidth) {
    const isInsertionColumn = new Uint8Array(totalCols);
    let offset = 0;
    for (let i = 0; i < leadingWidth; i += 1) {
        isInsertionColumn[offset + i] = 1;
    }
    offset += leadingWidth;
    for (let coreIndex = 0; coreIndex < coreLength; coreIndex += 1) {
        offset += 1;
        if (coreIndex < insertionWidths.length) {
            const insertionWidth = insertionWidths[coreIndex];
            for (let i = 0; i < insertionWidth; i += 1) {
                isInsertionColumn[offset + i] = 1;
            }
            offset += insertionWidth;
        }
    }
    for (let i = 0; i < trailingWidth; i += 1) {
        isInsertionColumn[offset + i] = 1;
    }
    return { kind: "a3m", isInsertionColumn };
}

export async function parseA3MAlignment(input, options = {}) {
    const lineSource = createA3MLineSource(input);
    const records = [];
    let coreLength = null;
    let leadingWidth = 0;
    let trailingWidth = 0;
    let insertionWidths = null;

    for await (const { name, sequence } of iterateA3MRecords(lineSource)) {
        const metrics = measureA3MSequence(sequence);
        if (coreLength === null) {
            coreLength = metrics.coreLength;
            if (coreLength === 0) {
                throw new Error("The alignment contains no aligned columns.");
            }
            insertionWidths = new Uint32Array(Math.max(0, coreLength - 1));
            measureA3MSequence(sequence, insertionWidths);
        } else if (metrics.coreLength !== coreLength) {
            throw new Error("All A3M sequences must have the same aligned match-state length.");
        } else {
            measureA3MSequence(sequence, insertionWidths);
        }

        leadingWidth = Math.max(leadingWidth, metrics.leadingLength);
        trailingWidth = Math.max(trailingWidth, metrics.trailingLength);
        records.push({ name });
    }

    if (records.length === 0) {
        throw new Error("No A3M records were found.");
    }

    let totalCols = leadingWidth + coreLength + trailingWidth;
    for (let slot = 0; slot < insertionWidths.length; slot += 1) {
        totalCols += insertionWidths[slot];
    }

    const builder = await createTiledAlignmentBuilder(totalCols, options);

    try {
        for await (const { sequence } of iterateA3MRecords(lineSource)) {
            const pendingWrite = builder.appendRow(
                encodeA3MRow(sequence, totalCols, leadingWidth, insertionWidths)
            );
            if (pendingWrite) {
                await pendingWrite;
            }
        }

        const alignment = await builder.finalize(records);
        alignment.columnMetadata = buildA3MColumnMetadata(
            totalCols,
            leadingWidth,
            coreLength,
            insertionWidths,
            trailingWidth
        );
        return alignment;
    } catch (error) {
        await builder.abort();
        throw error;
    }
}
