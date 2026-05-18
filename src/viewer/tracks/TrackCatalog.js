import { normalizeTrackDefinitions } from "./trackDefinitionSchema.js";

function bindTrackReference(ref, representation) {
    if (!ref) return ref;
    return {
        ...ref,
        representation: ref.representation == null || ref.representation === "active"
            ? representation
            : ref.representation,
    };
}

function bindTrackDefinition(definition, representation) {
    return {
        ...definition,
        id: buildTrackBindingId({
            trackId: definition.id,
            representation,
        }),
        source: bindTrackReference(definition.source, representation),
        coloring: bindTrackReference(definition.coloring, representation),
        lanes: definition.lanes.map((lane) => ({
            ...lane,
            layers: lane.layers.map((layer) => ({
                ...layer,
                source: bindTrackReference(layer.source, representation),
                coloring: bindTrackReference(layer.coloring, representation),
            })),
        })),
    };
}

export function buildTrackBindingId({ trackId, representation = "active" }) {
    return `${trackId}::${representation}`;
}

function dedupeTrackBindings(bindings) {
    const next = new Map();
    for (const binding of bindings) {
        if (!binding) continue;
        next.set(buildTrackBindingId(binding), binding);
    }
    return [...next.values()];
}

function supportedTrackReps(definition, representations = []) {
    const supportedAlphabets = definition.supports?.alphabets ?? null;
    return representations.filter((representation) =>
        !Array.isArray(supportedAlphabets) || supportedAlphabets.includes(representation.alphabetId)
    );
}

function getTrackVariants(definition, representations = []) {
    if (definition.supports?.shared === true) {
        return [{ trackId: definition.id, representation: definition.source?.representation ?? "active" }];
    }
    return supportedTrackReps(definition, representations)
        .filter((representation) => representation.id != null)
        .map((representation) => ({ trackId: definition.id, representation: representation.id }));
}

function isTrackVariantEnabled(variant, {
    defaults,
    activeId,
    variantOverrides = new Map(),
}) {
    const override = variantOverrides.get(buildTrackBindingId(variant));
    if (override) {
        return override.enabled !== false;
    }
    if (defaults === "none") {
        return false;
    }
    if (defaults === "all-supported") {
        return true;
    }
    if (defaults === "active-only") {
        if (variant.representation === "active") {
            return activeId != null;
        }
        return variant.representation === activeId;
    }
    return false;
}

function normalizeTrackBinding(track) {
    if (!track) return null;
    return typeof track === "string"
        ? { trackId: track, representation: "active" }
        : {
            trackId: track.trackId,
            representation: track.representation ?? "active",
            enabled: track.enabled,
        };
}

function withTrackOverride(variants = [], binding, enabled) {
    const nextVariants = [...variants];
    const existingIndex = nextVariants.findIndex((variant) =>
        variant.trackId === binding.trackId
        && (variant.representation ?? "active") === binding.representation
    );
    const nextVariant = {
        trackId: binding.trackId,
        representation: binding.representation,
        enabled: enabled === true,
    };
    if (existingIndex >= 0) {
        nextVariants[existingIndex] = nextVariant;
    } else {
        nextVariants.push(nextVariant);
    }
    return nextVariants;
}

function representationSuffixes(representations = []) {
    const alphabetCounts = new Map();
    const alphabetLabel = (representation) =>
        representation.alphabetShortLabel ?? representation.alphabetLabel ?? representation.alphabetId;
    for (const representation of representations) {
        const label = alphabetLabel(representation);
        alphabetCounts.set(label, (alphabetCounts.get(label) ?? 0) + 1);
    }
    return Object.fromEntries(
        representations.map((representation) => {
            const label = alphabetLabel(representation);
            return [
                representation.id,
                (alphabetCounts.get(label) ?? 0) > 1
                    ? representation.label
                    : label,
            ];
        })
    );
}

