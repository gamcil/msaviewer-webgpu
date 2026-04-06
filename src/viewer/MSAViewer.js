/* Handles rendering of the MSA alignment and headers, as well as scroll synchronization between them. */
import { ViewerState } from "./state/ViewerState.js";
import { HeaderView } from "../views/HeaderView.js";
import { AlignmentView } from "../views/AlignmentView.js";
import { RulerView } from "../views/RulerView.js";
import {
    SCHEMES,
} from "../schemes/registry.js";
import { loadImageBitmap } from "../util.js";
import { parseFastaAlignment } from "../alignment/fasta.js";
import { parseA3MAlignment } from "../alignment/a3m.js";
import { TileCache } from "../alignment/tiledStorage.js";
import clustalxComputeShaderCode from "../graphics/shaders/clustalx.compute.wgsl?raw";
import pidComputeShaderCode from "../graphics/shaders/pident.compute.wgsl?raw";
import blosumComputeShaderCode from "../graphics/shaders/blosum.compute.wgsl?raw";
import { MinimapView } from "../views/MinimapView.js";
import { GpuResourceManager } from "../graphics/GpuResourceManager.js";
import { PipelineRegistry } from "../graphics/PipelineRegistry.js";
import { TrackStackView } from "../views/TrackStackView.js";
import { TrackStateBuilder } from "./TrackStateBuilder.js";
import { SchemePolicy } from "./SchemePolicy.js";
import { ViewportController } from "./controllers/ViewportController.js";
import { SelectionController } from "./controllers/SelectionController.js";
import { MotifController } from "./controllers/MotifController.js";
import { defaultAlphabetRegistry } from "../alphabets/index.js";
import { buildColumnVisibility } from "./buildColumnVisibility.js";
import { deriveViewerOptions, mergeViewerOptions, normalizeViewerOptions } from "./config/viewerOptionSchema.js";
import { normalizeRepresentationInput, normalizeRepresentationInputs } from "./representations/representationInputSchema.js";
import { BUILT_IN_TRACK_DEFINITIONS } from "./tracks/builtInTrackDefinitions.js";
import { normalizeTrackDefinitions } from "./tracks/trackDefinitionSchema.js";
import { createTrackFromDefinition } from "./tracks/createTrackFromDefinition.js";
import { exportSelectionAsFasta as buildSelectionFasta } from "./export/exportSelectionAsFasta.js";
import {
    createAlignmentSurface,
    createBackendMinimapController,
    createBackendServices,
    resolveRenderingBackendKind,
} from "./backends/backendRuntime.js";

function writeThemeUniformBuffer(device, buffer, darkMode, colorScheme) {
    const data = new Uint32Array([darkMode, colorScheme]);
    device.queue.writeBuffer(buffer, 0, data);
}

function formatSchemeLabel(key) {
    if (key === "3di") return "3Di";
    if (key === "clustalx") return "ClustalX";
    return key
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .replace(/[-_]+/g, " ")
        .replace(/\b\w/g, (char) => char.toUpperCase());
}

function getSchemeGroupLabel(type) {
    if (type === "columnStatistic") return "Column Statistics";
    if (type === "residueProperty") return "Residue Properties";
    return "Schemes";
}

function getSchemeGroupOrder(type) {
    if (type === "columnStatistic") return 0;
    if (type === "residueProperty") return 1;
    return 2;
}

function inferAlignmentFormat(name = "") {
    return name.toLowerCase().endsWith(".a3m") ? "a3m" : "fasta";
}

function toRepresentationId(value = "", fallback = "default") {
    const id = value
        .replace(/\.[^.]+$/, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
    return id || fallback;
}

function cloneTrackLayer(layer) {
    return {
        ...layer,
        style: layer.style ? { ...layer.style } : layer.style,
        colors: layer.colors
            ? {
                ...layer.colors,
                light: layer.colors.light ? { ...layer.colors.light } : layer.colors.light,
                dark: layer.colors.dark ? { ...layer.colors.dark } : layer.colors.dark,
            }
            : layer.colors,
        colorRamps: layer.colorRamps
            ? Object.fromEntries(
                Object.entries(layer.colorRamps).map(([key, ramp]) => [key, ramp ? { ...ramp } : ramp])
            )
            : layer.colorRamps,
    };
}

function cloneTrackLayout(layout) {
    if (!layout) {
        return layout;
    }
    return {
        ...layout,
        lanes: Array.isArray(layout.lanes)
            ? layout.lanes.map((lane) => ({
                ...lane,
                layers: Array.isArray(lane.layers)
                    ? lane.layers.map(cloneTrackLayer)
                    : lane.layers,
            }))
            : layout.lanes,
    };
}

function cloneTrackDefinition(definition) {
    return {
        ...definition,
        source: definition.source ? { ...definition.source } : definition.source,
        coloring: definition.coloring ? { ...definition.coloring } : definition.coloring,
        options: definition.options
            ? {
                ...definition.options,
                valueRange: definition.options.valueRange ? { ...definition.options.valueRange } : definition.options.valueRange,
                layout: cloneTrackLayout(definition.options.layout),
            }
            : definition.options,
    };
}

function buildTrackBindingId({ trackId, representation = "active", alphabetId = null }) {
    if (alphabetId) {
        return `${trackId}::alphabet:${alphabetId}`;
    }
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

function getSupportedTrackRepresentations(definition, representations = []) {
    const supportedAlphabetIds = definition.supports?.alphabets ?? null;
    return representations.filter((representation) =>
        !Array.isArray(supportedAlphabetIds) || supportedAlphabetIds.includes(representation.alphabetId)
    );
}

function getTrackVariants(definition, representations = []) {
    if (definition.supports?.shared === true) {
        return [{ trackId: definition.id, representation: definition.source?.representation ?? "active" }];
    }
    return getSupportedTrackRepresentations(definition, representations)
        .filter((representation) => representation.id != null)
        .map((representation) => ({ trackId: definition.id, representation: representation.id }));
}

function findTrackVariantOverride(variant, variantOverrides = []) {
    return variantOverrides.find((override) =>
        override.trackId === variant.trackId
        && (override.representation ?? "active") === variant.representation
    ) ?? null;
}

function isTrackVariantEnabled(variant, {
    defaults,
    activeRepresentationId,
    variantOverrides = [],
}) {
    const override = findTrackVariantOverride(variant, variantOverrides);
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
            return activeRepresentationId != null;
        }
        return variant.representation === activeRepresentationId;
    }
    return false;
}

function resolveTrackVariantOverride(variant, definition, representations = [], activeRepresentationId = null) {
    if (!variant || !definition) return null;
    if (variant.alphabetId) {
        const matchingRepresentation = getSupportedTrackRepresentations(definition, representations).find((representation) =>
            representation.alphabetId === variant.alphabetId
        ) ?? null;
        if (!matchingRepresentation) return null;
        return {
            trackId: definition.id,
            representation: matchingRepresentation.id,
            enabled: variant.enabled !== false,
        };
    }
    if (variant.representation === "active" && definition.supports?.shared !== true) {
        if (!activeRepresentationId) return null;
        return {
            trackId: definition.id,
            representation: activeRepresentationId,
            enabled: variant.enabled !== false,
        };
    }
    return {
        trackId: definition.id,
        representation: variant.representation ?? "active",
        enabled: variant.enabled !== false,
    };
}

function choosePreferredRepresentationId(representations = []) {
    return representations.find((representation) => representation.alphabetId === "aa")?.id
        ?? representations[0]?.id
        ?? null;
}

function createRenderSources({ activeRepresentation, schemeRepresentation = activeRepresentation }) {
    return {
        activeRepresentation,
        schemeRepresentation,
        activeAlignmentStore: activeRepresentation?.store ?? null,
        activeAlignmentState: activeRepresentation?.alignmentState ?? null,
        schemeAlignmentStore: schemeRepresentation?.store ?? null,
        schemeAlignmentState: schemeRepresentation?.alignmentState ?? null,
        usesSeparateColorSource: Boolean(
            activeRepresentation
            && schemeRepresentation
            && activeRepresentation.id !== schemeRepresentation.id
        ),
    };
}

function areRepresentationListsEquivalent(nextRepresentations = [], previousRepresentations = []) {
    if (nextRepresentations === previousRepresentations) return true;
    if (!Array.isArray(nextRepresentations) || !Array.isArray(previousRepresentations)) return false;
    if (nextRepresentations.length !== previousRepresentations.length) return false;
    for (let index = 0; index < nextRepresentations.length; index += 1) {
        const next = nextRepresentations[index];
        const previous = previousRepresentations[index];
        if (!next || !previous) return false;
        if (next.id !== previous.id) return false;
        if (next.alphabetId !== previous.alphabetId) return false;
        if (next.store !== previous.store) return false;
        if ((next.label ?? null) !== (previous.label ?? null)) return false;
    }
    return true;
}

function normalizeSchemeSourceRepresentationId(options) {
    const schemeSourceRepresentationId = options?.rendering?.schemeSourceRepresentationId ?? null;
    if (!schemeSourceRepresentationId) {
        return null;
    }
    return (options?.data?.representations ?? []).some((representation) => representation.id === schemeSourceRepresentationId)
        ? schemeSourceRepresentationId
        : null;
}

