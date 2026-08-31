import { iterateLines } from "./stream.js";
import { createTiledAlignmentBuilder } from "./tiledStorage.js";

export async function parseFastaAlignment(input, options = {}) {
    const records = [];
    let currentName = null;
    let currentSequence = "";
    let builder = null;
    let totalCols = null;

    const finalizeCurrentRecord = async () => {
        if (currentName === null) {
            return;
        }
        if (currentSequence.length === 0) {
            throw new Error("The alignment contains an empty sequence.");
        }
        if (totalCols === null) {
            totalCols = currentSequence.length;
            builder = await createTiledAlignmentBuilder(totalCols, options);
        } else if (currentSequence.length !== totalCols) {
            throw new Error("All FASTA sequences must have the same aligned length.");
        }

        await builder.appendRow(currentSequence);
        records.push({ name: currentName });
    };

    try {
        for await (const rawLine of iterateLines(input, "FASTA")) {
            const line = rawLine.trim();
            if (!line) {
                continue;
            }

            if (line.startsWith("#")) {
                continue;
            }

            if (line.startsWith(">")) {
                await finalizeCurrentRecord();
                currentName = line.slice(1).trim() || `sequence_${records.length + 1}`;
                currentSequence = "";
                continue;
            }

            if (currentName === null) {
                throw new Error("FASTA parsing failed: sequence data appeared before the first header.");
            }

            currentSequence += line.replace(/\s+/g, "");
        }

        await finalizeCurrentRecord();

        if (records.length === 0 || !builder) {
            throw new Error("No FASTA records were found.");
        }
        return await builder.finalize(records);
    } catch (error) {
        await builder?.abort?.();
        throw error;
    }
}
