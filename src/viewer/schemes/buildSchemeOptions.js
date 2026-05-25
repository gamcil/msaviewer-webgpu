function formatSchemeLabel(key) {
    if (key === "3di") return "3Di";
    if (key === "clustalx") return "ClustalX";
    return key
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .replace(/[-_]+/g, " ")
        .replace(/\b\w/g, (char) => char.toUpperCase());
}

function groupLabel(mode) {
    if (mode === "column-statistic") return "Column Statistics";
    if (mode === "residue-property") return "Residue Properties";
    if (mode === "scalar-column") return "Custom Schemes";
    return "Schemes";
}

function groupOrder(mode) {
    if (mode === "column-statistic") return 0;
    if (mode === "residue-property") return 1;
    if (mode === "scalar-column") return 2;
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
        mode: scheme.mode,
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
        .filter(([key, scheme]) => scheme.scope === "viewer" || isSupported(key, alphabet))
        .map(([key, scheme]) => ({
            key,
            label: scheme.label ?? formatSchemeLabel(key),
            group: groupLabel(scheme.mode),
            mode: scheme.mode,
            scope: scheme.scope,
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
        for (const scheme of schemesFor(activeAlphabet).filter((scheme) => scheme.scope === "viewer")) {
            addVariant(schemeMap, scheme, {
                representationId: null,
                alphabetId: null,
                alphabetShortLabel: null,
                displayLabel: scheme.label,
            });
        }
        for (const representation of representations) {
            for (const scheme of schemesFor(getAlphabet(representation.alphabetId)).filter((scheme) => scheme.scope !== "viewer")) {
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
        groupOrder(a.mode) - groupOrder(b.mode)
        || a.label.localeCompare(b.label)
    );
}
