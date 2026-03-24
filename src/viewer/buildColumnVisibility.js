export function buildColumnVisibility({
    alignmentStore,
    columnMetrics,
    masking = {},
}) {
    const totalCols = alignmentStore?.totalCols ?? 0;
    const hideInsertionColumns = masking.hideInsertionColumns === true;
    const gapThreshold = Number.isFinite(masking.gapThreshold) ? masking.gapThreshold : null;
    const isInsertionColumn = alignmentStore?.columnMetadata?.isInsertionColumn ?? null;
    const occupancy = columnMetrics?.occupancy ?? null;

    const visible = new Uint8Array(totalCols);
    const rawToVisible = new Int32Array(totalCols);
    rawToVisible.fill(-1);

    let visibleCount = 0;
    for (let rawCol = 0; rawCol < totalCols; rawCol += 1) {
        let isVisible = true;

        if (hideInsertionColumns && isInsertionColumn?.[rawCol]) {
            isVisible = false;
        }

        if (isVisible && gapThreshold != null && occupancy) {
            const gapFraction = 1 - (occupancy[rawCol] ?? 0);
            if (gapFraction > gapThreshold) {
                isVisible = false;
            }
        }

        if (!isVisible) continue;
        visible[rawCol] = 1;
        rawToVisible[rawCol] = visibleCount;
        visibleCount += 1;
    }

    const visibleToRaw = new Uint32Array(visibleCount);
    for (let rawCol = 0; rawCol < totalCols; rawCol += 1) {
        const visibleCol = rawToVisible[rawCol];
        if (visibleCol >= 0) {
            visibleToRaw[visibleCol] = rawCol;
        }
    }

    let mode = "none";
    if (hideInsertionColumns && gapThreshold != null) {
        mode = "combined";
    } else if (hideInsertionColumns) {
        mode = "a3m-insertions";
    } else if (gapThreshold != null) {
        mode = "gap-threshold";
    }

    let signature = 2166136261;
    for (let i = 0; i < visibleToRaw.length; i += 1) {
        signature ^= visibleToRaw[i];
        signature = Math.imul(signature, 16777619) >>> 0;
    }

    return {
        visible,
        rawToVisible,
        visibleToRaw,
        visibleCount,
        mode,
        signature,
    };
}
