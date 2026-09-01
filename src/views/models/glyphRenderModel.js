import { buildProjectedVisibleColumns } from "./visibleColumnModel.js";

export function buildGlyphsByRawColumn(data) {
    const glyphsByRawColumn = new Map();
    if (!data?.length) return glyphsByRawColumn;
    for (const item of data) {
        if (item?.col == null) continue;
        const items = glyphsByRawColumn.get(item.col) ?? [];
        items.push(item);
        glyphsByRawColumn.set(item.col, items);
    }
    return glyphsByRawColumn;
}

export function buildVisibleGlyphs(glyphsByRawColumn, {
    visibleStart,
    visibleEnd,
    columnVisibility,
}) {
    if (!glyphsByRawColumn?.size) {
        return [];
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
