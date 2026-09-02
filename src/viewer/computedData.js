export const COLUMN_METRIC_FIELDS = [
    "quality",
    "occupancy",
    "entropy",
    "modalFractionNonGap",
    "informationContentRaw",
    "consensusIndex",
    "consensusTie",
    "conservationScore",
    "conservationMask",
];

function getMetricConfig(alphabet) {
    return alphabet.metricConfig ?? {
        coreSize: alphabet.coreSize,
        gapBucketIndex: alphabet.gapBucketIndex,
    };
}

export function createAlphabetSnapshot(alphabet) {
    const metricConfig = getMetricConfig(alphabet);
    const coreSize = metricConfig.coreSize ?? 0;
    const gapBucketIndex = metricConfig.gapBucketIndex ?? coreSize;
    return {
        id: alphabet.id,
        label: alphabet.label ?? alphabet.id,
        shortLabel: alphabet.shortLabel ?? alphabet.label ?? alphabet.id,
        symbols: [...(alphabet.symbols?.slice(0, coreSize) ?? [])],
        gapSymbol: alphabet.symbols?.[gapBucketIndex] ?? "-",
    };
}

export function normalizeRawColumnRange(range, totalCols) {
    if (range == null) {
        return { start: 0, end: totalCols };
    }
    const { start = 0, end = totalCols } = range;
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end > totalCols) {
        throw new RangeError(`Raw column range must be within [0, ${totalCols}].`);
    }
    return { start, end };
}

export function normalizeMetricFields(fields) {
    if (fields == null) {
        return COLUMN_METRIC_FIELDS;
    }
    if (!Array.isArray(fields)) {
        throw new TypeError("Metric fields must be an array.");
    }
    const uniqueFields = [...new Set(fields)];
    for (const field of uniqueFields) {
        if (!COLUMN_METRIC_FIELDS.includes(field)) {
            throw new RangeError(`Unknown column metric '${field}'.`);
        }
    }
    return uniqueFields;
}

export function createColumnMetricsSnapshot({
    representation,
    alphabet,
    rawColumnRange,
    fields,
}) {
    const { start, end } = rawColumnRange;
    const snapshot = {
        representationId: representation.id,
        totalRows: representation.store.totalRows,
        totalCols: representation.store.totalCols,
        rawColumnRange: { start, end },
        alphabet: createAlphabetSnapshot(alphabet),
    };
    for (const field of fields) {
        const values = representation.columnMetrics?.[field];
        if (values) {
            snapshot[field] = values.slice(start, end);
        }
    }
    return snapshot;
}

export function createConsensusSnapshot({
    representation,
    alphabet,
    rawColumnRange,
    includeFrequencies = false,
}) {
    const { start, end } = rawColumnRange;
    const metrics = representation.columnMetrics;
    const metricConfig = getMetricConfig(alphabet);
    const coreSize = metricConfig.coreSize ?? 0;
    const bucketStride = metricConfig.bucketStride ?? coreSize + 1;
    const gapBucketIndex = metricConfig.gapBucketIndex ?? coreSize;
    const columns = new Array(end - start);

    for (let rawColumn = start; rawColumn < end; rawColumn += 1) {
        const countOffset = rawColumn * bucketStride;
        const gapCount = metrics.counts?.[countOffset + gapBucketIndex] ?? 0;
        const nonGapCount = representation.store.totalRows - gapCount;
        const consensusIndex = metrics.consensusIndex?.[rawColumn];
        const consensusGlyph = metrics.consensusTie?.[rawColumn] === 1
            ? "+"
            : (Number.isFinite(consensusIndex) ? alphabet.symbols?.[consensusIndex] ?? null : null);
        const column = {
            rawColumn,
            occupancy: metrics.occupancy?.[rawColumn] ?? 0,
            modalFractionNonGap: metrics.modalFractionNonGap?.[rawColumn] ?? 0,
            informationContentRaw: metrics.informationContentRaw?.[rawColumn] ?? 0,
            nonGapCount,
            consensusGlyph,
        };
        if (includeFrequencies) {
            const residues = [];
            for (let index = 0; index < coreSize; index += 1) {
                const count = metrics.counts?.[countOffset + index] ?? 0;
                if (count === 0) continue;
                residues.push({
                    symbol: alphabet.symbols?.[index] ?? "",
                    count,
                    fraction: nonGapCount > 0 ? count / nonGapCount : 0,
                });
            }
            residues.sort((a, b) => b.count - a.count);
            column.residues = residues;
        }
        columns[rawColumn - start] = column;
    }

    return {
        representationId: representation.id,
        totalRows: representation.store.totalRows,
        totalCols: representation.store.totalCols,
        rawColumnRange: { start, end },
        alphabet: createAlphabetSnapshot(alphabet),
        columns,
    };
}
