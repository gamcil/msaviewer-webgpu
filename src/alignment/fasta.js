import { iterateLines } from "./stream.js";
import { createTiledAlignmentBuilder } from "./tiledStorage.js";

export async function parseFastaAlignment(input, options = {}) {
    const records = [];
    let currentName = null;
    let currentSequence = "";
    let builder = null;
    let totalCols = null;

    const finalizeCurrentRecord = () => {
        if (currentName === null) {
            return;
        }
        if (currentSequence.length === 0) {
            throw new Error("The alignment contains an empty sequence.");
        }
        if (totalCols === null) {
            totalCols = currentSequence.length;
            builder = createTiledAlignmentBuilder(totalCols, options);
        } else if (currentSequence.length !== totalCols) {
            throw new Error("All FASTA sequences must have the same aligned length.");
        }

        builder.appendRow(currentSequence);
        records.push({ name: currentName });
    };

    for await (const rawLine of iterateLines(input, "FASTA")) {
        const line = rawLine.trim();
        if (!line) {
            continue;
        }

        if (line.startsWith("#")) {
            continue;
        }

        if (line.startsWith(">")) {
            finalizeCurrentRecord();
            currentName = line.slice(1).trim() || `sequence_${records.length + 1}`;
            currentSequence = "";
            continue;
        }

        if (currentName === null) {
            throw new Error("FASTA parsing failed: sequence data appeared before the first header.");
        }

        currentSequence += line.replace(/\s+/g, "");
    }

    finalizeCurrentRecord();

    if (records.length === 0 || !builder) {
        throw new Error("No FASTA records were found.");
    }
    return builder.finalize(records);
}