export class TrackCatalog {
    constructor({
        builtInDefinitions = {},
        userDefinitions = [],
        trackDisplay = {},
        representations = [],
        activeId = null,
    } = {}) {
        this.trackDisplay = trackDisplay;
        this.representations = representations;
        this.activeId = activeId;
        this.suffixById = representationSuffixes(representations);
        this.definitions = normalizeTrackDefinitions({
            builtInDefinitions,
            userDefinitions,
            order: trackDisplay.order,
        });
        this.variantOverrides = new Map(
            (trackDisplay.variants ?? [])
                .map((variant) => this.#resolveBinding(variant))
                .filter(Boolean)
                .map((variant) => [buildTrackBindingId(variant), variant])
        );
        this.enabledBindings = dedupeTrackBindings(
            this.definitions.flatMap((definition) =>
                getTrackVariants(definition, representations).filter((variant) =>
                    isTrackVariantEnabled(variant, {
                        defaults: trackDisplay.defaults,
                        activeId,
                        variantOverrides: this.variantOverrides,
                    })
                )
            )
        );
        this.tracks = this.#buildTracks();
    }

    #definition(id) {
        return this.definitions.find((definition) => definition.id === id) ?? null;
    }

    #representation(id) {
        return this.representations.find((representation) => representation.id === id) ?? null;
    }

    #resolveBinding(track) {
        const binding = normalizeTrackBinding(track);
        if (!binding) return null;
        const definition = this.#definition(binding.trackId);
        if (!definition) return null;
        const representation = binding.representation === "active" && definition.supports?.shared !== true
            ? this.activeId
            : binding.representation;
        if (!representation) return null;
        return {
            trackId: definition.id,
            representation,
            enabled: binding.enabled !== false,
        };
    }

    #buildTracks() {
        if (this.representations.length === 0) {
            return [];
        }
        return this.definitions.map((definition) => {
            const variants = getTrackVariants(definition, this.representations).map((variant) => ({
                ...variant,
                label: null,
                enabled: isTrackVariantEnabled(variant, {
                    defaults: this.trackDisplay.defaults,
                    activeId: this.activeId,
                    variantOverrides: this.variantOverrides,
                }),
            }));
            if (variants.length > 1) {
                for (const variant of variants) {
                    variant.label = variant.representation === "active" ? null : this.suffixById[variant.representation] ?? null;
                }
            }
            return {
                id: definition.id,
                label: definition.label,
                variants,
            };
        });
    }

    resolveDefinition(binding) {
        const concrete = this.#resolveBinding(binding);
        const definition = this.#definition(concrete?.trackId);
        if (!definition) return null;
        const repId = concrete.representation;
        const representation = repId === "active" ? null : this.#representation(repId);
        if (
            representation
            && Array.isArray(definition.supports?.alphabets)
            && !definition.supports.alphabets.includes(representation.alphabetId)
        ) {
            return null;
        }
        const resolved = bindTrackDefinition(definition, repId);
        if (definition.supports?.shared !== true && repId !== "active") {
            const suffix = this.suffixById[repId];
            if (suffix) {
                resolved.sublabel = suffix;
            }
        }
        return resolved;
    }

    toggle(track, enabled) {
        const binding = this.#resolveBinding(track);
        if (!binding) return null;
        const variants = this.tracks.flatMap((availableTrack) => availableTrack.variants);
        const matchingVariant = variants.find((variant) =>
            variant.trackId === binding.trackId
            && variant.representation === binding.representation
        );
        if (!matchingVariant) return null;

        const nonActive = enabled === true
            && this.trackDisplay.defaults === "active-only"
            && binding.representation !== "active"
            && binding.representation !== this.activeId;
        if (nonActive) {
            return {
                defaults: "none",
                variants: variants.map((variant) => ({
                    trackId: variant.trackId,
                    representation: variant.representation,
                    enabled:
                        variant.trackId === binding.trackId
                        && variant.representation === binding.representation
                            ? true
                            : variant.enabled === true,
                })),
            };
        }

        return {
            defaults: this.trackDisplay.defaults,
            variants: withTrackOverride([...this.variantOverrides.values()], binding, enabled),
        };
    }
}