const AUTO_LAYOUT_CSS = `
:host {
    display: block;
    color-scheme: light dark;
    font-family: var(--msa-ui-font-family);
    font-size: var(--msa-ui-font-size);
    box-sizing: border-box;
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
    --msa-minimap-height: 120px;
    --msa-ruler-height: 28px;
    --msa-header-width: 180px;
    --msa-track-label-width: 100px;
    --msa-track-row-gap: 8px;
    --msa-ui-font-family: "IBM Plex Sans", sans-serif;
    --msa-ui-font-size: 13px;
    --msa-grid-line: rgba(0, 0, 0, 0.05);
    --msa-scroller-bg: #fff;
    --msa-header-bg: #f0f0f0;
    --msa-header-border: rgba(30, 30, 30, 0.1);
}

:host([data-theme="dark"]) {
    color-scheme: dark;
    --msa-grid-line: rgba(255, 255, 255, 0.03);
    --msa-scroller-bg: #111;
    --msa-header-bg: #161616;
    --msa-header-border: rgba(255, 255, 255, 0.08);
}

:host([data-theme="light"]) {
    color-scheme: light;
}

:host([data-loaded="false"]) {
    --msa-header-width: 0px;
}

*, *::before, *::after {
    box-sizing: border-box;
}

[hidden] {
    display: none !important;
}

.msa-auto-shell {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: auto minmax(0, 1fr) auto;
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
}

.viewer-body,
.msa-minimap-body {
    min-width: 0;
}

.viewer-body {
    min-height: 0;
}

.msa-minimap-body {
    grid-row: 1;
    height: var(--msa-minimap-height);
    padding: 8px;
    margin-left: var(--msa-minimap-offset-left, 0px);
    width: calc(100% - var(--msa-minimap-offset-left, 0px));
    background: var(--msa-header-bg);
}

.viewer-body {
    grid-row: 2;
    display: grid;
    position: relative;
    overflow: hidden;
    background: var(--msa-header-bg);
}

.msa-minimap {
    position: relative;
    width: 100%;
    height: 100%;
    border: 1px solid grey;
}

.msa-alignment-corner {
    background: var(--msa-header-bg);
}

.msa-alignment-top-row,
.msa-alignment-body-row {
    display: grid;
    min-width: 0;
    min-height: 0;
}

.msa-alignment-left-column,
.msa-alignment-content-column {
    min-width: 0;
    min-height: 0;
}

.msa-alignment-left-column {
    display: flex;
    flex-direction: column;
    background: var(--msa-header-bg);
}

.msa-alignment-horizontal-scroller,
.msa-alignment-viewport,
.msa-alignment-interaction-proxy {
    color-scheme: inherit;
}

.msa-alignment-content-column {
    overflow: hidden;
    background: var(--msa-header-bg);
}

.msa-alignment-horizontal-scroller {
    overflow-x: auto;
    overflow-y: hidden;
    width: 100%;
    height: 100%;
    background: var(--msa-header-bg);
}

.msa-alignment-interaction-proxy {
    position: absolute;
    inset: 0;
    overflow-x: auto;
    overflow-y: auto;
    background: transparent;
    z-index: 2;
    scrollbar-width: none;
}

.msa-alignment-interaction-proxy::-webkit-scrollbar {
    display: none;
    width: 0;
    height: 0;
}

.msa-alignment-vertical-scroller {
    position: relative;
    width: 100%;
    overflow-x: hidden;
    overflow-y: scroll;
    background: transparent;
    scrollbar-gutter: stable;
}

.msa-alignment-content-stack {
    position: relative;
    min-width: 100%;
}

.msa-alignment-viewport {
    position: sticky;
    left: 0;
    top: 0;
    z-index: 1;
    background: var(--msa-scroller-bg);
}

.msa-ruler-body {
    min-height: var(--msa-ruler-height);
    border-bottom: 1px solid var(--msa-header-border);
    background: transparent;
}

.msa-headers,
.msa-track-label-stack,
.msa-track-body-stack {
    background: var(--msa-header-bg);
}

.msa-headers {
    width: var(--msa-header-view-width, var(--msa-header-width));
    max-width: var(--msa-header-view-width, var(--msa-header-width));
    overflow: hidden;
    flex: 0 0 auto;
    border-right: 1px solid var(--msa-header-border);
    --msa-header-font-family: "IBM Plex Mono", "IBM Plex Sans", monospace;
    --msa-header-font-size: 14px;
}

.msa-headers-track {
    position: relative;
    width: max-content;
    min-width: 100%;
}

.msa-header-row {
    display: flex;
    align-items: center;
    height: var(--row-height);
    padding: 0 8px;
    font-size: var(--msa-header-font-size);
    line-height: 1;
    box-sizing: border-box;
    width: max-content;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--msa-header-font-family);
}

.msa-track-label-stack {
    display: flex;
    flex-direction: column;
    overflow: hidden;
    flex: 0 0 auto;
}

.msa-track-body-stack {
    position: sticky;
    left: 0;
    display: flex;
    flex-direction: column;
    min-width: 0;
    border-top: 1px solid var(--msa-header-border);
}

.viewer-body.is-unloaded,
.viewer-body.is-unloaded .msa-alignment-content-column,
.viewer-body.is-unloaded .msa-alignment-horizontal-scroller,
.viewer-body.is-unloaded .msa-alignment-viewport {
    background:
        linear-gradient(90deg, var(--msa-grid-line) 1px, transparent 1px),
        linear-gradient(var(--msa-grid-line) 1px, transparent 1px),
        var(--msa-scroller-bg);
    background-size: 16px 16px;
}

.msa-alignment-spacer {
    width: 1px;
    height: 1px;
}

.msa-alignment-canvas,
.msa-alignment-motif-canvas,
.msa-alignment-overlay-canvas {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    display: block;
    pointer-events: none;
}

.msa-track-row {
    padding: var(--msa-track-row-gap) 0;
    min-width: 0;
    box-sizing: border-box;
}

.msa-track-label-row {
    display: flex;
    height: calc(var(--msa-track-view-height) + (var(--msa-track-row-gap) * 2));
}

.msa-track-body-row {
    display: block;
    height: calc(var(--msa-track-view-height) + (var(--msa-track-row-gap) * 2));
}

.msa-track-label {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    justify-content: flex-end;
    text-align: right;
    padding: 0 8px;
    min-height: var(--msa-track-view-height);
    min-width: var(--msa-track-label-width);
    margin-left: auto;
}

.msa-track-label-text {
    line-height: 1.1;
}

.msa-track-sublabel {
    margin-top: 2px;
    font-size: 0.8em;
    line-height: 1.1;
    opacity: 0.72;
}

.msa-track-body {
    min-width: 0;
    width: 100%;
    height: var(--msa-track-view-height);
}

.msa-track-canvas {
    display: block;
}

.msa-track-tooltip-overlay {
    position: absolute;
    left: 0;
    top: 0;
    width: 0;
    height: 0;
    z-index: 10;
    pointer-events: none;
    background: transparent;
}

.msa-track-tooltip-hitbox {
    position: absolute;
    inset: 0;
    pointer-events: auto;
    background: transparent;
}
`;

export class MSAViewer {
    constructor(options = {}) {
        const {
            root,
            device,
            format,
            themeMedia,
            alphabetRegistry = defaultAlphabetRegistry,
            views = null,
        } = options;
        this.root = root;
        this.device = device;
        this.format = format;
        this.themeMedia = themeMedia ?? window.matchMedia("(prefers-color-scheme: dark)");
        this.alphabetRegistry = alphabetRegistry;
        this.providedViews = views;
        this.options = normalizeViewerOptions(options);
        this.viewerConfig = deriveViewerOptions(this.options);
        this.renderBackend = resolveRenderingBackendKind(this.options.rendering.backend, {
            hasWebGPU: typeof navigator !== "undefined" && !!navigator.gpu,
        });
        this.eventTarget = new EventTarget();
        this.rebuildTrackDefinitionsFromOptions();
        const initialAlphabet = typeof this.options.alphabet === "string"
            ? this.alphabetRegistry.get(this.options.alphabet)
            : this.options.alphabet;
        if (!initialAlphabet) {
            throw new Error(`Unknown alphabet: ${this.options.alphabet}`);
        }
        
        this.state = new ViewerState({
            schemeKey: this.options.rendering.scheme,
            themeMode: this.options.theme.mode,
            darkMode: this.themeMedia.matches,
            alphabetId: initialAlphabet.id,
            cellWidth: this.viewerConfig.layout.cell.width,
            cellHeight: this.viewerConfig.layout.cell.height,
            hideInsertionColumns: this.options.behavior.masking.hideInsertionColumns,
            gapThreshold: this.options.behavior.masking.gapThreshold,
        });

        this.atlasBitmap = null;
        this.shadowRootRef = null;
        this.autoLayoutShell = null;
        this.views = {
            header: null,
            alignment: null,
            ruler: null,
            minimap: null,
            trackStacks: [],
        };
        this.renderer = null;
        this.gpuResources = null;
        this.pipelineRegistry = null;
        this.renderBindGroup = null;

        this.computeShaderCodes = {};
        this.representationStore = null;
        this.trackStateBuilder = new TrackStateBuilder();
        this.minimapController = null;
        this.viewportController = null;
        this.selectionController = null;
        this.motifController = null;
        this.columnMetricService = null;
        this.columnProfileService = null;
        this.visibleWindowController = null;
        this.schemeVisibleWindowController = null;
        this.schemePolicy = new SchemePolicy({
            getActiveAlphabet: () => this.getActiveAlphabet(),
        });
        this.visibleWindowState = null;
        this.schemeVisibleWindowState = null;
        this.lastRenderSchemeSourceRepresentationId = null;
        this.decodedTileCache = new TileCache(64 * 1024 * 1024);
        this.viewportOverscanRows = 8;
        this.viewportOverscanCols = 32;
        
        this.isScrolling = false;
        
        this.frameHandle = null;
        this.renderDirty = false;
        this.visibleWindowUploadFrameHandle = 0;
        this.visibleWindowUploadInFlight = false;
        this.visibleWindowUploadNeedsRerun = false;
        this.minimapRebuildFrameHandle = 0;
        this.minimapRebuildInFlight = false;
        this.minimapRebuildNeedsRerun = false;
        this.minimapRebuildGeneration = 0;
        this.pendingRepresentationUpdateMode = null;

        if (this.options.behavior.selectionMode !== "column") {
            this.state.setSelectionMode(this.options.behavior.selectionMode);
        }
    }

    get headerView() { return this.views.header; }
    set headerView(view) { this.views.header = view; }

    get alignmentView() { return this.views.alignment; }
    set alignmentView(view) { this.views.alignment = view; }

    get rulerView() { return this.views.ruler; }
    set rulerView(view) { this.views.ruler = view; }

    get minimapView() { return this.views.minimap; }
    set minimapView(view) { this.views.minimap = view; }

    get trackStackViews() { return this.views.trackStacks; }
    set trackStackViews(views) { this.views.trackStacks = Array.isArray(views) ? views : []; }

    addEventListener(type, listener, options) {
        this.eventTarget.addEventListener(type, listener, options);
    }

    removeEventListener(type, listener, options) {
        this.eventTarget.removeEventListener(type, listener, options);
    }

    dispatchViewerEvent(type, detail) {
        this.eventTarget.dispatchEvent(new CustomEvent(type, { detail }));
    }

    getOptions() {
        return this.options;
    }

    handleSequenceHeaderClick(rowIndex, originalEvent) {
        const records = this.getActiveAlignmentStore()?.records ?? [];
        const record = records[rowIndex] ?? null;
        if (!record) return;
        const detail = {
            rowIndex,
            record,
            representationId: this.getActiveRepresentation()?.id ?? this.state.getAlignmentIdentity().representationId ?? null,
            alphabetId: this.getActiveAlphabet()?.id ?? this.state.getAlignmentIdentity().alphabetId ?? null,
            originalEvent,
        };
        this.dispatchViewerEvent("sequenceclick", detail);
        this.options.interactions.onSequenceClick?.(detail);
    }

    getRepresentations() {
        return this.options.data.representations.map((representation) => {
            const alphabet = this.alphabetRegistry.get(representation.alphabetId);
            return {
                id: representation.id,
                label: representation.label ?? representation.id,
                alphabetId: representation.alphabetId,
                alphabetLabel: alphabet?.label ?? representation.alphabetId,
                alphabetShortLabel: alphabet?.shortLabel ?? alphabet?.label ?? representation.alphabetId,
                displayLabel: `${representation.label ?? representation.id} (${alphabet?.label ?? representation.alphabetId})`,
            };
        });
    }

    getAvailableSchemeOptions() {
        const representations = this.getRepresentations();
        const schemeMap = new Map();
        const schemeSuffixByRepresentationId = this.getRepresentationVariantSuffixes(representations);
        const getSchemeOptionsForRepresentation = (representation = null) => {
            const alphabet = representation
                ? this.alphabetRegistry.get(representation.alphabetId)
                : this.getActiveAlphabet();
            return Object.entries(SCHEMES)
                .filter(([schemeKey]) => this.schemePolicy.isSupported(schemeKey, alphabet))
                .map(([key, scheme]) => ({
                    key,
                    label: scheme.label ?? formatSchemeLabel(key),
                    group: getSchemeGroupLabel(scheme.type),
                    type: scheme.type,
                }));
        };
        const addVariant = (scheme, variant) => {
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
        };

        if (representations.length === 0) {
            for (const scheme of getSchemeOptionsForRepresentation(null)) {
                addVariant(scheme, {
                    representationId: null,
                    alphabetId: this.getActiveAlphabet()?.id ?? null,
                    alphabetShortLabel: this.getActiveAlphabet()?.shortLabel ?? this.getActiveAlphabet()?.label ?? null,
                    displayLabel: scheme.label,
                });
            }
        } else {
            const hasMultipleRepresentations = representations.length > 1;
            for (const representation of representations) {
                for (const scheme of getSchemeOptionsForRepresentation(representation)) {
                    addVariant(scheme, {
                        representationId: representation.id,
                        alphabetId: representation.alphabetId,
                        alphabetShortLabel: representation.alphabetShortLabel,
                        displayLabel: hasMultipleRepresentations
                            ? `${scheme.label} (${schemeSuffixByRepresentationId[representation.id] ?? representation.alphabetShortLabel})`
                            : scheme.label,
                    });
                }
            }
        }

        return [...schemeMap.values()].sort((a, b) =>
            getSchemeGroupOrder(a.type) - getSchemeGroupOrder(b.type)
            || a.label.localeCompare(b.label)
        );
    }

    getSchemeSourceRepresentation() {
        const representationId = this.options.rendering.schemeSourceRepresentationId ?? null;
        if (representationId) {
            return this.representationStore?.get(representationId)
                ?? this.options.data.representations.find((representation) => representation.id === representationId)
                ?? null;
        }
        return this.getActiveRepresentation()
            ?? (
                this.options.data.activeRepresentationId
                    ? this.options.data.representations.find((representation) => representation.id === this.options.data.activeRepresentationId) ?? null
                    : null
            );
    }

    getSchemeSourceAlphabet() {
        const representation = this.getSchemeSourceRepresentation();
        if (representation) {
            return this.alphabetRegistry.get(representation.alphabetId);
        }
        return this.getActiveAlphabet();
    }

    getRenderSources() {
        const activeRepresentation = this.getActiveRepresentation();
        const schemeRepresentation = this.getSchemeSourceRepresentation() ?? activeRepresentation;
        return createRenderSources({ activeRepresentation, schemeRepresentation });
    }

