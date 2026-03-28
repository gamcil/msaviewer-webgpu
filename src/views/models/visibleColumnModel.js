export function forEachProjectedVisibleColumn(visibleStart, visibleEnd, columnVisibility, callback) {
    const visibleToRaw = columnVisibility?.visibleToRaw ?? null;
    for (let visibleCol = visibleStart; visibleCol < visibleEnd; visibleCol += 1) {
        const rawCol = visibleToRaw?.[visibleCol] ?? visibleCol;
        callback(rawCol, visibleCol - visibleStart, visibleCol);
    }
}

export function buildProjectedVisibleColumns(visibleStart, visibleEnd, columnVisibility, projector) {
    const columns = [];
    forEachProjectedVisibleColumn(visibleStart, visibleEnd, columnVisibility, (rawCol, column, visibleCol) => {
        const projected = projector(rawCol, column, visibleCol);
        if (projected != null) {
            columns.push(projected);
        }
    });
    return columns;
}
