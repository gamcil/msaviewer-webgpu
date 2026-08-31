import { parseA3MAlignment } from "./a3m.js";
import { parseFastaAlignment } from "./fasta.js";

function serializeError(error) {
    return error instanceof Error ? error.message : String(error);
}

self.onmessage = async ({ data }) => {
    const { id, input, format } = data;
    let tileStorage = null;
    try {
        const parser = format === "a3m" ? parseA3MAlignment : parseFastaAlignment;
        const alignment = await parser(input, {
            createOpfsReader: false,
            releaseOpfsLockOnFinalize: true,
        });
        tileStorage = alignment.tileStorage;
        const storage = tileStorage?.describe?.() ?? null;
        alignment.tileStorage = null;
        self.postMessage(
            { id, alignment, storage },
            alignment.sequenceResidueTileOffsets?.buffer ? [alignment.sequenceResidueTileOffsets.buffer] : []
        );
        tileStorage = null;
    } catch (error) {
        await tileStorage?.destroy?.().catch(() => {});
        self.postMessage({ id, error: serializeError(error) });
    }
};
