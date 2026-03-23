import { aminoAcidAlphabet } from "../alphabets/index.js";

function buildConsensusColumns(columnMetrics, numSequences, alphabet) {
    const counts = columnMetrics.counts;
    if (!counts) {
        return { columns: [] };
    }

    const bucketStride = alphabet.bucketStride;
    const alphabetSize = alphabet.coreSize;
    const gapBucketIndex = alphabet.gapBucketIndex;
    const numColumns = Math.floor(counts.length / bucketStride);
    const columns = new Array(numColumns);

    for (let col = 0; col < numColumns; col += 1) {
        const colOffset = col * bucketStride;
        const gapCount = counts[colOffset + gapBucketIndex];
        const nonGapCount = numSequences - gapCount;
        const letters = [];

        for (let i = 0; i < alphabetSize; i += 1) {
            const count = counts[colOffset + i];
            if (count === 0) continue;
            letters.push({
                glyph: alphabet.symbols[i],
                color: alphabet.logoColors?.[i] ?? "#333",
                count,
                logoFraction: nonGapCount > 0 ? count / nonGapCount : 0,
            });
        }

        letters.sort((a, b) => b.count - a.count);

        const consensusIndex = columnMetrics.consensusIndex?.[col];
        const consensusTie = columnMetrics.consensusTie?.[col] === 1;
        const consensusGlyph = consensusTie
            ? "+"
            : (Number.isFinite(consensusIndex) && consensusIndex < alphabet.symbols.length
                ? alphabet.symbols[consensusIndex]
                : null);

        columns[col] = {
            occupancy: columnMetrics.occupancy?.[col] ?? (numSequences > 0 ? nonGapCount / numSequences : 0),
            modalFractionNonGap: columnMetrics.modalFractionNonGap?.[col] ?? 0,
            informationContentRaw: columnMetrics.informationContentRaw?.[col] ?? 0,
            nonGapCount,
            consensusGlyph,
            letters: letters.map(({ glyph, color, logoFraction }) => ({ glyph, color, logoFraction })),
        };
    }

    return { columns };
}

export class TrackStateBuilder {
    buildMetricsState(columnMetrics) {
        return {
            quality: columnMetrics?.quality ?? null,
            occupancy: columnMetrics?.occupancy ?? null,
            entropy: columnMetrics?.entropy ?? null,
        };
    }

    buildConsensusState(columnMetrics, numSequences, alphabet = aminoAcidAlphabet) {
        return buildConsensusColumns(columnMetrics, numSequences, alphabet);
    }

    build(columnMetrics, numSequences, alphabet = aminoAcidAlphabet) {
        return {
            alphabet,
            metrics: this.buildMetricsState(columnMetrics),
            consensus: this.buildConsensusState(columnMetrics, numSequences, alphabet),
        };
    }
}

const defaultTrackStateBuilder = new TrackStateBuilder();

export function buildTrackState(columnMetrics, numSequences, alphabet = aminoAcidAlphabet) {
    return defaultTrackStateBuilder.build(columnMetrics, numSequences, alphabet);
}
