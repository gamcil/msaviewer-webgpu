export function buildConsensusRenderColumns(sourceColumns = [], {
    resolveLetterColor = null,
} = {}) {
    return sourceColumns.map((columnData) => {
        const histogramFractionWithGaps =
            (columnData.modalFractionNonGap ?? 0) * (columnData.occupancy ?? 0);
        const histogramFractionWithoutGaps = columnData.modalFractionNonGap ?? 0;
        const informationFactorWithGaps =
            (columnData.informationContentRaw ?? 0) * (columnData.occupancy ?? 0);
        const informationFactorWithoutGaps = columnData.informationContentRaw ?? 0;
        const logoLetters = (columnData.letters ?? []).map((letter) => ({
            glyph: letter.glyph,
            color: resolveLetterColor ? resolveLetterColor(letter.glyph, letter.color) : letter.color,
            logoFraction: letter.logoFraction ?? 0,
        }));
        const topLetter = logoLetters[0]
            ? {
                glyph: logoLetters[0].glyph,
                color: logoLetters[0].color,
                logoFraction: logoLetters[0].logoFraction,
            }
            : null;

        return {
            consensusGlyph: columnData.consensusGlyph ?? null,
            histogramFractionWithGaps,
            histogramFractionWithoutGaps,
            informationFactorWithGaps,
            informationFactorWithoutGaps,
            logoLetters,
            topLetter,
        };
    });
}

export function collectConsensusLogoGlyphPairs(renderColumns = []) {
    const glyphColorPairs = [];
    const seen = new Set();
    for (const columnData of renderColumns) {
        for (const letter of columnData.logoLetters ?? []) {
            if (!letter?.glyph) continue;
            const key = `${letter.glyph}::${letter.color ?? "#333"}`;
            if (seen.has(key)) continue;
            seen.add(key);
            glyphColorPairs.push({
                glyph: letter.glyph,
                color: letter.color ?? "#333",
            });
        }
    }
    return glyphColorPairs;
}

export function buildVisibleConsensusColumns(renderColumns, visibleStart, visibleEnd, columnVisibility) {
    if (!renderColumns?.length) {
        return [];
    }
    const columns = [];
    const visibleToRaw = columnVisibility?.visibleToRaw ?? null;
    for (let visibleCol = visibleStart; visibleCol < visibleEnd; visibleCol += 1) {
        const rawCol = visibleToRaw?.[visibleCol] ?? visibleCol;
        const columnData = renderColumns[rawCol];
        if (columnData) {
            columns.push(columnData);
        }
    }
    return columns;
}

export function buildConsensusHistogramBars(columns, { includeGaps, plotHeightPx }) {
    return columns.map((columnData, index) => ({
        column: index,
        fraction: includeGaps
            ? columnData.histogramFractionWithGaps
            : columnData.histogramFractionWithoutGaps,
        baseY: plotHeightPx,
        plotHeight: plotHeightPx,
    }));
}

export function buildConsensusLogoColumns(columns, { includeGaps, plotHeightPx, logoHeightMode }) {
    return columns.map((columnData, index) => {
        const modalFraction = includeGaps
            ? columnData.histogramFractionWithGaps
            : columnData.histogramFractionWithoutGaps;
        let stackHeightPx = plotHeightPx * modalFraction;
        if (logoHeightMode === "full") {
            stackHeightPx = plotHeightPx;
        } else if (logoHeightMode === "information") {
            const informationContent = includeGaps
                ? columnData.informationFactorWithGaps
                : columnData.informationFactorWithoutGaps;
            stackHeightPx = plotHeightPx * informationContent;
        }
        const letters = columnData.logoLetters.map((letter) => ({
            glyph: letter.glyph,
            color: letter.color,
            heightPx: stackHeightPx * letter.logoFraction,
        }));
        return { column: index, stackHeightPx, letters };
    });
}

export function buildConsensusGlyphs(columns, { consensusFillStyle, heightPx }) {
    const glyphs = [];
    for (let i = 0; i < columns.length; i += 1) {
        const consensusGlyph = columns[i].consensusGlyph;
        if (!consensusGlyph) continue;
        glyphs.push({
            column: i,
            glyph: consensusGlyph,
            color: columns[i].topLetter?.color ?? consensusFillStyle,
            y: heightPx,
        });
    }
    return glyphs;
}
