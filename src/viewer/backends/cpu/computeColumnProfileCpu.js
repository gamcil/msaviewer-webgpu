function moreThanPercent(count, total, percent) {
    return total > 0 && (count * 100) > (percent * total);
}

function getCount(counts, offset, alphabet, symbol) {
    const index = alphabet.symbols.indexOf(symbol);
    return index >= 0 ? counts[offset + index] : 0;
}

function buildPidMask(counts, offset, alphabet) {
    let nonGapCount = 0;
    let maxCount = 0;
    let maxIndex = alphabet.gapBucketIndex ?? alphabet.coreSize;

    for (let i = 0; i < alphabet.coreSize; i += 1) {
        const count = counts[offset + i];
        nonGapCount += count;
        if (count > maxCount) {
            maxCount = count;
            maxIndex = i;
        }
    }

    let bucket = 0;
    if (moreThanPercent(maxCount, nonGapCount, 80)) {
        bucket = 3;
    } else if (moreThanPercent(maxCount, nonGapCount, 60)) {
        bucket = 2;
    } else if (moreThanPercent(maxCount, nonGapCount, 40)) {
        bucket = 1;
    }

    const consensusCode = maxIndex < alphabet.symbols.length
        ? alphabet.symbols[maxIndex].charCodeAt(0)
        : 0;
    return (consensusCode & 0xFF) | (bucket << 8);
}

function buildClustalxMask(counts, offset, alphabet) {
    const countA = getCount(counts, offset, alphabet, "A");
    const countC = getCount(counts, offset, alphabet, "C");
    const countD = getCount(counts, offset, alphabet, "D");
    const countE = getCount(counts, offset, alphabet, "E");
    const countF = getCount(counts, offset, alphabet, "F");
    const countG = getCount(counts, offset, alphabet, "G");
    const countH = getCount(counts, offset, alphabet, "H");
    const countI = getCount(counts, offset, alphabet, "I");
    const countK = getCount(counts, offset, alphabet, "K");
    const countL = getCount(counts, offset, alphabet, "L");
    const countM = getCount(counts, offset, alphabet, "M");
    const countN = getCount(counts, offset, alphabet, "N");
    const countP = getCount(counts, offset, alphabet, "P");
    const countQ = getCount(counts, offset, alphabet, "Q");
    const countR = getCount(counts, offset, alphabet, "R");
    const countS = getCount(counts, offset, alphabet, "S");
    const countT = getCount(counts, offset, alphabet, "T");
    const countV = getCount(counts, offset, alphabet, "V");
    const countW = getCount(counts, offset, alphabet, "W");
    const countY = getCount(counts, offset, alphabet, "Y");

    const nonGapCount =
        countA + countC + countD + countE + countF + countG + countH + countI + countK + countL
        + countM + countN + countP + countQ + countR + countS + countT + countV + countW + countY;

    const BIT_HYDROPHOBIC_60 = 1 << 0;
    const BIT_KR_60 = 1 << 1;
    const BIT_KRQ_80_ANY = 1 << 2;
    const BIT_QE_50 = 1 << 3;
    const BIT_ED_50 = 1 << 4;
    const BIT_EQD_80_ANY = 1 << 5;
    const BIT_DEN_80_ANY = 1 << 6;
    const BIT_N_50 = 1 << 7;
    const BIT_QTKR_80_ANY = 1 << 8;
    const BIT_TS_50 = 1 << 9;
    const BIT_ST_80_ANY = 1 << 10;
    const BIT_C_80 = 1 << 11;
    const BIT_G_PRESENT = 1 << 12;
    const BIT_P_PRESENT = 1 << 13;
    const BIT_AROMATIC_80_ANY = 1 << 14;

    let mask = 0;
    if (moreThanPercent(countW + countL + countV + countI + countM + countA + countF + countC + countH + countP, nonGapCount, 60)) mask |= BIT_HYDROPHOBIC_60;
    if (moreThanPercent(countK + countR, nonGapCount, 60)) mask |= BIT_KR_60;
    if (moreThanPercent(countK, nonGapCount, 80) || moreThanPercent(countR, nonGapCount, 80) || moreThanPercent(countQ, nonGapCount, 80)) mask |= BIT_KRQ_80_ANY;
    if (moreThanPercent(countQ + countE, nonGapCount, 50)) mask |= BIT_QE_50;
    if (moreThanPercent(countE + countD, nonGapCount, 50)) mask |= BIT_ED_50;
    if (moreThanPercent(countE, nonGapCount, 80) || moreThanPercent(countQ, nonGapCount, 80) || moreThanPercent(countD, nonGapCount, 80)) mask |= BIT_EQD_80_ANY;
    if (moreThanPercent(countD, nonGapCount, 80) || moreThanPercent(countE, nonGapCount, 80) || moreThanPercent(countN, nonGapCount, 80)) mask |= BIT_DEN_80_ANY;
    if (moreThanPercent(countN, nonGapCount, 50)) mask |= BIT_N_50;
    if (moreThanPercent(countQ, nonGapCount, 80) || moreThanPercent(countT, nonGapCount, 80) || moreThanPercent(countK, nonGapCount, 80) || moreThanPercent(countR, nonGapCount, 80)) mask |= BIT_QTKR_80_ANY;
    if (moreThanPercent(countT + countS, nonGapCount, 50)) mask |= BIT_TS_50;
    if (moreThanPercent(countS, nonGapCount, 80) || moreThanPercent(countT, nonGapCount, 80)) mask |= BIT_ST_80_ANY;
    if (moreThanPercent(countC, nonGapCount, 80)) mask |= BIT_C_80;
    if (countG > 0) mask |= BIT_G_PRESENT;
    if (countP > 0) mask |= BIT_P_PRESENT;
    if (
        moreThanPercent(countW, nonGapCount, 80) || moreThanPercent(countY, nonGapCount, 80)
        || moreThanPercent(countA, nonGapCount, 80) || moreThanPercent(countC, nonGapCount, 80)
        || moreThanPercent(countP, nonGapCount, 80) || moreThanPercent(countQ, nonGapCount, 80)
        || moreThanPercent(countF, nonGapCount, 80) || moreThanPercent(countH, nonGapCount, 80)
        || moreThanPercent(countI, nonGapCount, 80) || moreThanPercent(countL, nonGapCount, 80)
        || moreThanPercent(countM, nonGapCount, 80) || moreThanPercent(countV, nonGapCount, 80)
    ) {
        mask |= BIT_AROMATIC_80_ANY;
    }
    return mask >>> 0;
}

export function computeColumnProfileDataCpu({ columnMetrics, alphabet, schemeKey }) {
    const totalCols = Math.floor((columnMetrics?.counts?.length ?? 0) / (alphabet?.bucketStride ?? 1));
    const out = new Uint32Array(totalCols);
    if (!columnMetrics?.counts || !alphabet || totalCols === 0) {
        return out;
    }

    for (let col = 0; col < totalCols; col += 1) {
        const offset = col * alphabet.bucketStride;
        if (schemeKey === "clustalx" && alphabet.id === "aa") {
            out[col] = buildClustalxMask(columnMetrics.counts, offset, alphabet);
        } else if (schemeKey === "pid" || schemeKey === "similarity") {
            out[col] = buildPidMask(columnMetrics.counts, offset, alphabet);
        } else {
            out[col] = 0;
        }
    }

    return out;
}
