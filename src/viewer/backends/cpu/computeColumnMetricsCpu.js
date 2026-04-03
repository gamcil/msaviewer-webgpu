import { loadDecodedTile } from "../../../alignment/tiledStorage.js";

function normalizeResidue(raw) {
    if (raw >= 97 && raw <= 122) {
        return raw - 32;
    }
    return raw;
}

function residueToIndex(raw, alphabet) {
    const residue = normalizeResidue(raw);
    switch (alphabet.id) {
    case "aa": {
        const mapping = {
            65: 0, 82: 1, 78: 2, 68: 3, 67: 4,
            81: 5, 69: 6, 71: 7, 72: 8, 73: 9,
            76: 10, 75: 11, 77: 12, 70: 13, 80: 14,
            83: 15, 84: 16, 87: 17, 89: 18, 86: 19,
        };
        return mapping[residue] ?? alphabet.metricConfig.gapBucketIndex;
    }
    case "3di": {
        const mapping = {
            65: 0, 67: 1, 68: 2, 69: 3, 70: 4,
            71: 5, 72: 6, 73: 7, 75: 8, 76: 9,
            77: 10, 78: 11, 80: 12, 81: 13, 82: 14,
            83: 15, 84: 16, 86: 17, 87: 18, 89: 19,
        };
        return mapping[residue] ?? alphabet.metricConfig.gapBucketIndex;
    }
    case "nt": {
        const mapping = {
            65: 0, 67: 1, 71: 2, 84: 3, 85: 3,
        };
        return mapping[residue] ?? alphabet.metricConfig.gapBucketIndex;
    }
    default:
        return alphabet.metricConfig.gapBucketIndex;
    }
}

function calculateEntropy(counts, offset, alphabet) {
    let nonGapCount = 0;
    for (let i = 0; i < alphabet.metricConfig.coreSize; i += 1) {
        nonGapCount += counts[offset + i];
    }
    if (nonGapCount < 2) return 0;

    let entropy = 0;
    for (let i = 0; i < alphabet.metricConfig.coreSize; i += 1) {
        const count = counts[offset + i];
        if (count === 0) continue;
        const p = count / nonGapCount;
        entropy -= p * Math.log2(p);
    }
    return entropy / Math.log2(alphabet.metricConfig.coreSize);
}

function calculateModalFractionNonGap(counts, offset, alphabet) {
    let nonGapCount = 0;
    let maxCount = 0;
    for (let i = 0; i < alphabet.metricConfig.coreSize; i += 1) {
        const count = counts[offset + i];
        nonGapCount += count;
        if (count > maxCount) maxCount = count;
    }
    return nonGapCount === 0 ? 0 : maxCount / nonGapCount;
}

function calculateConsensusIndex(counts, offset, alphabet) {
    let maxCount = 0;
    let maxIndex = alphabet.metricConfig.gapBucketIndex;
    for (let i = 0; i < alphabet.metricConfig.coreSize; i += 1) {
        const count = counts[offset + i];
        if (count > maxCount) {
            maxCount = count;
            maxIndex = i;
        }
    }
    return maxIndex;
}

function calculateConsensusTie(counts, offset, alphabet) {
    let maxCount = 0;
    for (let i = 0; i < alphabet.metricConfig.coreSize; i += 1) {
        maxCount = Math.max(maxCount, counts[offset + i]);
    }
    if (maxCount === 0) return 0;
    let numMax = 0;
    for (let i = 0; i < alphabet.metricConfig.coreSize; i += 1) {
        if (counts[offset + i] === maxCount) numMax += 1;
    }
    return numMax > 1 ? 1 : 0;
}

function calculateQuality(counts, offset, alphabet, totalRows) {
    if (!alphabet.supports?.quality || !alphabet.qualityMatrix) return 0;
    let nonGapCount = 0;
    for (let i = 0; i < alphabet.metricConfig.coreSize; i += 1) {
        nonGapCount += counts[offset + i];
    }
    if (nonGapCount < 2 || totalRows === 0) return 0;
    const occupancy = nonGapCount / totalRows;
    let quality = 0;
    let totalPairs = 0;
    const matrix = alphabet.qualityMatrix;
    const size = alphabet.metricConfig.qualityMatrixSize;
    for (let i = 0; i < alphabet.metricConfig.coreSize; i += 1) {
        const countI = counts[offset + i];
        if (countI === 0) continue;
        for (let j = 0; j < alphabet.metricConfig.coreSize; j += 1) {
            const countJ = counts[offset + j];
            if (countJ === 0) continue;
            const pairCount = countI * countJ;
            const pairScore = matrix[(i * size) + j];
            const selfI = matrix[(i * size) + i];
            const selfJ = matrix[(j * size) + j];
            const denom = Math.max(selfI, selfJ);
            const ratio = denom > 0 ? pairScore / denom : 0;
            quality += pairCount * ratio;
            totalPairs += pairCount;
        }
    }
    if (totalPairs === 0) return 0;
    return Math.max(0, (quality / totalPairs) * occupancy);
}

