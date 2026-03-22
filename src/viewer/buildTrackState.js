const AA_SYMBOLS = [
    "A", "R", "N", "D", "C",
    "Q", "E", "G", "H", "I",
    "L", "K", "M", "F", "P",
    "S", "T", "W", "Y", "V",
    "-",
];

const AA_LOGO_COLORS = [
    "#33a02c", "#1f78b4", "#1f78b4", "#e31a1c", "#ff7f00",
    "#1f78b4", "#e31a1c", "#ff7f00", "#6a3d9a", "#33a02c",
    "#33a02c", "#1f78b4", "#33a02c", "#33a02c", "#ff7f00",
    "#ff7f00", "#ff7f00", "#33a02c", "#33a02c", "#33a02c",
    "#999999",
];

function buildConsensusColumns(columnMetrics, numSequences) {
    const counts = columnMetrics.counts;
    const bucketStride = 21;
    const alphabetSize = 20;
    const gapBucketIndex = 20;
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
                glyph: AA_SYMBOLS[i],
                color: AA_LOGO_COLORS[i],
                count,
                logoFraction: nonGapCount > 0 ? count / nonGapCount : 0,
            });
        }

        letters.sort((a, b) => b.count - a.count);

        const consensusIndex = columnMetrics.consensusIndex?.[col];
        const consensusTie = columnMetrics.consensusTie?.[col] === 1;
        const consensusGlyph = consensusTie
            ? "+"
            : (Number.isFinite(consensusIndex) && consensusIndex < AA_SYMBOLS.length
                ? AA_SYMBOLS[consensusIndex]
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

export function buildTrackState(columnMetrics, numSequences) {
    return {
        metrics: {
            quality: columnMetrics.quality,
            occupancy: columnMetrics.occupancy,
            entropy: columnMetrics.entropy,
        },
        consensus: buildConsensusColumns(columnMetrics, numSequences),
    };
}
