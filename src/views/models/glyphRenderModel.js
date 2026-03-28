import { buildProjectedVisibleColumns } from "./visibleColumnModel.js";

export function buildVisibleGlyphs(data, {
    visibleStart,
    visibleEnd,
    columnVisibility,
}) {
    if (!data?.length) {
        return [];
    }

    const glyphsByRawColumn = new Map();
    for (const item of data) {
        if (item?.col == null) continue;
        const items = glyphsByRawColumn.get(item.col) ?? [];
        items.push(item);
        glyphsByRawColumn.set(item.col, items);
    }

    const glyphs = [];
    buildProjectedVisibleColumns(visibleStart, visibleEnd, columnVisibility, (rawCol, column) => {
        const items = glyphsByRawColumn.get(rawCol);
        if (!items?.length) {
            return null;
        }
        for (const item of items) {
            glyphs.push({
                column,
                glyph: item.glyph,
                color: item.color ?? "#333",
            });
        }
        return null;
    });
    return glyphs;
}