function calculateConservation(counts, offset, alphabet, totalRows) {
    if (alphabet.id !== "aa" || totalRows === 0) {
        return { score: 0, mask: 0 };
    }

    const AMAS_PROP_HYDROPHOBIC = 1 << 0;
    const AMAS_PROP_POLAR = 1 << 1;
    const AMAS_PROP_SMALL = 1 << 2;
    const AMAS_PROP_PROLINE = 1 << 3;
    const AMAS_PROP_TINY = 1 << 4;
    const AMAS_PROP_ALIPHATIC = 1 << 5;
    const AMAS_PROP_AROMATIC = 1 << 6;
    const AMAS_PROP_POSITIVE = 1 << 7;
    const AMAS_PROP_NEGATIVE = 1 << 8;
    const AMAS_PROP_CHARGED = 1 << 9;
    const AMAS_PROPERTY_MASK_ALL =
        AMAS_PROP_HYDROPHOBIC | AMAS_PROP_POLAR | AMAS_PROP_SMALL | AMAS_PROP_PROLINE | AMAS_PROP_TINY |
        AMAS_PROP_ALIPHATIC | AMAS_PROP_AROMATIC | AMAS_PROP_POSITIVE | AMAS_PROP_NEGATIVE | AMAS_PROP_CHARGED;
    const AMAS_NEGATIVE_SHIFT = 10;
    const AMAS_IDENTITY_BIT = 1 << 20;
    const AMAS_ALL_PROPERTIES_BIT = 1 << 21;

    const propsByIndex = [
        AMAS_PROP_HYDROPHOBIC | AMAS_PROP_SMALL | AMAS_PROP_TINY,
        AMAS_PROP_POLAR | AMAS_PROP_POSITIVE | AMAS_PROP_CHARGED,
        AMAS_PROP_POLAR | AMAS_PROP_SMALL,
        AMAS_PROP_POLAR | AMAS_PROP_SMALL | AMAS_PROP_NEGATIVE | AMAS_PROP_CHARGED,
        AMAS_PROP_HYDROPHOBIC | AMAS_PROP_SMALL,
        AMAS_PROP_POLAR,
        AMAS_PROP_POLAR | AMAS_PROP_NEGATIVE | AMAS_PROP_CHARGED,
        AMAS_PROP_HYDROPHOBIC | AMAS_PROP_SMALL | AMAS_PROP_TINY,
        AMAS_PROP_HYDROPHOBIC | AMAS_PROP_POLAR | AMAS_PROP_AROMATIC | AMAS_PROP_POSITIVE | AMAS_PROP_CHARGED,
        AMAS_PROP_HYDROPHOBIC | AMAS_PROP_ALIPHATIC,
        AMAS_PROP_HYDROPHOBIC | AMAS_PROP_ALIPHATIC,
        AMAS_PROP_POLAR | AMAS_PROP_POSITIVE | AMAS_PROP_CHARGED,
        AMAS_PROP_HYDROPHOBIC,
        AMAS_PROP_HYDROPHOBIC | AMAS_PROP_AROMATIC,
        AMAS_PROP_SMALL | AMAS_PROP_PROLINE,
        AMAS_PROP_POLAR | AMAS_PROP_SMALL | AMAS_PROP_TINY,
        AMAS_PROP_POLAR | AMAS_PROP_SMALL,
        AMAS_PROP_HYDROPHOBIC | AMAS_PROP_POLAR | AMAS_PROP_AROMATIC,
        AMAS_PROP_HYDROPHOBIC | AMAS_PROP_POLAR | AMAS_PROP_AROMATIC,
        AMAS_PROP_HYDROPHOBIC | AMAS_PROP_SMALL | AMAS_PROP_ALIPHATIC,
    ];

    const gapCount = counts[offset + alphabet.metricConfig.gapBucketIndex];
    if ((gapCount * 100) >= (25 * totalRows)) {
        return { score: 0, mask: 0 };
    }

    let observedKinds = 0;
    let observedNonGapKindsAll = 0;
    let conservedPositive = AMAS_PROPERTY_MASK_ALL;
    let conservedNegative = AMAS_PROPERTY_MASK_ALL;
    const residueThreshold = Math.floor((totalRows * 3) / 100);

    for (let aa = 0; aa < alphabet.metricConfig.coreSize; aa += 1) {
        const count = counts[offset + aa];
        if (count === 0) continue;
        observedNonGapKindsAll += 1;
        if (count <= residueThreshold) continue;
        const props = propsByIndex[aa] ?? 0;
        conservedPositive &= props;
        conservedNegative &= (AMAS_PROPERTY_MASK_ALL & ~props);
        observedKinds += 1;
    }

    if (observedKinds === 0) {
        return { score: 0, mask: 0 };
    }

    const bitCount = (value) => {
        let count = 0;
        let bits = value >>> 0;
        while (bits !== 0) {
            count += bits & 1;
            bits >>>= 1;
        }
        return count;
    };
    let score = bitCount(conservedPositive) + bitCount(conservedNegative);
    let mask = (conservedPositive | (conservedNegative << AMAS_NEGATIVE_SHIFT)) >>> 0;
    if (observedNonGapKindsAll === 1) {
        score = 11;
        mask |= AMAS_IDENTITY_BIT;
    } else if (score === 10) {
        mask |= AMAS_ALL_PROPERTIES_BIT;
    }
    return { score, mask: mask >>> 0 };
}