    resolveConcreteTrackBinding(binding) {
        if (!binding) return null;
        if (binding.alphabetId) {
            const representations = this.representationStore
                ? this.getRepresentations()
                : (this.options?.data?.representations ?? []).map((representation) => ({
                    id: representation.id,
                    alphabetId: representation.alphabetId,
                    label: representation.label ?? representation.id,
                }));
            const activeRepresentation = this.state
                ? this.getActiveRepresentation()
                : (
                    this.options?.data?.activeRepresentationId
                        ? (this.options.data.representations ?? []).find((representation) => representation.id === this.options.data.activeRepresentationId) ?? null
                        : null
                );
            const matchingRepresentation = (activeRepresentation?.alphabetId === binding.alphabetId
                ? activeRepresentation
                : null)
                ?? representations.find((representation) => representation.alphabetId === binding.alphabetId)
                ?? null;
            if (!matchingRepresentation) return null;
            return {
                trackId: binding.trackId,
                representation: matchingRepresentation.id,
            };
        }
        return {
            trackId: binding.trackId,
            representation: binding.representation === "active"
                ? this.getActiveRepresentation()?.id ?? "active"
                : binding.representation,
        };
    }

    getRepresentationVariantSuffixes(representations = this.getRepresentations()) {
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

    getAvailableTrackOptions() {
        const representations = this.getRepresentations();
        if (representations.length === 0) {
            return [];
        }
        const suffixByRepresentationId = this.getRepresentationVariantSuffixes();
        return this.trackDefinitions.map((definition) => {
            const rawVariants = getTrackVariants(definition, representations);
            const variants = rawVariants.map((variant) => ({
                ...variant,
                label: null,
                enabled: isTrackVariantEnabled(variant, {
                    defaults: this.options.tracks.defaults,
                    activeRepresentationId: this.getActiveRepresentation()?.id ?? this.options.data.activeRepresentationId ?? null,
                    variantOverrides: this.trackVariantOverrides ?? [],
                }),
            }));
            if (variants.length > 1) {
                for (const variant of variants) {
                    variant.label = variant.representation === "active" ? null : suffixByRepresentationId[variant.representation] ?? null;
                }
            }
            return {
                id: definition.id,
                label: definition.label,
                variants,
            };
        });
    }

    getFlattenedAvailableTrackVariants() {
        return this.getAvailableTrackOptions().flatMap((track) =>
            track.variants.map((variant) => ({
                id: buildTrackBindingId(variant),
                trackId: track.id,
                label: variant.label ? `${track.label} (${variant.label})` : track.label,
                representation: variant.representation,
                source: this.trackDefinitions.find((definition) => definition.id === track.id)?.source ?? null,
                enabled: variant.enabled === true,
            }))
        );
    }

    resolveTrackBinding(binding) {
        const definition = this.trackDefinitions.find((track) => track.id === binding.trackId);
        if (!definition) return null;
        const concreteRepresentation = binding.representation === "active"
            ? this.getActiveRepresentation()?.id ?? "active"
            : binding.representation;
        const representation = concreteRepresentation === "active"
            ? null
            : this.representationStore?.get(concreteRepresentation)
                ?? this.options.data.representations.find((item) => item.id === concreteRepresentation)
                ?? null;
        if (
            representation
            && Array.isArray(definition.supports?.alphabets)
            && !definition.supports.alphabets.includes(representation.alphabetId)
        ) {
            return null;
        }
        const suffixByRepresentationId = this.getRepresentationVariantSuffixes();
        const resolved = cloneTrackDefinition(definition);
        resolved.id = buildTrackBindingId({
            trackId: definition.id,
            representation: concreteRepresentation,
        });
        resolved.source = {
            ...(definition.source ?? {}),
            representation: concreteRepresentation,
        };
        resolved.coloring = {
            ...(definition.coloring ?? {}),
            representation: concreteRepresentation,
        };
        if (definition.supports?.shared !== true && concreteRepresentation !== "active") {
            const suffix = suffixByRepresentationId[concreteRepresentation];
            if (suffix) {
                resolved.options = {
                    ...(resolved.options ?? {}),
                    sublabel: suffix,
                };
            }
        }
        return resolved;
    }

    rebuildTrackDefinitionsFromOptions() {
        const representations = this.representationStore
            ? this.getRepresentations()
            : (this.options.data.representations ?? []).map((representation) => ({
                id: representation.id,
                alphabetId: representation.alphabetId,
                label: representation.label ?? representation.id,
            }));
        const activeRepresentationId = this.state?.getAlignmentIdentity().representationId
            ?? this.options.data.activeRepresentationId
            ?? null;
        this.trackDefinitions = normalizeTrackDefinitions({
            builtInDefinitions: BUILT_IN_TRACK_DEFINITIONS,
            userDefinitions: this.options.tracks.definitions,
            order: this.options.tracks.order,
        });
        this.trackVariantOverrides = (this.options.tracks.variants ?? [])
            .map((variant) => {
                const definition = this.trackDefinitions.find((track) => track.id === variant.trackId);
                return resolveTrackVariantOverride(variant, definition, representations, activeRepresentationId);
            })
            .filter(Boolean);
        this.enabledTrackBindings = dedupeTrackBindings(
            this.trackDefinitions.flatMap((definition) =>
                getTrackVariants(definition, representations).filter((variant) =>
                    isTrackVariantEnabled(variant, {
                        defaults: this.options.tracks.defaults,
                        activeRepresentationId,
                        variantOverrides: this.trackVariantOverrides,
                    })
                )
            )
        );
    }

    refreshTrackAppearance() {
        const isLoaded = this.root.dataset.loaded !== "false";
        this.alignmentView?.setViewportChrome?.({
            headerWidth: this.viewerConfig.views.header.width,
            headerVisible: isLoaded && this.viewerConfig.visibility.header,
        });
        if (this.headerView) {
            this.headerView.width = this.viewerConfig.views.header.width;
            this.headerView.fontFamily = this.viewerConfig.views.header.fontFamily;
            this.headerView.fontSize = this.viewerConfig.views.header.fontSize;
            this.headerView.applyStyles();
            const records = this.getActiveAlignmentStore()?.records;
            if (records) {
                this.headerView.renderRecords(records);
            }
        }
    }

    getTrackTheme() {
        return {
            darkMode: this.state.getResolvedDarkMode(),
            uiFontFamily: this.options.theme.typography.uiFontFamily,
        };
    }

    rebuildTrackViews() {
        for (const trackStackView of this.trackStackViews) {
            trackStackView.clear();
        }
        this.syncTrackVisibility();
    }

    async resetLoadedData({ preserveSelection = false, preserveScroll = false } = {}) {
        this.decodedTileCache.clear();
        this.visibleWindowController?.clear?.();
        this.schemeVisibleWindowController?.clear?.();
        this.visibleWindowState = null;
        this.schemeVisibleWindowState = null;
        this.lastRenderSchemeSourceRepresentationId = null;
        this.renderBindGroup = null;
        this.representationStore?.destroy?.();
        this.state.clearGpuResources();
        this.state.clearAlignment({ preserveSelection, preserveScroll });
        this.selectionController?.clearHover();
        this.minimapView?.clear?.();
        this.alignmentView?.setAlignmentSize(0, 0, null);
        if (!preserveScroll) {
            this.alignmentView?.scrollTo?.(0, 0);
        }
        this.alignmentView?.setMotifState?.({ motifHitsByRow: null });
        this.headerView?.renderRecords?.([]);
        for (const trackStackView of this.trackStackViews) {
            trackStackView.clear();
            trackStackView.setTrackContext(this.getTrackContext());
        }
        this.viewportController?.syncMinimapViewportRect?.();
        this.viewportController?.syncTracksViewport?.();
        this.viewportController?.refreshLayout?.();
        this.setLoadedLayoutVisible(false);
        this.requestRender();
    }

    applyAppearanceOptions(changed) {
        if (!changed.theme && !changed.layout) return;
        this.applyConfiguredAppearance();
        this.refreshTrackAppearance();
        for (const trackStackView of this.trackStackViews) {
            trackStackView.setTheme(this.getTrackTheme());
        }
    }

    applyThemeOptions(nextOptions, previousOptions, changed) {
        if (!changed) return;
        if (nextOptions.theme.mode !== previousOptions.theme.mode) {
            this.state.setThemeMode(nextOptions.theme.mode);
            this.scheduleMinimapRebuild();
        }
    }

    applyLayoutOptions(changed) {
        if (!changed) return;
        this.applyRulerOptions();
        this.applyMinimapOptions();
    }

    applyTrackOptions(changed) {
        if (!changed) return;
        this.rebuildTrackDefinitionsFromOptions();
        this.rebuildTrackViews();
    }

    destroyRuntimeViewsAndResources() {
        this.cancelRender();
        if (this.visibleWindowUploadFrameHandle) {
            cancelAnimationFrame(this.visibleWindowUploadFrameHandle);
            this.visibleWindowUploadFrameHandle = 0;
        }
        if (this.minimapRebuildFrameHandle) {
            cancelAnimationFrame(this.minimapRebuildFrameHandle);
            this.minimapRebuildFrameHandle = 0;
        }
        this.minimapRebuildGeneration += 1;
        this.visibleWindowUploadInFlight = false;
        this.visibleWindowUploadNeedsRerun = false;
        this.minimapRebuildInFlight = false;
        this.minimapRebuildNeedsRerun = false;

        this.selectionController?.destroy?.();
        this.viewportController?.destroy?.();
        this.minimapView?.destroy?.();
        this.rulerView?.destroy?.();
        this.headerView?.destroy?.();
        this.trackStackViews?.forEach((trackStackView) => trackStackView.destroy?.());
        this.motifController = null;
        this.views = { header: null, alignment: null, ruler: null, minimap: null, trackStacks: [] };
        this.headerRoot = null;
        this.alignmentRoot = null;
        this.rulerRoot = null;
        this.minimapRoot = null;
        this.trackLabelRoot = null;
        this.trackBodyRoot = null;

        this.visibleWindowController?.clear?.();
        this.schemeVisibleWindowController?.clear?.();
        this.visibleWindowState = null;
        this.schemeVisibleWindowState = null;
        this.lastRenderSchemeSourceRepresentationId = null;
        this.renderBindGroup = null;
        this.representationStore?.destroy?.();
        this.gpuResources?.destroy?.();
        this.state.clearGpuResources();
    }

    async recreateBackendRuntime(nextBackend) {
        if (this.providedViews) {
            throw new Error("Changing rendering backend at runtime is not supported in manual view mode.");
        }
        const currentScrollLeft = this.alignmentView?.getScrollLeft?.() ?? this.alignmentView?.scroller?.scrollLeft ?? this.state.getViewportSnapshot().scrollLeft;
        const currentScrollTop = this.alignmentView?.getScrollTop?.() ?? this.alignmentView?.scroller?.scrollTop ?? this.state.getViewportSnapshot().scrollTop;
        this.state.setViewportScroll(currentScrollLeft, currentScrollTop);

        this.destroyRuntimeViewsAndResources();
        this.renderBackend = nextBackend;

        await this.ensureGpuContext();
        if (!this.atlasBitmap) {
            this.atlasBitmap = await loadImageBitmap(new URL("../graphics/atlas.png", import.meta.url));
        }
        this.createBackendResources();
        this.syncThemeBuffer();
        this.createViews();
        this.viewportController?.bind();
        this.applyConfiguredAppearance();
        if (this.renderBackend === "webgpu") {
            this.loadStaticAssets();
        }

        if (this.options.data.representations.length > 0) {
            this.pendingRepresentationUpdateMode = "rebuild";
            await this.applyDataOptions(this.options.data, { representations: [], activeRepresentationId: null });
        } else {
            this.setLoadedLayoutVisible(false);
            this.requestRender();
        }
    }

    applyBehaviorOptions(nextOptions, changed) {
        if (changed.masking) {
            this.applyColumnMasking(nextOptions.behavior.masking);
        }
        if (changed.selectionMode && nextOptions.behavior.selectionMode !== this.getSelectionMode()) {
            this.applySelectionMode(nextOptions.behavior.selectionMode);
        }
    }

    async applyRenderingOptions(nextOptions, previousOptions, changed) {
        if (!changed) return;
        const nextBackend = resolveRenderingBackendKind(nextOptions.rendering.backend, {
            hasWebGPU: typeof navigator !== "undefined" && !!navigator.gpu,
        });
        if (nextBackend !== this.renderBackend) {
            await this.recreateBackendRuntime(nextBackend);
            return;
        }
        if (
            nextOptions.rendering.scheme !== previousOptions.rendering.scheme
            || nextOptions.rendering.schemeSourceRepresentationId !== previousOptions.rendering.schemeSourceRepresentationId
        ) {
            await this.applySchemeOption(nextOptions.rendering.scheme);
            this.scheduleVisibleWindowUpload();
        }
    }

    async setOptions(partialOptions = {}) {
        const nextOptions = normalizeViewerOptions(mergeViewerOptions(this.options, partialOptions));
        nextOptions.rendering.schemeSourceRepresentationId = normalizeSchemeSourceRepresentationId(nextOptions);
        const previousOptions = this.options;

        this.options = nextOptions;
        this.viewerConfig = deriveViewerOptions(nextOptions);

        const changed = {
            theme: partialOptions.theme != null,
            layout: partialOptions.layout != null,
            tracks: partialOptions.tracks != null,
            behavior: {
                masking: partialOptions.behavior?.masking != null,
                selectionMode: partialOptions.behavior?.selectionMode != null,
            },
            data: partialOptions.data != null,
            rendering: partialOptions.rendering?.scheme != null
                || partialOptions.rendering?.schemeSourceRepresentationId !== undefined
                || partialOptions.rendering?.backend != null,
        };

        this.applyAppearanceOptions(changed);
        this.applyThemeOptions(nextOptions, previousOptions, changed.theme);
        this.applyLayoutOptions(changed.layout);
        this.applyTrackOptions(changed.tracks);
        this.applyBehaviorOptions(nextOptions, changed.behavior);
        await this.applyRenderingOptions(nextOptions, previousOptions, changed.rendering);

        if (changed.data) {
            await this.applyDataOptions(nextOptions.data, previousOptions.data);
        }

        this.viewportController?.refreshLayout();
        this.requestRender();
    }

    getActiveAlphabet() {
        if (!this.state) {
            const activeRepresentationId = this.options?.data?.activeRepresentationId ?? null;
            const activeRepresentation = activeRepresentationId
                ? (this.options?.data?.representations ?? []).find((representation) => representation.id === activeRepresentationId) ?? null
                : null;
            return this.alphabetRegistry.get(
                activeRepresentation?.alphabetId ?? this.options?.alphabet ?? "aa"
            );
        }
        const activeRepresentation = this.getActiveRepresentation();
        if (activeRepresentation) {
            return this.alphabetRegistry.get(activeRepresentation.alphabetId);
        }
        return this.alphabetRegistry.get(this.state.getAlignmentIdentity().alphabetId);
    }

    getActiveRepresentation() {
        if (!this.state) return null;
        const { representationId } = this.state.getAlignmentIdentity();
        if (!representationId) return null;
        return this.representationStore?.get(representationId) ?? null;
    }

    getActiveAlignmentStore() {
        return this.getActiveRepresentation()?.store ?? null;
    }

    getActiveAlignmentState() {
        return this.getActiveRepresentation()?.alignmentState ?? null;
    }

    getActiveColumnMetrics() {
        return this.getActiveRepresentation()?.columnMetrics ?? null;
    }

    get uniformBuffer()       { return this.gpuResources?.getSingleton("uniformBuffer")       ?? null; }
    get themeBuffer()         { return this.gpuResources?.getSingleton("themeBuffer")         ?? null; }
    get metricUniformBuffer() { return this.gpuResources?.getSingleton("metricUniformBuffer") ?? null; }
    get dummyStorageBuffer()  { return this.gpuResources?.getSingleton("dummyStorageBuffer")  ?? null; }
    get atlasTexture()        { return this.gpuResources?.getSingleton("atlasTexture")        ?? null; }
    get atlasSampler()        { return this.gpuResources?.getSingleton("atlasSampler")        ?? null; }

    async setAlphabet(alphabet) {
        const resolvedAlphabet = typeof alphabet === "string" ? this.alphabetRegistry.get(alphabet) : alphabet;
        if (!resolvedAlphabet) {
            throw new Error(`Unknown alphabet: ${alphabet}`);
        }
        const matchingRepresentation = this.representationStore?.findByAlphabetId(resolvedAlphabet.id);
        if (matchingRepresentation) {
            await this.setActiveRepresentation(matchingRepresentation.id);
            return;
        }
        this.state.setActiveAlphabetId(resolvedAlphabet.id);
        const activeColumnMetrics = this.getActiveColumnMetrics();
        const activeAlignmentStore = this.getActiveAlignmentStore();
        if (activeColumnMetrics && activeAlignmentStore) {
            this.renderer = this.pipelineRegistry?.getRenderer(resolvedAlphabet) ?? null;
            this.alignmentView.renderer = this.renderer;
            await this.recomputeColumnMetrics();
            this.recomputeColumnVisibility();
            const updatedTrackState = this.trackStateBuilder.build(
                this.getActiveColumnMetrics(),
                activeAlignmentStore.totalRows,
                resolvedAlphabet
            );
            const activeRepresentation = this.getActiveRepresentation();
            if (activeRepresentation) {
                this.representationStore.setAlphabetId(activeRepresentation.id, resolvedAlphabet.id);
                this.representationStore.setColumnMetrics(activeRepresentation.id, this.getActiveColumnMetrics());
                this.representationStore.setColumnVisibility(activeRepresentation.id, activeRepresentation.columnVisibility);
                this.representationStore.setTrackState(activeRepresentation.id, updatedTrackState);
                this.representationStore.setMinimapCache(activeRepresentation.id, null);
            }
            for (const trackStackView of this.trackStackViews) {
                trackStackView.setTrackContext(this.getTrackContext());
            }
        }
    }

    applyCompatibleSchemeForAlphabet(alphabet = this.getActiveAlphabet()) {
        const schemeKey = this.state.getSchemeKey();
        const compatibleSchemeKey = this.schemePolicy.getCompatibleScheme(schemeKey, alphabet);
        if (compatibleSchemeKey && compatibleSchemeKey !== schemeKey) {
            this.state.setScheme(compatibleSchemeKey);
            this.syncThemeBuffer();
        }
        return compatibleSchemeKey;
    }
    
    async init() {
        await this.ensureGpuContext();
        if (this.renderBackend === "webgpu" || this.renderBackend === "cpu") {
            this.atlasBitmap = await loadImageBitmap(new URL("../graphics/atlas.png", import.meta.url));
        }
        this.createBackendResources();
        this.createViews();
        this.applyConfiguredAppearance();
        if (this.renderBackend === "webgpu") {
            this.loadStaticAssets();
        }
        this.bindEvents();
        this.syncThemeBuffer();
        if (this.options.data.representations.length > 0) {
            await this.applyDataOptions(this.options.data, { representations: [], activeRepresentationId: null });
        } else {
            this.setLoadedLayoutVisible(false);
            this.requestRender();
        }
    }
    
    async ensureGpuContext() {
        if (this.renderBackend === "cpu") {
            return;
        }
        if (!navigator.gpu) {
            throw new Error("WebGPU is not available in this browser.");
        }
        if (!this.device) {
            this.adapter = await navigator.gpu.requestAdapter();
            if (!this.adapter) {
                throw new Error("Failed to acquire a WebGPU adapter.");
            }
            this.device = await this.adapter.requestDevice();
        }
        if (!this.format) {
            this.format = navigator.gpu.getPreferredCanvasFormat();
        }
    }
    
    createLayout() {
        const mountRoot = this.providedViews ? this.root : this.getAutoLayoutMountRoot();
        mountRoot.replaceChildren();

        const alignmentRoot = document.createElement("div");
        alignmentRoot.className = "viewer-body";
        
        const minimapRoot = this.viewerConfig.visibility.minimap ? document.createElement("div") : null;
        if (minimapRoot) {
            minimapRoot.className = "msa-minimap-body";
        }
        
        mountRoot.appendChild(alignmentRoot);
        if (minimapRoot) {
            mountRoot.insertBefore(minimapRoot, alignmentRoot);
        }

        return { alignmentRoot, minimapRoot };
    }

    getAutoLayoutMountRoot() {
        if (!this.shadowRootRef) {
            this.shadowRootRef = this.root.shadowRoot ?? this.root.attachShadow({ mode: "open" });
        }
        this.applyConfiguredAppearance();
        if (!this.autoLayoutShell) {
            this.shadowRootRef.replaceChildren();
            const style = document.createElement("style");
            style.textContent = AUTO_LAYOUT_CSS;
            this.autoLayoutShell = document.createElement("div");
            this.autoLayoutShell.className = "msa-auto-shell";
            this.shadowRootRef.append(style, this.autoLayoutShell);
        }
        return this.autoLayoutShell;
    }

    applyConfiguredAppearance() {
        const isLoaded = this.root.dataset.loaded !== "false";
        for (const [key, value] of Object.entries(this.viewerConfig.cssVariables)) {
            this.root.style.setProperty(
                key,
                (key === "--msa-header-width" || key === "--msa-left-chrome-width") && !isLoaded ? "0px" : value
            );
        }
    }

    createAutoViews() {
        const { alignmentRoot, minimapRoot } = this.createLayout();
        this.alignmentRoot = alignmentRoot;
        this.minimapRoot = minimapRoot;
        this.renderer = this.pipelineRegistry?.getRenderer(this.getActiveAlphabet()) ?? null;
        const alignmentSurface = createAlignmentSurface({
            backend: this.renderBackend,
            device: this.device,
            format: this.format,
            uniformBuffer: this.uniformBuffer,
            renderer: this.renderer,
            atlasBitmap: this.atlasBitmap,
        });
        this.alignmentView = new AlignmentView({
            root: alignmentRoot,
            surfaceRenderer: alignmentSurface,
            getCellWidth: () => this.state.getCellSize().cellWidth,
            getCellHeight: () => this.state.getCellSize().cellHeight,
            headerWidth: this.viewerConfig.visibility.header ? this.viewerConfig.views.header.width : 0,
            rulerHeight: this.viewerConfig.visibility.ruler ? this.viewerConfig.views.ruler.height : 0,
            headerVisible: this.viewerConfig.visibility.header,
            rulerVisible: this.viewerConfig.visibility.ruler,
        });
        this.headerRoot = this.alignmentView.headerSlot;
        this.rulerRoot = this.alignmentView.rulerSlot;
        this.trackLabelRoot = this.alignmentView.trackLabelSlot;
        this.trackBodyRoot = this.alignmentView.trackBodySlot;
        this.headerView = this.headerRoot ? new HeaderView({
            root: this.headerRoot,
            rowHeight: this.state.getCellSize().cellHeight,
            width: this.viewerConfig.views.header.width,
            fontFamily: this.viewerConfig.views.header.fontFamily,
            fontSize: this.viewerConfig.views.header.fontSize,
            onRowClick: (rowIndex, event) => this.handleSequenceHeaderClick(rowIndex, event),
        }) : null;
        this.minimapView = minimapRoot ? new MinimapView({ root: minimapRoot }) : null;
        this.minimapController = createBackendMinimapController({
            backend: this.renderBackend,
            device: this.device,
            gpuResources: this.gpuResources,
            pipelineRegistry: this.pipelineRegistry,
            minimapView: this.minimapView,
            decodedTileCache: this.decodedTileCache,
        });
        this.rulerView = this.rulerRoot ? new RulerView({
            root: this.rulerRoot,
            tickInterval: this.viewerConfig.views.ruler.tickInterval,
            height: this.viewerConfig.views.ruler.height,
        }) : null;
        this.trackStackViews = this.viewerConfig.visibility.tracks
            ? [new TrackStackView({
                root: this.alignmentRoot,
                labelRoot: this.trackLabelRoot,
                bodyRoot: this.trackBodyRoot,
            })]
            : [];
        this.viewportController = new ViewportController({
            state: this.state,
            alignmentView: this.alignmentView,
            headerView: this.headerView,
            rulerView: this.rulerView,
            minimapView: this.minimapView,
            getTrackStackViews: () => this.trackStackViews,
            minimapController: this.minimapController,
            getAlignmentStore: () => this.getActiveAlignmentStore(),
            getColumnVisibility: () => this.getActiveRepresentation()?.columnVisibility ?? null,
            getOverscanRows: () => this.viewportOverscanRows,
            getOverscanCols: () => this.viewportOverscanCols,
            uploadVisibleWindow: () => this.scheduleVisibleWindowUpload(),
            requestRender: () => this.requestRender(),
            onHoverReset: () => this.selectionController?.clearHover(),
            onSetScrolling: (isScrolling) => {
                this.isScrolling = isScrolling;
            },
        });
        this.selectionController = new SelectionController({
            state: this.state,
            alignmentView: this.alignmentView,
            getCoordsFromEvent: (event) => this.getCoordsFromScrollerPosition(event),
            getIsScrolling: () => this.isScrolling,
        });
        this.motifController = new MotifController({
            alignmentView: this.alignmentView,
            decodedTileCache: this.decodedTileCache,
            representationStore: this.representationStore,
            getActiveRepresentation: () => this.getActiveRepresentation(),
            getAlignmentStore: () => this.getActiveAlignmentStore(),
            getColumnVisibility: () => this.getActiveRepresentation()?.columnVisibility ?? null,
        });
        this.selectionController.bind();
        this.rulerView?.setTheme?.({ darkMode: this.state.getResolvedDarkMode() });

        this.setLoadedLayoutVisible(false);
    }

    attachProvidedViews({
        headerView = null,
        alignmentView,
        rulerView = null,
        minimapView = null,
        trackStackViews = null,
    }) {
        if (!alignmentView) {
            throw new Error("Manual view mode requires an alignmentView.");
        }
        this.renderer = this.pipelineRegistry?.getRenderer(this.getActiveAlphabet()) ?? null;
        this.headerView = headerView;
        this.alignmentView = alignmentView;
        this.rulerView = rulerView;
        this.minimapView = minimapView;
        this.trackStackViews = trackStackViews ?? [];
        if (this.alignmentView) {
            this.alignmentView.renderer = this.renderer;
        }
        this.minimapController = createBackendMinimapController({
            backend: this.renderBackend,
            device: this.device,
            gpuResources: this.gpuResources,
            pipelineRegistry: this.pipelineRegistry,
            minimapView: this.minimapView,
            decodedTileCache: this.decodedTileCache,
        });
        this.viewportController = new ViewportController({
            state: this.state,
            alignmentView: this.alignmentView,
            headerView: this.headerView,
            rulerView: this.rulerView,
            minimapView: this.minimapView,
            getTrackStackViews: () => this.trackStackViews,
            minimapController: this.minimapController,
            getAlignmentStore: () => this.getActiveAlignmentStore(),
            getColumnVisibility: () => this.getActiveRepresentation()?.columnVisibility ?? null,
            getOverscanRows: () => this.viewportOverscanRows,
            getOverscanCols: () => this.viewportOverscanCols,
            uploadVisibleWindow: () => this.scheduleVisibleWindowUpload(),
            requestRender: () => this.requestRender(),
            onHoverReset: () => this.selectionController?.clearHover(),
            onSetScrolling: (isScrolling) => {
                this.isScrolling = isScrolling;
            },
        });
        this.selectionController = new SelectionController({
            state: this.state,
            alignmentView: this.alignmentView,
            getCoordsFromEvent: (event) => this.getCoordsFromScrollerPosition(event),
            getIsScrolling: () => this.isScrolling,
        });
        this.motifController = new MotifController({
            alignmentView: this.alignmentView,
            decodedTileCache: this.decodedTileCache,
            representationStore: this.representationStore,
            getActiveRepresentation: () => this.getActiveRepresentation(),
            getAlignmentStore: () => this.getActiveAlignmentStore(),
            getColumnVisibility: () => this.getActiveRepresentation()?.columnVisibility ?? null,
        });
        this.selectionController.bind();
        this.headerView?.setOnRowClick?.((rowIndex, event) => this.handleSequenceHeaderClick(rowIndex, event));
        this.rulerView?.setTheme?.({ darkMode: this.state.getResolvedDarkMode() });
    }

    createViews() {
        if (this.providedViews) {
            this.attachProvidedViews(this.providedViews);
            return;
        }
        this.createAutoViews();
    }

    decodeConservationMask(mask) {
        const propertyNames = [
            "hydrophobic",
            "polar",
            "small",
            "proline",
            "tiny",
            "aliphatic",
            "aromatic",
            "positive",
            "negative",
            "charged",
        ];
        const positive = [];
        const negative = [];
        const maskValue = Number(mask) >>> 0;
        for (let i = 0; i < propertyNames.length; i += 1) {
            if (maskValue & (1 << i)) {
                positive.push(propertyNames[i]);
            }
            if (maskValue & (1 << (10 + i))) {
                negative.push(`!${propertyNames[i]}`);
            }
        }
        return {
            positive,
            negative,
            isIdentity: Boolean(maskValue & (1 << 20)),
            isFullyConserved: Boolean(maskValue & (1 << 21)),
        };
    }

    buildConservationTooltip({ rawColumn, value, trackState }) {
        if (!Number.isFinite(value)) {
            return null;
        }
        const conservationMask = trackState?.metrics?.conservationMask?.[rawColumn] ?? 0;
        const decoded = this.decodeConservationMask(conservationMask);
        const lines = [
            `Column: ${rawColumn + 1}`,
            `Score: ${value}`,
        ];
        if (decoded.isIdentity) {
            lines.push("* identity");
        } else if (decoded.isFullyConserved) {
            lines.push("+ fully conserved");
        }
        lines.push(...decoded.positive);
        lines.push(...decoded.negative);
        return {
            title: "Conservation",
            lines,
        };
    }

    getTrackDefinitions() {
        return this.trackDefinitions;
    }

    createTrackFromBinding(binding) {
        const definition = this.resolveTrackBinding(binding);
        return createTrackFromDefinition(definition, {
            behaviorHelpers: {
                buildConservationTooltip: (context) => this.buildConservationTooltip(context),
            },
        });
    }

    getTrackContext() {
        const activeRepresentation = this.getActiveRepresentation();
        return {
            activeRepresentationId: activeRepresentation?.id ?? null,
            activeTrackState: activeRepresentation?.trackState ?? null,
            getRepresentation: (id) => this.representationStore?.get(id) ?? null,
            getAlphabet: (id) => (id ? this.alphabetRegistry.get(id) ?? null : null),
            getActiveAlphabet: () => this.getActiveAlphabet(),
        };
    }

    getEnabledTrackIds() {
        return this.getConcreteEnabledTrackBindings().map(buildTrackBindingId);
    }

    getEnabledTrackBindings() {
        return this.enabledTrackBindings.map((binding) => ({ ...binding }));
    }

    getConcreteEnabledTrackBindings() {
        return dedupeTrackBindings(
            this.enabledTrackBindings.map((binding) =>
                binding.alphabetId ? this.resolveConcreteTrackBinding(binding) : binding
            ).filter(Boolean)
        );
    }

    getTrackDisplayMode() {
        return this.options.tracks.defaults;
    }

    normalizeTrackVariantBinding(track) {
        return typeof track === "string"
            ? { trackId: track, representation: "active" }
            : { trackId: track.trackId, representation: track.representation ?? "active" };
    }

    withTrackVariantOverride(binding, enabled) {
        const nextVariants = [...(this.options.tracks.variants ?? [])];
        const existingIndex = nextVariants.findIndex((variant) =>
            variant.trackId === binding.trackId
            && (variant.representation ?? "active") === binding.representation
            && (variant.alphabetId ?? null) == null
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

    async applyTrackVariantOverride(binding, enabled, defaults = this.options.tracks.defaults) {
        await this.setOptions({
            tracks: {
                defaults,
                variants: this.withTrackVariantOverride(binding, enabled),
            },
        });
    }

    async setTrackDisplayMode(mode, { clearVariants = false } = {}) {
        await this.setOptions({
            tracks: {
                defaults: mode,
                variants: clearVariants ? [] : this.options.tracks.variants,
            },
        });
    }

    syncTrackVisibility() {
        if (this.trackStackViews.length === 0) return;
        const enabledTrackBindings = this.getConcreteEnabledTrackBindings()
            .filter((binding) => this.resolveTrackBinding(binding));
        const enabledTrackInstanceIds = enabledTrackBindings.map(buildTrackBindingId);

        for (const trackStackView of this.trackStackViews) {
            for (const track of [...trackStackView.tracks]) {
                if (!enabledTrackInstanceIds.includes(track.id)) {
                    trackStackView.removeTrack(track.id);
                }
            }
            enabledTrackBindings.forEach((binding, index) => {
                const trackId = buildTrackBindingId(binding);
                if (trackStackView.hasTrack(trackId)) return;
                const track = this.createTrackFromBinding(binding);
                if (!track) return;
                trackStackView.addTrackAt(track, index);
            });
            trackStackView.setTheme(this.getTrackTheme());
            trackStackView.setTrackContext(this.getTrackContext());
        }
        this.alignmentView?.syncSurfaceSize?.();
        this.viewportController?.syncTracksViewport();
    }

    async toggleTrack(track, enabled = null) {
        const binding = this.normalizeTrackVariantBinding(track);
        const availableTrackIds = new Set(this.getFlattenedAvailableTrackVariants().map((item) => item.id));
        const bindingId = buildTrackBindingId(binding);
        if (!availableTrackIds.has(bindingId)) return;
        const enabledTrackIds = new Set(this.getEnabledTrackIds());
        const shouldEnable = enabled == null ? !enabledTrackIds.has(bindingId) : enabled === true;
        await this.applyTrackVariantOverride(binding, shouldEnable);
    }

    async setTrackVariantEnabled(track, enabled) {
        const binding = this.normalizeTrackVariantBinding(track);
        const activeRepresentationId = this.getActiveRepresentation()?.id ?? null;
        const selectingNonActiveVariant = enabled === true
            && this.getTrackDisplayMode() === "active-only"
            && binding.representation !== "active"
            && binding.representation !== activeRepresentationId;

        if (selectingNonActiveVariant) {
            const nextVariants = this.getAvailableTrackOptions()
                .flatMap((availableTrack) => availableTrack.variants)
                .map((availableVariant) => ({
                    trackId: availableVariant.trackId,
                    representation: availableVariant.representation,
                    enabled:
                        availableVariant.trackId === binding.trackId
                        && availableVariant.representation === binding.representation
                            ? true
                            : availableVariant.enabled === true,
                }));
            await this.setOptions({
                tracks: {
                    defaults: "none",
                    variants: nextVariants,
                },
            });
            return;
        }

        await this.applyTrackVariantOverride(binding, enabled);
    }
    
    ensureTracks() {
        if (this.trackStackViews.length === 0) return;
        for (const trackStackView of this.trackStackViews) {
            if (trackStackView.tracks.length > 0) continue;
        }
        this.syncTrackVisibility();
    }
    
    getCoordsFromScrollerPosition({ clientX, clientY }) {
        const bounds = this.alignmentView.getViewportBounds?.() ?? this.alignmentView.scroller.getBoundingClientRect();
        const withinViewport =
            clientX >= bounds.left &&
            clientX < bounds.left + bounds.width &&
            clientY >= bounds.top &&
            clientY < bounds.top + bounds.height;
        if (!withinViewport) {
            return null;
        }
        const contentX = clientX - bounds.left + (this.alignmentView.getScrollLeft?.() ?? this.alignmentView.scroller.scrollLeft);
        const contentY = clientY - bounds.top  + (this.alignmentView.getScrollTop?.() ?? this.alignmentView.scroller.scrollTop);
        const cellWidth = this.alignmentView.getRenderedCellWidthCss();
        const cellHeight = this.alignmentView.getRenderedCellHeightCss();
        const snapshot = this.state.getSnapshot();
        const visibleCol = Math.floor(contentX / cellWidth);
        const columnVisibility = this.getActiveRepresentation()?.columnVisibility;
        const col = columnVisibility?.visibleToRaw?.[visibleCol] ?? visibleCol;
        const row = Math.min(snapshot.alignment.totalRows - 1, Math.floor(contentY / cellHeight));
        return [col, row];
    }

    setLoadedLayoutVisible(loaded) {
        this.alignmentView?.setViewportChrome?.({
            headerWidth: this.viewerConfig.views.header.width,
            rulerHeight: this.viewerConfig.views.ruler.height,
            headerVisible: loaded && this.viewerConfig.visibility.header,
            rulerVisible: loaded && this.viewerConfig.visibility.ruler,
        });
        this.alignmentView?.setLoadedState?.(loaded);
        this.root.dataset.loaded = loaded ? "true" : "false";
        this.applyConfiguredAppearance();
        if (this.alignmentView?.canvas) {
            this.alignmentView.canvas.hidden = !loaded;
        }
        if (this.alignmentView?.motifOverlay) {
            this.alignmentView.motifOverlay.hidden = !loaded;
        }
        if (this.alignmentView?.overlay) {
            this.alignmentView.overlay.hidden = !loaded;
        }
        if (this.headerRoot) {
            this.headerRoot.hidden = !loaded;
        }
        if (this.rulerRoot) {
            this.rulerRoot.hidden = !loaded;
        }
        if (this.minimapRoot) {
            this.minimapRoot.hidden = !loaded;
        }
        if (this.trackLabelRoot) {
            this.trackLabelRoot.hidden = !loaded || !this.viewerConfig.visibility.tracks;
        }
        if (this.trackBodyRoot) {
            this.trackBodyRoot.hidden = !loaded || !this.viewerConfig.visibility.tracks;
        }
        this.alignmentView?.syncSurfaceSize?.();
    }
    
    async rebuildMinimap({ shouldApply = null } = {}) {
        const {
            activeRepresentation,
            schemeRepresentation,
            schemeAlignmentStore,
            schemeAlignmentState,
        } = this.getRenderSources();
        if (!activeRepresentation || !schemeRepresentation || !schemeAlignmentStore || !schemeAlignmentState || !this.minimapController) return;
        this.applyCompatibleSchemeForAlphabet(this.getSchemeSourceAlphabet());
        await this.minimapController.rebuildForRepresentation(activeRepresentation, {
            alignmentState: schemeAlignmentState,
            alignmentStore: schemeAlignmentStore,
            alphabet: this.getSchemeSourceAlphabet(),
            cacheToken: `${this.state.getSchemeKey()}:${schemeRepresentation.id}`,
            schemeKey: this.state.getSchemeKey(),
            darkMode: this.state.getResolvedDarkMode(),
            themeBuffer: this.themeBuffer,
            columnVisibility: activeRepresentation.columnVisibility,
            setMinimapCache: (id, cache) => this.representationStore.setMinimapCache(id, cache),
            shouldApply,
        });
    }

    scheduleMinimapRebuild() {
        this.minimapRebuildGeneration += 1;
        if (this.minimapRebuildFrameHandle) return;
        this.minimapRebuildFrameHandle = window.requestAnimationFrame(() => {
            this.minimapRebuildFrameHandle = 0;
            void this.flushMinimapRebuild();
        });
    }

    async flushMinimapRebuild() {
        if (this.minimapRebuildInFlight) {
            this.minimapRebuildNeedsRerun = true;
            return;
        }

        const generation = this.minimapRebuildGeneration;
        this.minimapRebuildInFlight = true;
        try {
            await this.rebuildMinimap({
                shouldApply: () => generation === this.minimapRebuildGeneration,
            });
        } finally {
            this.minimapRebuildInFlight = false;
        }

        if (this.minimapRebuildNeedsRerun) {
            this.minimapRebuildNeedsRerun = false;
            this.scheduleMinimapRebuild();
        }
    }
    
    syncAlignmentOverlay(selection = this.state.getSnapshot().selection) {
        this.selectionController?.syncOverlay(selection);
    }

    syncMinimapSelectionBands(selection = this.state.getSelectionSnapshot()) {
        const alignmentStore = this.getActiveAlignmentStore();
        const activeRepresentation = this.getActiveRepresentation();
        this.minimapController?.syncSelectionBands({
            selection,
            alignmentStore,
            columnVisibility: activeRepresentation?.columnVisibility ?? null,
        });
    }

    // Expose selected columns to outer app
    getSelectedColumns() {
        return this.state.getSelectedColumns();
    }
    setSelectedColumns(columns) {
        this.state.setSelectedColumns(new Set(columns));
    }
    clearSelectedColumns() {
        this.state.clearSelection();
    }
    getSelection() {
        return this.selectionController?.getSelection() ?? { mode: "column", ranges: [], componentCount: 0 };
    }
    setSelection(selection) {
        this.selectionController?.setSelection(selection);
    }
    clearSelection() {
        this.selectionController?.clearSelection();
    }

    async exportSelectionAsFasta({
        representationId = null,
        lineWidth = 80,
    } = {}) {
        const selection = this.state.getSelectionSnapshot();
        if (!selection.ranges.length) {
            return "";
        }
        const targetRepresentationId = representationId
            ?? this.getActiveRepresentation()?.id
            ?? this.options.data.activeRepresentationId
            ?? null;
        if (!targetRepresentationId) {
            return "";
        }
        const representation = this.representationStore?.get(targetRepresentationId)
            ?? this.options.data.representations.find((candidate) => candidate.id === targetRepresentationId)
            ?? null;
        if (!representation?.store) {
            throw new Error(`Unknown representation: ${targetRepresentationId}`);
        }
        return buildSelectionFasta({
            alignmentStore: representation.store,
            selectionRanges: selection.ranges,
            lineWidth,
            decodedTileCache: this.decodedTileCache,
        });
    }

    applySelectionMode(mode) {
        this.selectionController?.setSelectionMode(mode);
    }

    getSelectionMode() {
        return this.state.getSnapshot().selection.mode;
    }
    onSelectionChange(callback) {
        return this.selectionController?.onSelectionChange(callback) ?? (() => {});
    }

    createBackendResources() {
        this.lastThemeUniform = null;
        if (this.renderBackend === "cpu") {
            this.gpuResources = null;
            this.pipelineRegistry = null;
            Object.assign(this, createBackendServices({
                backend: this.renderBackend,
                device: null,
                gpuResources: null,
                pipelineRegistry: null,
                decodedTileCache: this.decodedTileCache,
                alphabetRegistry: this.alphabetRegistry,
                getProfileStride: () => SCHEMES[this.state.getSchemeKey()].profileStride,
                getMetricUniformBuffer: () => null,
            }));
            return;
        }
        this.gpuResources = new GpuResourceManager(this.device);

        this.gpuResources.createSingletonBuffer("uniformBuffer", {
            size: new Uint32Array(12).byteLength,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        this.gpuResources.createSingletonBuffer("themeBuffer", {
            size: new Uint32Array(2).byteLength,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });

        this.gpuResources.createSingletonBuffer("dummyStorageBuffer", {
            size: Int32Array.BYTES_PER_ELEMENT,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
            data: new Int32Array([0]),
        });

        this.gpuResources.createSingletonBuffer("metricUniformBuffer", {
            size: Uint32Array.BYTES_PER_ELEMENT * 8,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });

        const atlasTexture = this.gpuResources.setSingleton("atlasTexture", this.device.createTexture({
            size: [this.atlasBitmap.width, this.atlasBitmap.height, 1],
            format: "rgba8unorm",
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
        }));
        this.device.queue.copyExternalImageToTexture(
            { source: this.atlasBitmap },
            { texture: atlasTexture },
            [this.atlasBitmap.width, this.atlasBitmap.height]
        );
        this.gpuResources.setSingleton("atlasSampler", this.device.createSampler({
            magFilter: "linear",
            minFilter: "linear",
        }));

        this.pipelineRegistry = new PipelineRegistry({
            device: this.device,
            format: this.format,
            gpuResources: this.gpuResources,
            computeShaderCodes: this.computeShaderCodes,
            getDummyStorageBuffer: () => this.dummyStorageBuffer,
        });
        Object.assign(this, createBackendServices({
            backend: this.renderBackend,
            device: this.device,
            gpuResources: this.gpuResources,
            pipelineRegistry: this.pipelineRegistry,
            decodedTileCache: this.decodedTileCache,
            alphabetRegistry: this.alphabetRegistry,
            getProfileStride: () => SCHEMES[this.state.getSchemeKey()].profileStride,
            getMetricUniformBuffer: () => this.metricUniformBuffer,
        }));
    }

    loadStaticAssets() {
        this.computeShaderCodes = {
            clustalx: clustalxComputeShaderCode,
            pid: pidComputeShaderCode,
            similarity: blosumComputeShaderCode,
        };
        if (this.pipelineRegistry) {
            this.pipelineRegistry.computeShaderCodes = this.computeShaderCodes;
        }
    }

    bindEvents() {
        let prevThemeDarkMode = null;
        let prevSchemeKey = null;
        this.unsubscribeThemeState = this.state.subscribe((snapshot) => {
            if (
                snapshot.theme.darkMode === prevThemeDarkMode &&
                snapshot.scheme.key === prevSchemeKey
            ) {
                return;
            }

            const themeName = snapshot.theme.darkMode ? "dark" : "light";
            document.documentElement.dataset.theme = themeName;
            this.root.dataset.theme = themeName;
            this.syncThemeBuffer();
            for (const trackStackView of this.trackStackViews) {
                trackStackView.setTheme?.(this.getTrackTheme());
            }
            this.rulerView?.setTheme?.({ darkMode: snapshot.theme.darkMode });
            this.requestRender();

            prevThemeDarkMode = snapshot.theme.darkMode;
            prevSchemeKey = snapshot.scheme.key;
        });

        let prevSelection = null;
        this.unsubscribeSelectionState = this.state.subscribeSelection((selection) => {
            if (!this.selectionController) return;
            if (selection === prevSelection) return;
            prevSelection = selection;
            this.syncAlignmentOverlay(selection);
            this.syncMinimapSelectionBands(selection);
        })

        this.viewportController?.bind();

        // dark/light theme changing
        this.onThemeChange = (event) => {
            if (this.state.getThemeSnapshot().mode === "auto") {
                this.setTheme({ darkMode: event.matches });
            }
        };
        this.themeMedia.addEventListener("change", this.onThemeChange);

        // keyboard scrolling
        this.onKeyDown = (event) => {
            if (!this.getActiveAlignmentState()) return;
            let handled = true;
            const { cellWidth: dx, cellHeight: dy } = this.state.getCellSize();
            const scrollBy = this.alignmentView?.scrollBy?.bind(this.alignmentView)
                ?? ((delta) => this.alignmentView?.scroller?.scrollBy?.(delta));
            if (event.key === "ArrowLeft") {
                scrollBy({ left: -dx, top: 0 });
            } else if (event.key === "ArrowRight") {
                scrollBy({ left: dx, top: 0 });
            } else if (event.key === "ArrowUp") {
                scrollBy({ left: 0, top: -dy });
            } else if (event.key === "ArrowDown") {
                scrollBy({ left: 0, top: dy });
            } else {
                handled = false;
            }
            if (!handled) return;
            event.preventDefault();
        };
        window.addEventListener("keydown", this.onKeyDown);
        
    }

    getRepresentationActivationContext(resetView) {
        const previousSnapshot = this.state.getSnapshot();
        const useSnapshotScroll = !previousSnapshot.alignment.loaded;
        return {
            previousScrollLeft: useSnapshotScroll
                ? previousSnapshot.viewport.scrollLeft
                : (this.alignmentView?.getScrollLeft?.() ?? this.alignmentView?.scroller?.scrollLeft ?? previousSnapshot.viewport.scrollLeft),
            previousScrollTop: useSnapshotScroll
                ? previousSnapshot.viewport.scrollTop
                : (this.alignmentView?.getScrollTop?.() ?? this.alignmentView?.scroller?.scrollTop ?? previousSnapshot.viewport.scrollTop),
            resetView,
        };
    }

    prepareActiveRepresentationState(representation, id, { resetView }) {
        const { store, alphabetId } = representation;
        const { records, totalCols, totalRows } = store;

        this.decodedTileCache.clear();
        this.visibleWindowController?.clear?.();
        this.schemeVisibleWindowController?.clear?.();
        this.visibleWindowState = null;
        this.schemeVisibleWindowState = null;
        this.lastRenderSchemeSourceRepresentationId = null;
        this.isScrolling = false;
        this.selectionController?.clearHover();

        this.state.setAlignment({
            records,
            totalCols,
            totalRows,
            alphabetId,
            representationId: id,
            preserveSelection: !resetView,
            preserveScroll: !resetView,
        });
        this.applyCompatibleSchemeForAlphabet(this.getSchemeSourceAlphabet());
        this.renderer = this.pipelineRegistry?.getRenderer(this.getActiveAlphabet()) ?? null;
        this.alignmentView.renderer = this.renderer;
    }

    async ensureActiveRepresentationDerivedState(representation, id) {
        const { totalRows } = representation.store;

        await this.recomputeColumnProfile();
        if (!representation.columnMetrics) {
            await this.recomputeColumnMetrics();
        }
        if (!representation.columnVisibility) {
            this.recomputeColumnVisibility();
        }

        const activeColumnMetrics = representation.columnMetrics ?? this.getActiveColumnMetrics();
        if (!representation.trackState) {
            this.representationStore.setTrackState(
                id,
                this.trackStateBuilder.build(activeColumnMetrics, totalRows, this.getActiveAlphabet())
            );
        }
    }

    restorePrimaryViewport(representation, { previousScrollLeft, previousScrollTop, resetView }) {
        const { records, totalCols, totalRows } = representation.store;

        this.alignmentView.setAlignmentSize(totalCols, totalRows, representation.columnVisibility);
        this.alignmentView.syncSurfaceSize();
        if (resetView) {
            this.alignmentView.scrollTo(0, 0);
        } else {
            this.alignmentView.scrollTo(previousScrollLeft, previousScrollTop);
        }
        this.headerView?.renderRecords(records);
        this.selectionController?.syncOverlay(this.state.getSelectionSnapshot());
        this.syncMinimapSelectionBands();
        this.requestRender();
    }

    async uploadPrimaryVisibleWindow() {
        await this.performVisibleWindowUpload();
    }

    showLoadedRuntime() {
        this.setLoadedLayoutVisible(true);
    }

    async refreshSecondaryViews(id) {
        this.rebuildTrackDefinitionsFromOptions();
        this.rebuildTrackViews();
        await this.rebuildMinimap();
        this.viewportController?.syncMinimapViewportRect();
        this.syncMinimapSelectionBands();
        this.syncAlignmentOverlay();
        await this.motifController?.refreshActiveRepresentation();
        for (const trackStackView of this.trackStackViews) {
            trackStackView.setTrackContext(this.getTrackContext());
        }
        this.viewportController?.syncTracksViewport();
        this.viewportController?.refreshLayout();
        this.requestRender();
    }

    async ensureRepresentationTrackState(id) {
        const representation = this.representationStore?.get(id);
        if (!representation) return null;

        if (!representation.columnMetrics) {
            const alphabet = this.alphabetRegistry.get(representation.alphabetId);
            const columnMetrics = await this.columnMetricService.compute({
                alignmentStore: representation.store,
                alphabet,
            });
            this.representationStore.setColumnMetrics(id, columnMetrics);
        }

        if (!representation.trackState) {
            const alphabet = this.alphabetRegistry.get(representation.alphabetId);
            this.representationStore.setTrackState(
                id,
                this.trackStateBuilder.build(
                    representation.columnMetrics,
                    representation.store.totalRows,
                    alphabet
                )
            );
        }

        return this.representationStore.get(id);
    }

    async activateRepresentation(id, { resetView = false } = {}) {
        const representation = this.representationStore.get(id);
        if (!representation) {
            throw new Error(`Unknown representation: ${id}`);
        }

        const activationContext = this.getRepresentationActivationContext(resetView);
        this.prepareActiveRepresentationState(representation, id, activationContext);
        await this.ensureActiveRepresentationDerivedState(representation, id);
        this.restorePrimaryViewport(representation, activationContext);
        await this.uploadPrimaryVisibleWindow();
        this.showLoadedRuntime();
        await this.refreshSecondaryViews(id);
    }

    async applyDataOptions(dataOptions, previousData = null) {
        const nextRepresentations = dataOptions?.representations ?? [];
        const previousRepresentations = previousData?.representations ?? [];
        const representationsChanged = !areRepresentationListsEquivalent(nextRepresentations, previousRepresentations);
        const activeIdChanged = dataOptions?.activeRepresentationId !== previousData?.activeRepresentationId;
        const updateMode = this.pendingRepresentationUpdateMode ?? "replace";
        this.pendingRepresentationUpdateMode = null;

        const preserveView = updateMode === "rebuild";

        if (representationsChanged && nextRepresentations.length === 0) {
            await this.resetLoadedData({
                preserveSelection: preserveView,
                preserveScroll: preserveView,
            });
            return;
        }

        if (representationsChanged && nextRepresentations.length > 0) {
            if (updateMode === "replace" || updateMode === "rebuild") {
                await this.resetLoadedData({
                    preserveSelection: preserveView,
                    preserveScroll: preserveView,
                });
            }
            await this.ingestRepresentations(nextRepresentations, {
                activeId: dataOptions?.activeRepresentationId,
                resetView: updateMode === "replace",
            });
            return;
        }

        if (activeIdChanged && dataOptions?.activeRepresentationId) {
            await this.activateRepresentation(dataOptions.activeRepresentationId, { resetView: false });
        }
    }

    async ingestRepresentations(representations, { activeId = null, resetView = true } = {}) {
        const normalizedRepresentations = normalizeRepresentationInputs(representations);
        let nextActiveId = activeId;
        for (const representation of normalizedRepresentations) {
            this.representationStore.register(representation.id, representation.store, {
                alphabetId: representation.alphabetId,
            });
            await this.ensureRepresentationTrackState(representation.id);
            if (nextActiveId == null) {
                nextActiveId = representation.id;
            }
        }

        await this.activateRepresentation(nextActiveId, { resetView });
    }

    async setRepresentations(representations, { activeId = null } = {}) {
        this.pendingRepresentationUpdateMode = "replace";
        await this.setOptions({
            data: {
                representations,
                activeRepresentationId: activeId,
            },
        });
    }

    async setActiveRepresentation(id) {
        await this.setOptions({
            data: {
                activeRepresentationId: id,
            },
        });
    }

    async parseAlignmentInput(input, format = "fasta") {
        return format === "a3m"
            ? await parseA3MAlignment(input)
            : await parseFastaAlignment(input);
    }

    async loadText(text, {
        format = "fasta",
        id = null,
        label = null,
        alphabetId = null,
        activate = true,
        replace = true,
    } = {}) {
        const { representationId } = this.state.getAlignmentIdentity();
        const nextId = id ?? representationId ?? "default";
        const nextAlphabetId = alphabetId ?? this.options.alphabet;
        const parsed = await this.parseAlignmentInput(text, format);
        const nextRepresentation = normalizeRepresentationInput(null, {
            id: nextId,
            label: label ?? nextId,
            store: parsed,
            alphabetId: nextAlphabetId,
        });
        const existingRepresentations = replace
            ? []
            : this.options.data.representations.filter((representation) => representation.id !== nextId);
        this.pendingRepresentationUpdateMode = replace ? "replace" : "append";
        await this.setOptions({
            data: {
                representations: [...existingRepresentations, nextRepresentation],
                activeRepresentationId: activate ? nextId : this.getActiveRepresentation()?.id ?? null,
            },
        });
        return parsed;
    }

    async loadFile(file, {
        format = "auto",
        id = null,
        label = null,
        alphabetId = null,
        activate = true,
        replace = true,
    } = {}) {
        const nextFormat = format === "auto" ? inferAlignmentFormat(file?.name) : format;
        const nextId = id ?? toRepresentationId(file?.name ?? "", "default");
        return this.loadText(file, {
            format: nextFormat,
            id: nextId,
            label: label ?? file?.name ?? nextId,
            alphabetId,
            activate,
            replace,
        });
    }

    async loadFiles(files, {
        format = "auto",
        activate = "first",
        replace = true,
    } = {}) {
        const fileEntries = Array.from(files ?? []).map((entry, index) => {
            if (typeof File !== "undefined" && entry instanceof File) {
                const inferredId = toRepresentationId(entry.name, `representation-${index + 1}`);
                return {
                    file: entry,
                    format,
                    id: inferredId,
                    label: entry.name,
                    alphabetId: this.options.alphabet,
                };
            }
            return {
                ...entry,
                format: entry?.format ?? format,
                id: entry?.id ?? toRepresentationId(entry?.file?.name ?? "", `representation-${index + 1}`),
                label: entry?.label ?? entry?.file?.name ?? entry?.id ?? `representation-${index + 1}`,
                alphabetId: entry?.alphabetId ?? this.options.alphabet,
            };
        });
        const representations = await Promise.all(fileEntries.map(async (entry) => ({
            id: entry.id,
            label: entry.label,
            store: await this.parseAlignmentInput(entry.file, entry.format === "auto" ? inferAlignmentFormat(entry.file?.name) : entry.format),
            alphabetId: entry.alphabetId,
        })));
        const nextRepresentations = replace
            ? representations
            : [
                ...this.options.data.representations.filter((representation) => !representations.some((next) => next.id === representation.id)),
                ...representations,
            ];
        const activeId = activate === "preferred"
            ? choosePreferredRepresentationId(representations)
            : activate === "first"
                ? representations[0]?.id ?? null
                : typeof activate === "string"
                    ? activate
                    : this.getActiveRepresentation()?.id ?? null;
        this.pendingRepresentationUpdateMode = replace ? "replace" : "append";
        await this.setOptions({
            data: {
                representations: nextRepresentations,
                activeRepresentationId: activeId,
            },
        });
        return representations;
    }

    syncThemeBuffer() {
        if (!this.device || !this.themeBuffer) {
            return;
        }
        const snapshot = this.state.getSnapshot();
        const darkMode = snapshot.theme.darkMode ? 1 : 0;
        const colorSchemeId = SCHEMES[snapshot.scheme.key].id;
        if (
            this.lastThemeUniform?.darkMode === darkMode &&
            this.lastThemeUniform?.colorSchemeId === colorSchemeId
        ) {
            return;
        }
        writeThemeUniformBuffer(this.device, this.themeBuffer, darkMode, colorSchemeId);
        this.lastThemeUniform = { darkMode, colorSchemeId };
    }
    
    async applySchemeOption(schemeKey) {
        const snapshot = this.state.getSnapshot();
        const alphabet = this.getSchemeSourceAlphabet();
        if (!this.schemePolicy.isSupported(schemeKey, alphabet)) {
            throw new Error(`Scheme '${schemeKey}' is not supported for alphabet '${alphabet.id}'.`);
        }
        if (
            snapshot.scheme.key === schemeKey
            && this.renderBindGroup
        ) {
            if (this.schemePolicy.requiresColumnProfile(schemeKey)) {
                await this.recomputeColumnProfile();
            }
            this.representationStore?.setMinimapCache(this.getActiveRepresentation()?.id, null);
            this.scheduleVisibleWindowUpload();
            this.scheduleMinimapRebuild();
            this.requestRender();
            return;
        }

        const alignmentState = this.getActiveAlignmentState();
        this.state.setScheme(schemeKey);
        this.syncThemeBuffer();

        if (this.schemePolicy.requiresColumnProfile(schemeKey)) {
            await this.recomputeColumnProfile();
        }

        if (this.visibleWindowState && alignmentState) {
            const renderResources = this.createAlignmentRenderResources();
            this.renderBindGroup = renderResources?.bindGroup ?? null;
            this.alignmentView.setRenderResources(renderResources);

            if (this.renderBindGroup) {
                this.state.setGpuResources({
                    msaTexture: this.visibleWindowState.texture,
                    colProfileBuffer: this.getSchemeSourceRepresentation()?.alignmentState?.colProfileBuffer ?? alignmentState.colProfileBuffer,
                    renderBindGroup: this.renderBindGroup,
                });
            }
        }
        this.representationStore?.setMinimapCache(this.getActiveRepresentation()?.id, null);
        this.scheduleMinimapRebuild();
        this.requestRender();
    }

    async setTheme({ mode, darkMode }) {
        if (mode != null) {
            await this.setOptions({
                theme: { mode },
            });
        }
        if (darkMode != null) {
            this.state.setResolvedDarkMode(darkMode);
            this.scheduleMinimapRebuild();
            this.requestRender();
        }
    }

    applyColumnMasking(masking) {
        this.state.setColumnMasking(masking);
        const columnVisibility = this.recomputeColumnVisibility();
        const activeRepresentation = this.getActiveRepresentation();
        if (!activeRepresentation) return;
        this.representationStore.setMinimapCache(activeRepresentation.id, null);
        this.visibleWindowController?.clear?.();
        this.visibleWindowState = null;
        this.alignmentView?.setAlignmentSize(
            activeRepresentation.store.totalCols,
            activeRepresentation.store.totalRows,
            columnVisibility
        );
        this.syncMinimapSelectionBands();
        this.viewportController?.refreshLayout();
        this.scheduleVisibleWindowUpload();
        this.scheduleMinimapRebuild();
        void this.motifController?.refreshActiveRepresentation();
        this.requestRender();
    }

    getColumnMasking() {
        return this.state.getMaskingSnapshot();
    }

    getColumnVisibility() {
        return this.getActiveRepresentation()?.columnVisibility ?? null;
    }

    async setMotifQuery(query) {
        await this.motifController?.setQuery(query);
    }

    async clearMotifQuery() {
        await this.motifController?.clearQuery();
    }

    getMotifMatchCount() {
        return this.motifController?.getMatchCount() ?? 0;
    }

    applyRulerOptions() {
        const isLoaded = this.root.dataset.loaded !== "false";
        this.rulerView?.setTickInterval?.(this.viewerConfig.views.ruler.tickInterval);
        this.root.style.setProperty("--msa-ruler-height", this.viewerConfig.cssVariables["--msa-ruler-height"]);
        this.alignmentView?.setViewportChrome?.({
            rulerHeight: this.viewerConfig.views.ruler.height,
            rulerVisible: isLoaded && this.viewerConfig.visibility.ruler,
        });
        if (this.rulerRoot) {
            this.rulerRoot.style.height = `${this.viewerConfig.views.ruler.height}px`;
            this.rulerRoot.style.minHeight = `${this.viewerConfig.views.ruler.height}px`;
        }
        if (this.rulerView) {
            this.rulerView.height = this.viewerConfig.views.ruler.height;
            this.rulerView.canvas.style.height = `${this.viewerConfig.views.ruler.height}px`;
            this.rulerView.root.style.height = `${this.viewerConfig.views.ruler.height}px`;
            this.rulerView.render();
        }
        this.viewportController?.refreshLayout();
    }

    applyMinimapOptions() {
        if (this.minimapView) {
            this.minimapView.refreshRendering?.();
        }
    }

    rawColumnToVisible(rawCol) {
        const columnVisibility = this.getColumnVisibility();
        const totalCols = this.getActiveAlignmentStore()?.totalCols ?? 0;
        if (!Number.isInteger(rawCol) || rawCol < 0) return -1;
        if (!columnVisibility) {
            return rawCol < totalCols ? rawCol : -1;
        }
        return columnVisibility.rawToVisible[rawCol] ?? -1;
    }

    visibleColumnToRaw(visibleCol) {
        const columnVisibility = this.getColumnVisibility();
        const totalCols = this.getActiveAlignmentStore()?.totalCols ?? 0;
        if (!Number.isInteger(visibleCol) || visibleCol < 0) return -1;
        if (!columnVisibility) {
            return visibleCol < totalCols ? visibleCol : -1;
        }
        return columnVisibility.visibleToRaw[visibleCol] ?? -1;
    }
    
    async recomputeColumnMetrics() {
        const alignmentStore = this.getActiveAlignmentStore();
        if (!alignmentStore) return;
        const columnMetrics = await this.columnMetricService.compute({
            alignmentStore,
            alphabet: this.getActiveAlphabet(),
        });
        const activeRepresentation = this.getActiveRepresentation();
        if (activeRepresentation) {
            this.representationStore.setColumnMetrics(activeRepresentation.id, columnMetrics);
            this.representationStore.invalidateDerived(activeRepresentation.id);
            this.recomputeColumnVisibility();
        }
    }

    recomputeColumnVisibility() {
        const alignmentStore = this.getActiveAlignmentStore();
        const activeRepresentation = this.getActiveRepresentation();
        if (!alignmentStore || !activeRepresentation) return null;
        const columnVisibility = buildColumnVisibility({
            alignmentStore,
            columnMetrics: activeRepresentation.columnMetrics,
            masking: this.state.getMaskingSnapshot(),
        });
        this.representationStore.setColumnVisibility(activeRepresentation.id, columnVisibility);
        return columnVisibility;
    }
    
    async recomputeColumnProfile() {
        const { schemeRepresentation, schemeAlignmentStore, schemeAlignmentState } = this.getRenderSources();
        const schemeKey = this.state.getSchemeKey();
        if (!schemeAlignmentStore || !schemeAlignmentState || !schemeRepresentation) return;
        if (!this.schemePolicy.requiresColumnProfile(schemeKey)) return;
        if (schemeAlignmentState.profileSchemeKey === schemeKey) return;
        await this.columnProfileService.compute({
            alignmentStore: schemeAlignmentStore,
            alignmentState: schemeAlignmentState,
            schemeKey,
            columnMetrics: schemeRepresentation.columnMetrics,
            alphabet: this.getSchemeSourceAlphabet(),
        });
        this.representationStore?.setProfileData(
            schemeRepresentation.id,
            schemeAlignmentState.colProfileData ?? null
        );
        this.representationStore?.setProfileSchemeKey(schemeRepresentation.id, schemeKey);
    }

    scheduleVisibleWindowUpload() {
        if (this.visibleWindowUploadFrameHandle) return;
        this.visibleWindowUploadFrameHandle = window.requestAnimationFrame(() => {
            this.visibleWindowUploadFrameHandle = 0;
            void this.flushVisibleWindowUpload();
        });
    }

    async flushVisibleWindowUpload() {
        if (this.visibleWindowUploadInFlight) {
            this.visibleWindowUploadNeedsRerun = true;
            return;
        }

        this.visibleWindowUploadInFlight = true;
        try {
            await this.performVisibleWindowUpload();
        } finally {
            this.visibleWindowUploadInFlight = false;
        }

        if (this.visibleWindowUploadNeedsRerun) {
            this.visibleWindowUploadNeedsRerun = false;
            this.scheduleVisibleWindowUpload();
        }
    }

    async performVisibleWindowUpload() {
        const {
            activeRepresentation,
            schemeRepresentation,
            activeAlignmentStore,
            activeAlignmentState,
            schemeAlignmentStore,
            schemeAlignmentState,
            usesSeparateColorSource,
        } = this.getRenderSources();
        if (!activeAlignmentStore || !activeAlignmentState || !schemeRepresentation || !schemeAlignmentStore || !schemeAlignmentState) {
            return;
        }
        this.applyCompatibleSchemeForAlphabet(this.getSchemeSourceAlphabet());

        const nextVisibleWindowState = await this.visibleWindowController.update({
            alignmentStore: activeAlignmentStore,
            bounds: this.viewportController.getVisibleWindowBounds(),
            columnVisibility: activeRepresentation?.columnVisibility ?? null,
        });
        if (!nextVisibleWindowState) {
            return;
        }
        const nextSchemeVisibleWindowState = !usesSeparateColorSource
            ? nextVisibleWindowState
            : await this.schemeVisibleWindowController.update({
                alignmentStore: schemeAlignmentStore,
                bounds: this.viewportController.getVisibleWindowBounds(),
                columnVisibility: activeRepresentation?.columnVisibility ?? null,
            });
        if (!nextSchemeVisibleWindowState) {
            return;
        }
        if (
            this.visibleWindowState?.key === nextVisibleWindowState.key
            && this.schemeVisibleWindowState?.key === nextSchemeVisibleWindowState.key
            && this.lastRenderSchemeSourceRepresentationId === schemeRepresentation.id
        ) {
            return;
        }
        this.visibleWindowState = nextVisibleWindowState;
        this.schemeVisibleWindowState = nextSchemeVisibleWindowState;
        this.lastRenderSchemeSourceRepresentationId = schemeRepresentation.id;
        const renderResources = this.createAlignmentRenderResources();
        this.renderBindGroup = renderResources?.bindGroup ?? null;
        this.alignmentView.setRenderResources(renderResources);
        if (this.renderBindGroup) {
            this.state.setGpuResources({
                msaTexture: nextVisibleWindowState.texture,
                colProfileBuffer: schemeAlignmentState.colProfileBuffer,
                renderBindGroup: this.renderBindGroup,
            });
        }
        this.requestRender();
    }

    createAlignmentRenderResources() {
        const {
            activeRepresentation,
            schemeRepresentation,
            activeAlignmentState,
            schemeAlignmentState,
        } = this.getRenderSources();
        const schemeVisibleWindowState = this.schemeVisibleWindowState ?? this.visibleWindowState;
        if (!this.visibleWindowState || !schemeVisibleWindowState || !activeRepresentation || !schemeRepresentation) {
            return null;
        }
        if (this.renderBackend === "cpu") {
            return {
                kind: "cpu",
                activeWindow: this.visibleWindowState,
                schemeWindow: schemeVisibleWindowState,
                activeAlphabet: this.getActiveAlphabet(),
                schemeAlphabet: this.getSchemeSourceAlphabet(),
                schemeKey: this.state.getSchemeKey(),
                darkMode: this.state.getResolvedDarkMode(),
                schemeColumnMetrics: schemeRepresentation.columnMetrics,
                schemeProfileData: schemeAlignmentState?.colProfileData ?? null,
                activeAlignmentState,
                schemeAlignmentState,
            };
        }
        return {
            kind: "webgpu",
            bindGroup: this.createRenderBindGroup(),
        };
    }

    createRenderBindGroup() {
        const {
            activeAlignmentState,
            schemeRepresentation,
            schemeAlignmentState,
        } = this.getRenderSources();
        const schemeVisibleWindowState = this.schemeVisibleWindowState ?? this.visibleWindowState;
        return this.device.createBindGroup({
            layout: this.renderer.pipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: this.uniformBuffer } },
                { binding: 1, resource: this.visibleWindowState.texture.createView() },
                { binding: 2, resource: schemeVisibleWindowState.texture.createView() },
                { binding: 3, resource: { buffer: (schemeAlignmentState ?? activeAlignmentState).colProfileBuffer } },
                { binding: 4, resource: { buffer: this.themeBuffer } },
                { binding: 5, resource: this.atlasTexture.createView() },
                { binding: 6, resource: this.atlasSampler },
                { binding: 7, resource: { buffer: this.visibleWindowState.visibleColumnMapBuffer } },
                {
                    binding: 8,
                    resource: {
                        buffer: this.pipelineRegistry.getSchemeAuxBuffer(
                            this.state.getSchemeKey(),
                            this.getSchemeSourceAlphabet()
                        )
                    }
                },
            ]
        });
    }
    
    requestRender() {
        this.renderDirty = true;
        if (this.frameHandle) return;
        this.frameHandle = requestAnimationFrame(this.frame);
    }

    frame = () => {
        this.frameHandle = null;
        if (!this.renderDirty) {
            return;
        }
        this.renderDirty = false;
        const alignmentState = this.getActiveAlignmentState();
        if (alignmentState && this.visibleWindowState) {
            this.alignmentView.syncSurfaceSize();
            if (this.renderBackend === "cpu") {
                this.alignmentView.setRenderResources(this.createAlignmentRenderResources());
            }
            this.alignmentView.syncRenderState({
                totalCols: this.getActiveRepresentation()?.columnVisibility?.visibleCount ?? alignmentState.totalCols,
                totalRows: alignmentState.totalRows,
                windowColStart: this.visibleWindowState.colStart,
                windowRowStart: this.visibleWindowState.rowStart,
                windowCols: this.visibleWindowState.colCount,
                windowRows: this.visibleWindowState.rowCount,
            });
            this.alignmentView.renderSurface();
        }
        if (this.renderDirty && !this.frameHandle) {
            this.frameHandle = requestAnimationFrame(this.frame);
        }
    }

    cancelRender() {
        if (this.frameHandle) {
            cancelAnimationFrame(this.frameHandle);
            this.frameHandle = null;
        }
        this.renderDirty = false;
    }

    destroy() {
        this.cancelRender();
        if (this.visibleWindowUploadFrameHandle) {
            cancelAnimationFrame(this.visibleWindowUploadFrameHandle);
            this.visibleWindowUploadFrameHandle = 0;
        }
        if (this.minimapRebuildFrameHandle) {
            cancelAnimationFrame(this.minimapRebuildFrameHandle);
            this.minimapRebuildFrameHandle = 0;
        }
        this.minimapRebuildGeneration += 1;
        
        this.unsubscribeThemeState?.();
        this.unsubscribeViewportState?.();
        this.unsubscribeSelectionState?.();

        this.selectionController?.destroy?.();
        this.motifController = null;
        this.viewportController?.destroy?.();
        this.trackStackViews?.forEach((trackStackView) => trackStackView.destroy?.());
        window.removeEventListener("keydown", this.onKeyDown);
        this.themeMedia.removeEventListener("change", this.onThemeChange);
        this.visibleWindowController?.clear?.();
        this.schemeVisibleWindowController?.clear?.();
        this.representationStore?.destroy?.();
        this.gpuResources?.destroy?.();
    }
}
