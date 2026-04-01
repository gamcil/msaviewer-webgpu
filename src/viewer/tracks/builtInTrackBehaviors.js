function buildConsensusTooltip({ rawColumn, track }) {
    const columnData = track.data?.columns?.[rawColumn];
    if (!columnData) return null;
    const lines = [`Column: ${rawColumn + 1}`];
    if (columnData.consensusGlyph) {
        lines.push(`Consensus: ${columnData.consensusGlyph}`);
    }
    const residueLines = (columnData.letters ?? [])
        .map((letter) => ({
            glyph: letter.glyph,
            percent: Math.round((letter.logoFraction ?? 0) * 100),
        }))
        .filter((letter) => Number.isFinite(letter.percent) && letter.percent > 0)
        .map((letter) => `${letter.glyph} ${letter.percent}%`);
    return {
        title: track.label,
        subtitle: track.sublabel,
        lines: residueLines.length > 0 ? [...lines, ...residueLines] : lines,
    };
}

function buildConservationGlyph({ value }) {
    if (value === 11) return { glyph: "*" };
    if (value === 10) return { glyph: "+" };
    return { glyph: value };
}

export function resolveBuiltInTrackTooltip(tooltip, helpers = {}) {
    if (typeof tooltip === "function" || tooltip == null) {
        return tooltip;
    }
    if (tooltip === "consensus") {
        return buildConsensusTooltip;
    }
    if (tooltip === "conservation") {
        return (context) => helpers.buildConservationTooltip?.(context) ?? null;
    }
    return null;
}

export function resolveBuiltInTrackLayer(layer) {
    if (!layer || typeof layer.getGlyph === "function") {
        return layer;
    }
    if (layer.getGlyph === "conservationSymbols") {
        return {
            ...layer,
            getGlyph: buildConservationGlyph,
        };
    }
    return layer;
}