export async function computeColumnMetricsCpu({ alignmentStore, alphabet, decodedTileCache }) {
    const bucketStride = alphabet.metricConfig.bucketStride;
    const totalCols = alignmentStore.totalCols;
    const totalRows = alignmentStore.totalRows;
    const tileCols = alignmentStore.tileCols;
    const tileRows = alignmentStore.tileRows;
    const finalCounts = new Uint32Array(totalCols * bucketStride);

    for (let rowTile = 0; rowTile < alignmentStore.rowTileCount; rowTile += 1) {
        for (let colTile = 0; colTile < alignmentStore.colTileCount; colTile += 1) {
            const tileIndex = rowTile * alignmentStore.colTileCount + colTile;
            const tileData = await loadDecodedTile(alignmentStore, tileIndex, decodedTileCache);
            const colStart = colTile * tileCols;
            const rowsInTile = Math.min(tileRows, totalRows - (rowTile * tileRows));
            const colsInTile = Math.min(tileCols, totalCols - colStart);
            for (let row = 0; row < rowsInTile; row += 1) {
                const rowOffset = row * tileCols;
                for (let col = 0; col < colsInTile; col += 1) {
                    const rawResidue = tileData[rowOffset + col];
                    if (rawResidue >= 97 && rawResidue <= 122) continue;
                    const residueIndex = residueToIndex(rawResidue, alphabet);
                    finalCounts[((colStart + col) * bucketStride) + residueIndex] += 1;
                }
            }
        }
    }

    const quality = new Float32Array(totalCols);
    const occupancy = new Float32Array(totalCols);
    const entropy = new Float32Array(totalCols);
    const modalFractionNonGap = new Float32Array(totalCols);
    const informationContentRaw = new Float32Array(totalCols);
    const consensusIndex = new Uint16Array(totalCols);
    const consensusTie = new Uint8Array(totalCols);
    const conservationScore = new Uint8Array(totalCols);
    const conservationMask = new Uint32Array(totalCols);

    for (let col = 0; col < totalCols; col += 1) {
        const offset = col * bucketStride;
        let nonGapCount = 0;
        for (let i = 0; i < alphabet.metricConfig.coreSize; i += 1) {
            nonGapCount += finalCounts[offset + i];
        }
        const normalizedEntropy = calculateEntropy(finalCounts, offset, alphabet);
        quality[col] = calculateQuality(finalCounts, offset, alphabet, totalRows);
        occupancy[col] = totalRows > 0 ? nonGapCount / totalRows : 0;
        entropy[col] = normalizedEntropy;
        modalFractionNonGap[col] = calculateModalFractionNonGap(finalCounts, offset, alphabet);
        informationContentRaw[col] = Math.max(0, 1 - normalizedEntropy);
        consensusIndex[col] = calculateConsensusIndex(finalCounts, offset, alphabet);
        consensusTie[col] = calculateConsensusTie(finalCounts, offset, alphabet);
        const conservation = calculateConservation(finalCounts, offset, alphabet, totalRows);
        conservationScore[col] = conservation.score;
        conservationMask[col] = conservation.mask;
    }

    return {
        quality,
        occupancy,
        entropy,
        modalFractionNonGap,
        informationContentRaw,
        consensusIndex,
        consensusTie,
        conservationScore,
        conservationMask,
        counts: finalCounts,
    };
}
