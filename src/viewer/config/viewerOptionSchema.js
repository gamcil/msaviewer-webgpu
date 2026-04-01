import { DEFAULT_VIEWER_OPTIONS } from "./defaultViewerOptions.js";
import { normalizeRepresentationInputs } from "../representations/representationInputSchema.js";

function isObject(value) {
    return value != null && typeof value === "object" && !Array.isArray(value);
}

function mergeObjects(base, override) {
    if (!isObject(override)) {
        return { ...base };
    }
    const result = { ...base };
    for (const [key, value] of Object.entries(override)) {
        if (isObject(value) && isObject(base[key])) {
            result[key] = mergeObjects(base[key], value);
        } else {
            result[key] = value;
        }
    }
    return result;
}

export function mergeViewerOptions(base, override) {
    return mergeObjects(base, override);
}

function normalizeVisibilityOption(value, defaults) {
    if (value === false) {
        return { ...defaults, visible: false };
    }
    if (value === true || value == null) {
        return { ...defaults };
    }
    if (isObject(value)) {
        return mergeObjects(defaults, value);
    }
    return { ...defaults };
}

function normalizeTrackDefinitions(definitions = {}) {
    if (!isObject(definitions)) {
        return {};
    }
    const normalized = {};
    for (const [id, definition] of Object.entries(definitions)) {
        if (!isObject(definition)) continue;
        normalized[id] = mergeObjects({}, definition);
    }
    return normalized;
}

function normalizeTrackDefaults(value) {
    return value === "none" || value === "all-supported" || value === "active-only"
        ? value
        : "active-only";
}

function normalizeTrackVariants(variants = []) {
    if (!Array.isArray(variants)) {
        return [];
    }
    return variants
        .filter((variant) => variant && typeof variant === "object" && typeof variant.trackId === "string" && variant.trackId.length > 0)
        .map((variant) => ({
            trackId: variant.trackId,
            representation: variant.representation ?? "active",
            alphabetId: variant.alphabetId ?? null,
            enabled: variant.enabled !== false,
        }));
}

export function deriveViewerOptions(options) {
    return {
        visibility: {
            header: options.layout.header.visible !== false,
            ruler: options.layout.ruler.visible !== false,
            minimap: options.layout.minimap.visible !== false,
            tracks: options.layout.tracks.visible !== false,
        },
        layout: {
            headerWidth: options.layout.header.width,
            minimapHeight: options.layout.minimap.height,
            ruler: {
                tickInterval: options.layout.ruler.tickInterval,
                height: options.layout.ruler.height,
            },
            tracks: {
                labelWidth: options.layout.tracks.labelWidth,
            },
            cell: {
                width: options.layout.cell.width,
                height: options.layout.cell.height,
            },
        },
        typography: {
            uiFontFamily: options.theme.typography.uiFontFamily,
            uiFontSize: options.theme.typography.uiFontSize,
            headerFontFamily: options.theme.typography.headerFontFamily,
            headerFontSize: options.theme.typography.headerFontSize,
        },
        cssVariables: {
            "--msa-ruler-height": `${options.layout.ruler.height}px`,
            "--msa-minimap-height": `${options.layout.minimap.height}px`,
            "--msa-header-width": `${options.layout.header.width}px`,
            "--msa-track-label-width": `${options.layout.tracks.labelWidth}px`,
            "--msa-ui-font-family": options.theme.typography.uiFontFamily,
            "--msa-ui-font-size": `${options.theme.typography.uiFontSize}px`,
        },
        views: {
            header: {
                width: options.layout.header.width,
                fontFamily: options.theme.typography.headerFontFamily,
                fontSize: options.theme.typography.headerFontSize,
            },
            ruler: {
                tickInterval: options.layout.ruler.tickInterval,
                height: options.layout.ruler.height,
            },
            tracks: {
                labelWidth: options.layout.tracks.labelWidth,
            },
        },
    };
}

