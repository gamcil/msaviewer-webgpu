/* Helper functions */

async function loadText(url) {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Failed to load ${url}: ${response.status}`);
    }
    return response.text();
}

function parseFastaAlignment(text) {
    const lines = text.replace(/\r/g, "").split("\n");
    const records = [];
    let current = null;

    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) {
            continue;
        }

        if (line.startsWith(">")) {
            current = {
                name: line.slice(1).trim() || `sequence_${records.length + 1}`,
                sequence: "",
            };
            records.push(current);
            continue;
        }

        if (!current) {
            throw new Error("FASTA parsing failed: sequence data appeared before the first header.");
        }

        current.sequence += line.replace(/\s+/g, "");
    }

    if (records.length === 0) {
        throw new Error("No FASTA records were found.");
    }

    const totalCols = records[0].sequence.length;
    if (totalCols === 0) {
        throw new Error("The alignment contains an empty sequence.");
    }

    for (const record of records) {
        if (record.sequence.length !== totalCols) {
            throw new Error("All FASTA sequences must have the same aligned length.");
        }
    }

    const totalRows = records.length;
    const alignment = new Uint8Array(totalCols * totalRows);

    for (let row = 0; row < totalRows; row += 1) {
        const sequence = records[row].sequence.toUpperCase();
        for (let col = 0; col < totalCols; col += 1) {
            alignment[row * totalCols + col] = sequence.charCodeAt(col);
        }
    }

    return { records, totalCols, totalRows, alignment };
}

function expandAlignmentForGpu(alignment) {
    const expanded = new Uint32Array(alignment.length);
    for (let i = 0; i < alignment.length; i += 1) {
        expanded[i] = alignment[i];
    }
    return expanded;
}

async function loadImageBitmap(url) {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Failed to load ${url}: ${response.status}`);
    }
    const blob = await response.blob();
    return createImageBitmap(blob);
}

export { loadText, loadImageBitmap, parseFastaAlignment, expandAlignmentForGpu };