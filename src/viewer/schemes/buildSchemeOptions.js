function formatSchemeLabel(key) {
    if (key === "3di") return "3Di";
    if (key === "clustalx") return "ClustalX";
    return key
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .replace(/[-_]+/g, " ")
        .replace(/\b\w/g, (char) => char.toUpperCase());
}

function groupLabel(type) {
    if (type === "columnStatistic") return "Column Statistics";
    if (type === "residueProperty") return "Residue Properties";
    return "Schemes";
}

function groupOrder(type) {
    if (type === "columnStatistic") return 0;
    if (type === "residueProperty") return 1;
    return 2;
}

function representationSuffixes(representations = []) {
    const alphabetCounts = new Map();
    for (const representation of representations) {
        alphabetCounts.set(representation.alphabetShortLabel, (alphabetCounts.get(representation.alphabetShortLabel) ?? 0) + 1);
    }
    return Object.fromEntries(
        representations.map((representation) => [
            representation.id,
            (alphabetCounts.get(representation.alphabetShortLabel) ?? 0) > 1
                ? representation.label
                : representation.alphabetShortLabel,
        ])
    );
}

function addVariant(schemeMap, scheme, variant) {
    const existing = schemeMap.get(scheme.key);
    if (existing) {
        existing.variants.push(variant);
        return;
    }
    schemeMap.set(scheme.key, {
        key: scheme.key,
        label: scheme.label,
        group: scheme.group,
        type: scheme.type,
        variants: [variant],
    });
}

export function buildSchemeOptions({
    schemes,
    representations = [],
    activeAlphabet = null,
    getAlphabet,
    isSupported,
}) {
    const schemeMap = new Map();
    const suffixById = representationSuffixes(representations);
    const schemesFor = (alphabet) => Object.entries(schemes)
        .filter(([key]) => isSupported(key, alphabet))
        .map(([key, scheme]) => ({
            key,
            label: scheme.label ?? formatSchemeLabel(key),
            group: groupLabel(scheme.type),
            type: scheme.type,
        }));

    if (representations.length === 0) {
        for (const scheme of schemesFor(activeAlphabet)) {
            addVariant(schemeMap, scheme, {
                representationId: null,
                alphabetId: activeAlphabet?.id ?? null,
                alphabetShortLabel: activeAlphabet?.shortLabel ?? activeAlphabet?.label ?? null,
                displayLabel: scheme.label,
            });
        }
    } else {
        const multiple = representations.length > 1;
        for (const representation of representations) {
            for (const scheme of schemesFor(getAlphabet(representation.alphabetId))) {
                addVariant(schemeMap, scheme, {
                    representationId: representation.id,
                    alphabetId: representation.alphabetId,
                    alphabetShortLabel: representation.alphabetShortLabel,
                    displayLabel: multiple
                        ? `${scheme.label} (${suffixById[representation.id] ?? representation.alphabetShortLabel})`
                        : scheme.label,
                });
            }
        }
    }

    return [...schemeMap.values()].sort((a, b) =>
        groupOrder(a.type) - groupOrder(b.type)
        || a.label.localeCompare(b.label)
    );
}
