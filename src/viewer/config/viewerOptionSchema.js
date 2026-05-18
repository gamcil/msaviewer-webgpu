import { DEFAULT_VIEWER_OPTIONS } from "./defaultViewerOptions.js";
import { normalizeRenderingBackend } from "../backends/backendRuntime.js";
import { isPlainObject, mergeObjects } from "../../util.js";
import { SCHEMES } from "../../schemes/registry.js";

const THEME_MODES = new Set(["auto", "dark", "light"]);
const SELECTION_MODES = new Set(["cell", "column", "row"]);
const TRACK_DEFAULTS = new Set(["active-only", "all-supported", "none"]);

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
    if (isPlainObject(value)) {
        return mergeObjects(defaults, value);
    }
    return { ...defaults };
}

function normalizeTracks(tracks = []) {
    if (!Array.isArray(tracks)) {
        return [];
    }
    return tracks
        .filter(isPlainObject)
        .map((track) => mergeObjects({}, track));
}

function normalizeTrackDefaults(value) {
    return TRACK_DEFAULTS.has(value) ? value : DEFAULT_VIEWER_OPTIONS.trackDisplay.defaults;
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
            minimap: {
                fullWidth: options.layout.minimap.fullWidth === true,
            },
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
            "--msa-minimap-offset-left": (options.layout.minimap.fullWidth === true || options.layout.header.visible === false)
                ? "0px"
                : `${options.layout.header.width}px`,
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
    const rawLayout = isPlainObject(rawOptions.layout) ? rawOptions.layout : {};
    const normalizedLayout = {
        header: normalizeVisibilityOption(rawLayout.header, DEFAULT_VIEWER_OPTIONS.layout.header),
        ruler: normalizeVisibilityOption(rawLayout.ruler, DEFAULT_VIEWER_OPTIONS.layout.ruler),
        minimap: normalizeVisibilityOption(rawLayout.minimap, DEFAULT_VIEWER_OPTIONS.layout.minimap),
        tracks: normalizeVisibilityOption(rawLayout.tracks, DEFAULT_VIEWER_OPTIONS.layout.tracks),
        cell: mergeObjects(DEFAULT_VIEWER_OPTIONS.layout.cell, rawLayout.cell),
    };

    normalizedLayout.header.width = Math.max(60, normalizedLayout.header.width ?? DEFAULT_VIEWER_OPTIONS.layout.header.width);
    normalizedLayout.ruler.height = Math.max(20, normalizedLayout.ruler.height ?? DEFAULT_VIEWER_OPTIONS.layout.ruler.height);
    normalizedLayout.ruler.tickInterval = Math.max(1, normalizedLayout.ruler.tickInterval ?? DEFAULT_VIEWER_OPTIONS.layout.ruler.tickInterval);
    normalizedLayout.minimap.height = Math.max(20, normalizedLayout.minimap.height ?? DEFAULT_VIEWER_OPTIONS.layout.minimap.height);
    normalizedLayout.minimap.fullWidth = normalizedLayout.minimap.fullWidth === true;
    normalizedLayout.tracks.labelWidth = Math.max(72, normalizedLayout.tracks.labelWidth ?? DEFAULT_VIEWER_OPTIONS.layout.tracks.labelWidth);
    normalizedLayout.cell.width = Math.max(1, normalizedLayout.cell.width ?? DEFAULT_VIEWER_OPTIONS.layout.cell.width);
    normalizedLayout.cell.height = Math.max(1, normalizedLayout.cell.height ?? DEFAULT_VIEWER_OPTIONS.layout.cell.height);

    const normalizedTheme = mergeObjects(DEFAULT_VIEWER_OPTIONS.theme, rawOptions.theme);
    normalizedTheme.typography = mergeObjects(DEFAULT_VIEWER_OPTIONS.theme.typography, normalizedTheme.typography);
    normalizedTheme.mode = THEME_MODES.has(normalizedTheme.mode) ? normalizedTheme.mode : DEFAULT_VIEWER_OPTIONS.theme.mode;
    normalizedTheme.typography.uiFontSize = Math.max(1, normalizedTheme.typography.uiFontSize);
    normalizedTheme.typography.headerFontSize = Math.max(1, normalizedTheme.typography.headerFontSize);

    const normalizedBehavior = mergeObjects(DEFAULT_VIEWER_OPTIONS.behavior, rawOptions.behavior);
    normalizedBehavior.masking = mergeObjects(DEFAULT_VIEWER_OPTIONS.behavior.masking, normalizedBehavior.masking);
    normalizedBehavior.selectionMode = SELECTION_MODES.has(normalizedBehavior.selectionMode)
        ? normalizedBehavior.selectionMode
        : DEFAULT_VIEWER_OPTIONS.behavior.selectionMode;
    normalizedBehavior.masking.hideInsertionColumns = normalizedBehavior.masking.hideInsertionColumns === true;
    normalizedBehavior.masking.gapThreshold = Number.isFinite(normalizedBehavior.masking.gapThreshold)
        ? normalizedBehavior.masking.gapThreshold
        : null;
    const normalizedInteractions = mergeObjects(DEFAULT_VIEWER_OPTIONS.interactions, rawOptions.interactions);
    const normalizedRendering = mergeObjects(DEFAULT_VIEWER_OPTIONS.rendering, rawOptions.rendering);
    normalizedRendering.backend = normalizeRenderingBackend(rawOptions.rendering?.backend ?? normalizedRendering.backend);
    normalizedRendering.scheme = SCHEMES[normalizedRendering.scheme]
        ? normalizedRendering.scheme
        : DEFAULT_VIEWER_OPTIONS.rendering.scheme;
    normalizedRendering.schemeSourceRepresentationId = rawOptions.rendering?.schemeSourceRepresentationId ?? normalizedRendering.schemeSourceRepresentationId ?? null;
    const normalizedTrackDisplay = mergeObjects(DEFAULT_VIEWER_OPTIONS.trackDisplay, rawOptions.trackDisplay);
    normalizedTrackDisplay.defaults = normalizeTrackDefaults(rawOptions.trackDisplay?.defaults ?? normalizedTrackDisplay.defaults);
    normalizedTrackDisplay.variants = normalizeTrackVariants(rawOptions.trackDisplay?.variants ?? normalizedTrackDisplay.variants);
    normalizedTrackDisplay.order = Array.isArray(rawOptions.trackDisplay?.order) ? [...rawOptions.trackDisplay.order] : null;

    return {
        alphabet: rawOptions.alphabet ?? DEFAULT_VIEWER_OPTIONS.alphabet,
        layout: normalizedLayout,
        theme: normalizedTheme,
        tracks: normalizeTracks(rawOptions.tracks),
        trackDisplay: normalizedTrackDisplay,
        behavior: normalizedBehavior,
        interactions: normalizedInteractions,
        rendering: normalizedRendering,
    };
}