export function normalizeViewerOptions(rawOptions = {}) {
    const legacyLayout = isObject(rawOptions.layout) ? rawOptions.layout : {};
    const normalizedLayout = {
        header: normalizeVisibilityOption(legacyLayout.header, DEFAULT_VIEWER_OPTIONS.layout.header),
        ruler: normalizeVisibilityOption(legacyLayout.ruler, DEFAULT_VIEWER_OPTIONS.layout.ruler),
        minimap: normalizeVisibilityOption(legacyLayout.minimap, DEFAULT_VIEWER_OPTIONS.layout.minimap),
        tracks: normalizeVisibilityOption(legacyLayout.tracks, DEFAULT_VIEWER_OPTIONS.layout.tracks),
        cell: mergeObjects(DEFAULT_VIEWER_OPTIONS.layout.cell, legacyLayout.cell),
    };

    normalizedLayout.header.width = Math.max(60, normalizedLayout.header.width ?? DEFAULT_VIEWER_OPTIONS.layout.header.width);
    normalizedLayout.ruler.height = Math.max(20, normalizedLayout.ruler.height ?? DEFAULT_VIEWER_OPTIONS.layout.ruler.height);
    normalizedLayout.ruler.tickInterval = Math.max(1, normalizedLayout.ruler.tickInterval ?? DEFAULT_VIEWER_OPTIONS.layout.ruler.tickInterval);
    normalizedLayout.minimap.height = Math.max(20, normalizedLayout.minimap.height ?? DEFAULT_VIEWER_OPTIONS.layout.minimap.height);
    normalizedLayout.tracks.labelWidth = Math.max(72, normalizedLayout.tracks.labelWidth ?? DEFAULT_VIEWER_OPTIONS.layout.tracks.labelWidth);
    normalizedLayout.cell.width = Math.max(1, normalizedLayout.cell.width ?? DEFAULT_VIEWER_OPTIONS.layout.cell.width);
    normalizedLayout.cell.height = Math.max(1, normalizedLayout.cell.height ?? DEFAULT_VIEWER_OPTIONS.layout.cell.height);

    const normalizedTheme = mergeObjects(DEFAULT_VIEWER_OPTIONS.theme, rawOptions.theme);
    normalizedTheme.typography.uiFontSize = Math.max(1, normalizedTheme.typography.uiFontSize);
    normalizedTheme.typography.headerFontSize = Math.max(1, normalizedTheme.typography.headerFontSize);

    const normalizedBehavior = mergeObjects(DEFAULT_VIEWER_OPTIONS.behavior, rawOptions.behavior);
    const normalizedRendering = mergeObjects(DEFAULT_VIEWER_OPTIONS.rendering, rawOptions.rendering);
    const normalizedTracks = mergeObjects(DEFAULT_VIEWER_OPTIONS.tracks, rawOptions.tracks);
    normalizedTracks.definitions = normalizeTrackDefinitions(rawOptions.tracks?.definitions);
    normalizedTracks.defaults = normalizeTrackDefaults(rawOptions.tracks?.defaults ?? normalizedTracks.defaults);
    normalizedTracks.variants = normalizeTrackVariants(rawOptions.tracks?.variants ?? normalizedTracks.variants);

    const normalized = {
        alphabet: rawOptions.alphabet ?? DEFAULT_VIEWER_OPTIONS.alphabet,
        data: {
            representations: Array.isArray(rawOptions.data?.representations) && rawOptions.data.representations.length > 0
                ? normalizeRepresentationInputs(rawOptions.data.representations)
                : DEFAULT_VIEWER_OPTIONS.data.representations,
            activeRepresentationId: rawOptions.data?.activeRepresentationId ?? DEFAULT_VIEWER_OPTIONS.data.activeRepresentationId,
        },
        layout: normalizedLayout,
        theme: normalizedTheme,
        tracks: normalizedTracks,
        behavior: normalizedBehavior,
        rendering: normalizedRendering,
    };

    return normalized;
}
