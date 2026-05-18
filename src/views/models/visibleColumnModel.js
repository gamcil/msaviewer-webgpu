export function buildProjectedVisibleColumns(visibleStart, visibleEnd, columnVisibility, projector) {
    const columns = [];
    const visibleToRaw = columnVisibility?.visibleToRaw ?? null;
    for (let visibleCol = visibleStart; visibleCol < visibleEnd; visibleCol += 1) {
        const rawCol = visibleToRaw?.[visibleCol] ?? visibleCol;
        const column = visibleCol - visibleStart;
        const projected = projector(rawCol, column, visibleCol);
        if (projected != null) {
            columns.push(projected);
        }
    }
    return columns;
}
