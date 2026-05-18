/* Handles rendering of the MSA alignment and headers, as well as scroll synchronization between them. */
import { ViewerState } from "./state/ViewerState.js";
import { HeaderView } from "../views/HeaderView.js";
import { AlignmentView } from "../views/AlignmentView.js";
import { RulerView } from "../views/RulerView.js";
import {
    SCHEMES,
} from "../schemes/registry.js";
import { loadImageBitmap } from "../util.js";
import { TileCache } from "../alignment/tiledStorage.js";
import clustalxComputeShaderCode from "../graphics/shaders/clustalx.compute.wgsl";
import pidComputeShaderCode from "../graphics/shaders/pident.compute.wgsl";
import blosumComputeShaderCode from "../graphics/shaders/blosum.compute.wgsl";
import { MinimapView } from "../views/MinimapView.js";
import { TrackStackView } from "../views/TrackStackView.js";
import { TrackView } from "../views/tracks/TrackView.js";
import { TrackStateBuilder } from "./TrackStateBuilder.js";
import { SchemePolicy } from "./SchemePolicy.js";
import { ViewportController } from "./controllers/ViewportController.js";
import { SelectionController } from "./controllers/SelectionController.js";
import { MotifController } from "./controllers/MotifController.js";
import { defaultAlphabetRegistry } from "../alphabets/index.js";
import { buildColumnVisibility } from "./buildColumnVisibility.js";
import { deriveViewerOptions, mergeViewerOptions, normalizeViewerOptions } from "./config/viewerOptionSchema.js";
import { loadRepresentations } from "./representations/loadRepresentations.js";
import { buildSchemeOptions } from "./schemes/buildSchemeOptions.js";
import { createRafTask } from "./rafTask.js";
import { AUTO_LAYOUT_CSS } from "./viewerStyles.js";
import { BUILT_IN_TRACK_DEFINITIONS } from "./tracks/builtInTrackDefinitions.js";
import { TrackCatalog, buildTrackBindingId } from "./tracks/TrackCatalog.js";
import { exportSelectionAsFasta as buildSelectionFasta } from "./export/exportSelectionAsFasta.js";
import {
    createAlignmentSurface,
    createAlignmentRenderResources,
    createBackendMinimapController,
    createBackendRuntime,
    resolveRenderingBackendKind,
} from "./backends/backendRuntime.js";

function writeThemeUniformBuffer(device, buffer, darkMode, colorScheme) {
    const data = new Uint32Array([darkMode, colorScheme]);
    device.queue.writeBuffer(buffer, 0, data);
}

function normalizeSchemeSource(options, representations = []) {
    const id = options?.rendering?.schemeSourceRepresentationId ?? null;
    if (!id) {
        return null;
    }
    return representations.some((representation) => representation.id === id)
        ? id
        : null;
}

function configChanges(partial = {}) {
    return {
        appearance: partial.theme != null || partial.layout != null,
        theme: partial.theme != null,
        layout: partial.layout != null,
        tracks: partial.tracks != null || partial.trackDisplay != null,
        masking: partial.behavior?.masking != null,
        selectionMode: partial.behavior?.selectionMode != null,
        rendering: partial.rendering?.scheme != null
            || partial.rendering?.schemeSourceRepresentationId !== undefined
            || partial.rendering?.backend != null,
    };
}

function cloneSnapshot(value) {
    if (Array.isArray(value)) {
        return value.map(cloneSnapshot);
    }
    if (!value || typeof value !== "object") {
        return value;
    }
    return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [key, cloneSnapshot(item)])
    );
}

function createRootSlots() {
    return {
        alignment: null,
        minimap: null,
        header: null,
        ruler: null,
        trackLabel: null,
        trackBody: null,
    };
}

function createRenderWindowState() {
    return {
        active: null,
        scheme: null,
        schemeSourceId: null,
        bindGroup: null,
    };
}

export class MSAViewer {
    constructor(options = {}) {
        const { root, runtime = {}, config = {} } = options ?? {};
        this.root = root;
        if (!this.root) {
            throw new Error("MSAViewer requires root.");
        }
        this.device = runtime.device ?? null;
        this.format = runtime.format ?? null;
        this.themeMedia = runtime.themeMedia ?? window.matchMedia("(prefers-color-scheme: dark)");
        this.alphabetRegistry = runtime.alphabetRegistry ?? defaultAlphabetRegistry;
        this.options = normalizeViewerOptions(config);
        this.dataOptions = { representations: [], activeRepresentationId: null };
        this.options.rendering.schemeSourceRepresentationId = normalizeSchemeSource(
            this.options,
            this.dataOptions.representations
        );
        this.viewerConfig = deriveViewerOptions(this.options);
        this.renderBackend = resolveRenderingBackendKind(this.options.rendering.backend, {
            hasWebGPU: typeof navigator !== "undefined" && !!navigator.gpu,
        });
        this.eventTarget = new EventTarget();
        this.cleanup = [];
        this.initialized = false;
        this.initPromise = null;
        this.destroyed = false;
        const initialAlphabet = typeof this.options.alphabet === "string"
            ? this.alphabetRegistry.get(this.options.alphabet)
            : this.options.alphabet;
        if (!initialAlphabet) {
            throw new Error(`Unknown alphabet: ${this.options.alphabet}`);
        }
        
        this.state = new ViewerState({
            schemeKey: this.options.rendering.scheme,
            themeMode: this.options.theme.mode,
            darkMode: this.#darkModeForTheme(this.options.theme.mode),
            alphabetId: initialAlphabet.id,
            cellWidth: this.viewerConfig.layout.cell.width,
            cellHeight: this.viewerConfig.layout.cell.height,
            hideInsertionColumns: this.options.behavior.masking.hideInsertionColumns,
            gapThreshold: this.options.behavior.masking.gapThreshold,
        });

        this.atlasBitmap = null;
        this.shadowRootRef = null;
        this.autoLayoutShell = null;
        this.roots = createRootSlots();
        this.headerView = null;
        this.alignmentView = null;
        this.rulerView = null;
        this.minimapView = null;
        this.trackStackViews = [];
        this.renderer = null;
        this.gpuResources = null;
        this.pipelineRegistry = null;
        this.renderWindow = createRenderWindowState();

        this.computeShaderCodes = {};
        this.representationStore = null;
        this.trackStateBuilder = new TrackStateBuilder();
        this.trackCatalog = null;
        this.enabledTrackBindings = [];
        this.minimapController = null;
        this.viewportController = null;
        this.selectionController = null;
        this.motifController = null;
        this.columnMetricService = null;
        this.columnProfileService = null;
        this.windowController = null;
        this.schemeWindowController = null;
        this.schemePolicy = new SchemePolicy({
            getActiveAlphabet: () => this.#activeAlphabet(),
        });
        this.decodedTileCache = new TileCache(64 * 1024 * 1024);
        this.viewportOverscanRows = 8;
        this.viewportOverscanCols = 32;
        
        this.isScrolling = false;
        
        this.frameHandle = null;
        this.renderDirty = false;
        this.uploadTask = createRafTask(() => this.#uploadWindow());
        this.minimapTask = createRafTask(({ isCurrent }) => this.#rebuildMinimap({
            shouldApply: isCurrent,
        }));

        this.#rebuildTrackDefs();
        if (this.options.behavior.selectionMode !== "column") {
            this.state.setSelectionMode(this.options.behavior.selectionMode);
        }
        queueMicrotask(() => {
            if (this.destroyed || this.initialized || this.initPromise) return;
            void this.#init().catch((error) => this.#emit("error", { error }));
        });
    }

    #assertLive() {
        if (this.destroyed) {
            throw new Error("MSAViewer has been destroyed.");
        }
    }

    #darkModeForTheme(mode = this.options.theme.mode) {
        if (mode === "dark") return true;
        if (mode === "light") return false;
        return this.themeMedia.matches;
    }

    #configuredAlphabet(options = this.options) {
        const alphabet = typeof options.alphabet === "string"
            ? this.alphabetRegistry.get(options.alphabet)
            : options.alphabet;
        if (!alphabet) {
            throw new Error(`Unknown alphabet: ${options.alphabet}`);
        }
        return alphabet;
    }

    #syncState(options = this.options) {
        const alphabet = this.#configuredAlphabet(options);
        this.state.setActiveAlphabetId(alphabet.id);
        this.state.setCellSize(this.viewerConfig.layout.cell.width, this.viewerConfig.layout.cell.height);
        this.state.setThemeMode(options.theme.mode);
        this.state.setResolvedDarkMode(this.#darkModeForTheme(options.theme.mode));
        this.state.setColumnMasking(options.behavior.masking);
        this.state.setSelectionMode(options.behavior.selectionMode);
        this.options.rendering.scheme = this.schemePolicy.getCompatibleScheme(options.rendering.scheme, alphabet);
        this.state.setScheme(this.options.rendering.scheme);
    }

    addEventListener(type, listener, options) {
        this.eventTarget.addEventListener(type, listener, options);
    }

    removeEventListener(type, listener, options) {
        this.eventTarget.removeEventListener(type, listener, options);
    }

    #emit(type, detail) {
        this.eventTarget.dispatchEvent(new CustomEvent(type, { detail }));
    }

    getConfig() {
        return cloneSnapshot(this.options);
    }

    getBackend() {
        return this.renderBackend;
    }

    #handleHeaderClick(rowIndex, originalEvent) {
        const records = this.#activeStore()?.records ?? [];
        const record = records[rowIndex] ?? null;
        if (!record) return;
        const active = this.#activeRepresentation();
        const detail = {
            rowIndex,
            record,
            representationId: active?.id ?? this.state.getAlignmentIdentity().representationId ?? null,
            alphabetId: this.#activeAlphabet()?.id ?? this.state.getAlignmentIdentity().alphabetId ?? null,
            originalEvent,
        };
        this.#emit("sequenceclick", detail);
        this.options.interactions.onSequenceClick?.(detail);
    }

    getRepresentations() {
        return this.dataOptions.representations
            .map((representation) => this.#representationSummary(representation))
            .filter(Boolean);
    }

    getSchemes() {
        return buildSchemeOptions({
            schemes: SCHEMES,
            representations: this.getRepresentations(),
            activeAlphabet: this.#activeAlphabet(),
            getAlphabet: (id) => this.alphabetRegistry.get(id),
            isSupported: (key, alphabet) => this.schemePolicy.isSupported(key, alphabet),
        });
    }

    #renderSources() {
        const active = this.#activeRepresentation();
        const scheme = this.#getRepresentation(
            this.options.rendering.schemeSourceRepresentationId
                ?? active?.id
                ?? this.dataOptions.activeRepresentationId
                ?? null
        ) ?? active;
        const activeAlphabet = active
            ? this.alphabetRegistry.get(active.alphabetId)
            : this.#activeAlphabet();
        const schemeAlphabet = scheme
            ? this.alphabetRegistry.get(scheme.alphabetId)
            : activeAlphabet;
        return {
            activeRepresentation: active,
            schemeRepresentation: scheme,
            activeAlphabet,
            schemeAlphabet,
            activeAlignmentStore: active?.store ?? null,
            activeAlignmentState: active?.alignmentState ?? null,
            schemeAlignmentStore: scheme?.store ?? null,
            schemeAlignmentState: scheme?.alignmentState ?? null,
            usesSeparateColorSource: Boolean(active && scheme && active.id !== scheme.id),
        };
    }

    getTracks() {
        return this.trackCatalog?.tracks ?? [];
    }

    #trackDefinition(binding) {
        return this.trackCatalog?.resolveDefinition(binding) ?? null;
    }

    #rebuildTrackDefs() {
        const activeId = this.state.getAlignmentIdentity().representationId
            ?? this.dataOptions.activeRepresentationId
            ?? null;
        this.trackCatalog = new TrackCatalog({
            builtInDefinitions: BUILT_IN_TRACK_DEFINITIONS,
            userDefinitions: this.options.tracks,
            trackDisplay: this.options.trackDisplay,
            representations: this.getRepresentations(),
            activeId,
        });
        this.enabledTrackBindings = this.trackCatalog.enabledBindings;
    }

    #isLoaded() {
        return this.root.dataset.loaded !== "false";
    }

    #applyHeaderView() {
        if (this.headerView) {
            this.headerView.width = this.viewerConfig.views.header.width;
            this.headerView.fontFamily = this.viewerConfig.views.header.fontFamily;
            this.headerView.fontSize = this.viewerConfig.views.header.fontSize;
            this.headerView.applyStyles();
            const records = this.#activeStore()?.records;
            if (records) {
                this.headerView.renderRecords(records);
            }
        }
    }

    #applyRulerView() {
        this.rulerView?.setTickInterval?.(this.viewerConfig.views.ruler.tickInterval);
        if (this.roots.ruler) {
            this.roots.ruler.style.height = `${this.viewerConfig.views.ruler.height}px`;
            this.roots.ruler.style.minHeight = `${this.viewerConfig.views.ruler.height}px`;
        }
        if (this.rulerView) {
            this.rulerView.height = this.viewerConfig.views.ruler.height;
            this.rulerView.canvas.style.height = `${this.viewerConfig.views.ruler.height}px`;
            this.rulerView.root.style.height = `${this.viewerConfig.views.ruler.height}px`;
            this.rulerView.render();
        }
    }

    #trackTheme() {
        return {
            darkMode: this.state.getResolvedDarkMode(),
            uiFontFamily: this.options.theme.typography.uiFontFamily,
        };
    }

    #rebuildTrackViews() {
        for (const trackStackView of this.trackStackViews) {
            trackStackView.clear();
        }
        this.#syncTracks();
    }

    #clearActiveWindowState() {
        this.windowController?.clear?.();
        this.renderWindow.active = null;
        this.renderWindow.bindGroup = null;
    }

    #clearWindowState() {
        this.#clearActiveWindowState();
        this.schemeWindowController?.clear?.();
        this.renderWindow.scheme = null;
        this.renderWindow.schemeSourceId = null;
    }

    #clearActiveInteractionState() {
        this.decodedTileCache.clear();
        this.#clearWindowState();
        this.selectionController?.clearHover();
    }

    #clearData({ preserveSelection = false, preserveScroll = false } = {}) {
        this.#clearActiveInteractionState();
        this.representationStore?.destroy?.();
        this.state.clearGpuResources();
        this.state.clearAlignment({ preserveSelection, preserveScroll });
        this.minimapView?.clear?.();
        this.alignmentView?.setAlignmentSize(0, 0, null);
        if (!preserveScroll) {
            this.alignmentView?.scrollTo?.(0, 0);
        }
        this.alignmentView?.setMotifState?.({ motifHitsByRow: null });
        this.headerView?.renderRecords?.([]);
        for (const trackStackView of this.trackStackViews) {
            trackStackView.clear();
        }
    }

    #applyAppearance() {
        this.#applyViewerFrame();
        for (const trackStackView of this.trackStackViews) {
            trackStackView.setTheme(this.#trackTheme());
        }
    }

    #destroyRuntime() {
        this.#cancelRender();
        this.uploadTask.cancel();
        this.minimapTask.cancel();

        this.selectionController?.destroy?.();
        this.viewportController?.destroy?.();
        this.minimapView?.destroy?.();
        this.rulerView?.destroy?.();
        this.headerView?.destroy?.();
        this.trackStackViews.forEach((trackStackView) => trackStackView.destroy?.());
        this.motifController = null;
        this.headerView = null;
        this.alignmentView = null;
        this.rulerView = null;
        this.minimapView = null;
        this.trackStackViews = [];
        this.roots = createRootSlots();

        this.#clearWindowState();
        this.representationStore?.destroy?.();
        this.gpuResources?.destroy?.();
        this.state.clearGpuResources();
    }

    async #recreateBackend(nextBackend) {
        const currentScrollLeft = this.alignmentView?.getScrollLeft?.() ?? this.alignmentView?.scroller?.scrollLeft ?? this.state.getViewportSnapshot().scrollLeft;
        const currentScrollTop = this.alignmentView?.getScrollTop?.() ?? this.alignmentView?.scroller?.scrollTop ?? this.state.getViewportSnapshot().scrollTop;
        this.state.setViewportScroll(currentScrollLeft, currentScrollTop);

        this.#destroyRuntime();
        this.renderBackend = nextBackend;

        await this.#startRuntime();

        await this.#setRepresentations(this.dataOptions.representations, {
            activeId: this.dataOptions.activeRepresentationId,
            resetView: false,
        });
    }

    async #applyRendering(nextOptions, previousOptions) {
        const nextBackend = resolveRenderingBackendKind(nextOptions.rendering.backend, {
            hasWebGPU: typeof navigator !== "undefined" && !!navigator.gpu,
        });
        if (nextBackend !== this.renderBackend) {
            await this.#recreateBackend(nextBackend);
            return;
        }
        if (
            nextOptions.rendering.scheme !== previousOptions.rendering.scheme
            || nextOptions.rendering.schemeSourceRepresentationId !== previousOptions.rendering.schemeSourceRepresentationId
        ) {
            await this.#applyScheme(nextOptions.rendering.scheme);
        }
    }

    async #applyConfigChanges(changed, nextOptions, previousOptions) {
        if (changed.theme && nextOptions.theme.mode !== previousOptions.theme.mode) {
            this.state.setThemeMode(nextOptions.theme.mode);
            this.state.setResolvedDarkMode(this.#darkModeForTheme(nextOptions.theme.mode));
            this.minimapTask.schedule();
        }
        if (changed.appearance) {
            this.#applyAppearance();
        }
        if (changed.layout) {
            this.state.setCellSize(this.viewerConfig.layout.cell.width, this.viewerConfig.layout.cell.height);
            this.#applyViewerFrame();
            this.minimapView?.refreshRendering?.();
        }
        if (changed.tracks) {
            this.#rebuildTrackDefs();
            await this.#ensureEnabledTrackState();
            this.#rebuildTrackViews();
        }
        if (changed.masking) await this.#applyMasking(nextOptions.behavior.masking);
        if (
            changed.selectionMode
            && nextOptions.behavior.selectionMode !== this.state.getSelectionMode()
        ) {
            this.#setSelectionMode(nextOptions.behavior.selectionMode);
        }
        if (changed.rendering) await this.#applyRendering(nextOptions, previousOptions);
    }

    async setConfig(partialConfig = {}) {
        this.#assertLive();
        if (this.initPromise && !this.initialized) {
            await this.initPromise;
        }

        const changed = configChanges(partialConfig);
        const previousOptions = this.options;
        const nextOptions = normalizeViewerOptions(mergeViewerOptions(previousOptions, partialConfig));
        nextOptions.rendering.schemeSourceRepresentationId = normalizeSchemeSource(nextOptions, this.dataOptions.representations);
        this.options = nextOptions;
        this.viewerConfig = deriveViewerOptions(nextOptions);

        if (!this.initialized) {
            this.renderBackend = resolveRenderingBackendKind(nextOptions.rendering.backend, {
                hasWebGPU: typeof navigator !== "undefined" && !!navigator.gpu,
            });
            this.#syncState(nextOptions);
            this.#rebuildTrackDefs();
            return;
        }

        await this.#applyConfigChanges(changed, nextOptions, previousOptions);
        this.viewportController?.refreshLayout();
        this.#requestRender();
    }

    #getRepresentation(id) {
        if (!id) return null;
        return this.representationStore?.get(id)
            ?? this.dataOptions.representations.find((representation) => representation.id === id)
            ?? null;
    }

    #activeRepresentation() {
        const { representationId } = this.state.getAlignmentIdentity();
        if (!representationId) return null;
        return this.#getRepresentation(representationId);
    }

    #representationSummary(representation) {
        if (!representation) return null;
        const store = this.#getRepresentation(representation.id)?.store ?? representation.store ?? null;
        const label = representation.label ?? representation.id;
        const alphabet = this.alphabetRegistry.get(representation.alphabetId);
        return {
            id: representation.id,
            label,
            alphabetId: representation.alphabetId,
            alphabetLabel: alphabet?.label ?? representation.alphabetId,
            alphabetShortLabel: alphabet?.shortLabel ?? alphabet?.label ?? representation.alphabetId,
            displayLabel: `${label} (${alphabet?.label ?? representation.alphabetId})`,
            totalRows: store?.totalRows ?? null,
            totalCols: store?.totalCols ?? null,
        };
    }

    getActiveRepresentation() {
        return this.#representationSummary(this.#activeRepresentation());
    }

    #activeAlphabet() {
        const active = this.#activeRepresentation();
        if (active) {
            return this.alphabetRegistry.get(active.alphabetId);
        }
        return this.alphabetRegistry.get(this.state.getAlignmentIdentity().alphabetId);
    }

    #activeStore() {
        return this.#activeRepresentation()?.store ?? null;
    }

    #activeState() {
        return this.#activeRepresentation()?.alignmentState ?? null;
    }

    get #uniformBuffer()       { return this.gpuResources?.getSingleton("uniformBuffer")       ?? null; }
    get #themeBuffer()         { return this.gpuResources?.getSingleton("themeBuffer")         ?? null; }

    #applyCompatibleScheme(alphabet = this.#activeAlphabet()) {
        const schemeKey = this.state.getSchemeKey();
        const compatibleSchemeKey = this.schemePolicy.getCompatibleScheme(schemeKey, alphabet);
        if (compatibleSchemeKey && compatibleSchemeKey !== schemeKey) {
            this.options.rendering.scheme = compatibleSchemeKey;
            this.state.setScheme(compatibleSchemeKey);
            this.#syncThemeBuffer();
        }
        return compatibleSchemeKey;
    }

    async #startRuntime({ bindEvents = false } = {}) {
        await this.#ensureGpu();
        this.#assertLive();
        if (!this.atlasBitmap) {
            this.atlasBitmap = await loadImageBitmap(new URL("../graphics/atlas.png", import.meta.url));
        }
        this.#assertLive();
        this.#createBackend();
        this.#createViews();
        this.#applyViewerFrame();
        if (this.renderBackend === "webgpu") {
            this.#loadStaticAssets();
        }
        if (bindEvents) {
            this.#bindEvents();
        } else {
            this.viewportController?.bind();
        }
        this.#syncThemeBuffer();
    }
    
    async #init() {
        this.#assertLive();
        if (this.initialized) {
            return this;
        }
        if (!this.initPromise) {
            this.initPromise = (async () => {
                this.renderBackend = resolveRenderingBackendKind(this.options.rendering.backend, {
                    hasWebGPU: typeof navigator !== "undefined" && !!navigator.gpu,
                });
                this.#syncState();
                this.#rebuildTrackDefs();
                await this.#startRuntime({ bindEvents: true });
                this.#setLoaded(false);
                this.#requestRender();
                this.#assertLive();
                this.initialized = true;
                return this;
            })().catch((error) => {
                this.initPromise = null;
                throw error;
            });
        }
        return this.initPromise;
    }
    
    async #ensureGpu() {
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
    
    #createLayout() {
        const mountRoot = this.#mountRoot();
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

        return {
            alignment: alignmentRoot,
            minimap: minimapRoot,
        };
    }

    #mountRoot() {
        if (!this.shadowRootRef) {
            this.shadowRootRef = this.root.shadowRoot ?? this.root.attachShadow({ mode: "open" });
        }
        this.#applyCssVariables();
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

    #applyCssVariables(loaded = this.#isLoaded()) {
        for (const [key, value] of Object.entries(this.viewerConfig.cssVariables)) {
            this.root.style.setProperty(
                key,
                key === "--msa-header-width" && !loaded ? "0px" : value
            );
        }
    }

    #setHidden(element, hidden) {
        if (element) {
            element.hidden = hidden;
        }
    }

    #applyViewerFrame() {
        const loaded = this.#isLoaded();
        const { visibility, views } = this.viewerConfig;
        this.#applyCssVariables(loaded);
        this.alignmentView?.setViewportChrome?.({
            headerWidth: views.header.width,
            rulerHeight: views.ruler.height,
            headerVisible: loaded && visibility.header,
            rulerVisible: loaded && visibility.ruler,
        });
        this.alignmentView?.setLoadedState?.(loaded);
        this.#setHidden(this.alignmentView?.canvas, !loaded);
        this.#setHidden(this.alignmentView?.motifOverlay, !loaded);
        this.#setHidden(this.alignmentView?.overlay, !loaded);
        this.#setHidden(this.roots.header, !loaded || !visibility.header);
        this.#setHidden(this.roots.ruler, !loaded || !visibility.ruler);
        this.#setHidden(this.roots.minimap, !loaded || !visibility.minimap);
        this.#setHidden(this.roots.trackLabel, !loaded || !visibility.tracks);
        this.#setHidden(this.roots.trackBody, !loaded || !visibility.tracks);
        this.#applyHeaderView();
        this.#applyRulerView();
        this.alignmentView?.syncSurfaceSize?.();
    }

    #createViews() {
        this.roots = {
            ...createRootSlots(),
            ...this.#createLayout(),
        };
        this.#createAlignmentView();
        this.headerView = this.#createHeaderView();
        this.minimapView = this.#createMinimapView();
        this.rulerView = this.#createRulerView();
        this.trackStackViews = this.#createTrackStackViews();
        this.#createControllers();
        this.selectionController.bind();
        this.rulerView?.setTheme?.({ darkMode: this.state.getResolvedDarkMode() });

        this.#setLoaded(false);
    }

    #createAlignmentView() {
        this.renderer = this.pipelineRegistry?.getRenderer(this.#activeAlphabet()) ?? null;
        const alignmentSurface = createAlignmentSurface({
            backend: this.renderBackend,
            device: this.device,
            format: this.format,
            uniformBuffer: this.#uniformBuffer,
            renderer: this.renderer,
            atlasBitmap: this.atlasBitmap,
        });
        this.alignmentView = new AlignmentView({
            root: this.roots.alignment,
            surfaceRenderer: alignmentSurface,
            getCellWidth: () => this.state.getCellSize().cellWidth,
            getCellHeight: () => this.state.getCellSize().cellHeight,
            headerWidth: this.viewerConfig.visibility.header ? this.viewerConfig.views.header.width : 0,
            rulerHeight: this.viewerConfig.visibility.ruler ? this.viewerConfig.views.ruler.height : 0,
            headerVisible: this.viewerConfig.visibility.header,
            rulerVisible: this.viewerConfig.visibility.ruler,
        });
        this.roots.header = this.alignmentView.headerSlot;
        this.roots.ruler = this.alignmentView.rulerSlot;
        this.roots.trackLabel = this.alignmentView.trackLabelSlot;
        this.roots.trackBody = this.alignmentView.trackBodySlot;
    }

    #createHeaderView() {
        return this.roots.header ? new HeaderView({
            root: this.roots.header,
            rowHeight: this.state.getCellSize().cellHeight,
            width: this.viewerConfig.views.header.width,
            fontFamily: this.viewerConfig.views.header.fontFamily,
            fontSize: this.viewerConfig.views.header.fontSize,
            onRowClick: (rowIndex, event) => this.#handleHeaderClick(rowIndex, event),
        }) : null;
    }

    #createMinimapView() {
        const minimapView = this.roots.minimap ? new MinimapView({ root: this.roots.minimap }) : null;
        this.minimapController = createBackendMinimapController({
            backend: this.renderBackend,
            device: this.device,
            gpuResources: this.gpuResources,
            pipelineRegistry: this.pipelineRegistry,
            minimapView,
            decodedTileCache: this.decodedTileCache,
        });
        return minimapView;
    }

    #createRulerView() {
        return this.roots.ruler ? new RulerView({
            root: this.roots.ruler,
            tickInterval: this.viewerConfig.views.ruler.tickInterval,
            height: this.viewerConfig.views.ruler.height,
        }) : null;
    }

    #createTrackStackViews() {
        return this.viewerConfig.visibility.tracks
            ? [
                new TrackStackView({
                    root: this.roots.alignment,
                    labelRoot: this.roots.trackLabel,
                    bodyRoot: this.roots.trackBody,
                }),
            ]
            : [];
    }

    #createControllers() {
        this.viewportController = new ViewportController({
            state: this.state,
            alignmentView: this.alignmentView,
            headerView: this.headerView,
            rulerView: this.rulerView,
            minimapView: this.minimapView,
            getTrackStackViews: () => this.trackStackViews,
            minimapController: this.minimapController,
            getAlignmentStore: () => this.#activeStore(),
            getColumnVisibility: () => this.#activeRepresentation()?.columnVisibility ?? null,
            getOverscanRows: () => this.viewportOverscanRows,
            getOverscanCols: () => this.viewportOverscanCols,
            uploadVisibleWindow: () => this.uploadTask.schedule(),
            requestRender: () => this.#requestRender(),
            onHoverReset: () => this.selectionController?.clearHover(),
            onSetScrolling: (isScrolling) => {
                this.isScrolling = isScrolling;
            },
        });
        this.selectionController = new SelectionController({
            state: this.state,
            alignmentView: this.alignmentView,
            getCoordsFromEvent: (event) => this.#cellFromPointer(event),
            getIsScrolling: () => this.isScrolling,
        });
        this.motifController = new MotifController({
            alignmentView: this.alignmentView,
            decodedTileCache: this.decodedTileCache,
            representationStore: this.representationStore,
            getActiveRepresentation: () => this.#activeRepresentation(),
            getAlignmentStore: () => this.#activeStore(),
            getColumnVisibility: () => this.#activeRepresentation()?.columnVisibility ?? null,
        });
    }

    #createTrack(binding) {
        const definition = this.#trackDefinition(binding);
        return definition?.lanes?.length ? new TrackView(definition) : null;
    }

    #trackContext() {
        const active = this.#activeRepresentation();
        return {
            activeRepresentationId: active?.id ?? null,
            activeTrackState: active?.trackState ?? null,
            getRepresentation: (id) => this.representationStore?.get(id) ?? null,
            getAlphabet: (id) => (id ? this.alphabetRegistry.get(id) ?? null : null),
            getActiveAlphabet: () => this.#activeAlphabet(),
        };
    }

    #syncTracks() {
        if (this.trackStackViews.length === 0) return;
        const enabledTrackBindings = this.enabledTrackBindings
            .filter((binding) => this.#trackDefinition(binding));
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
                const track = this.#createTrack(binding);
                if (!track) return;
                trackStackView.addTrackAt(track, index);
            });
            trackStackView.setTheme(this.#trackTheme());
            trackStackView.setTrackContext(this.#trackContext());
        }
        this.alignmentView?.syncSurfaceSize?.();
        this.viewportController?.syncTracksViewport();
    }

    async setTrackEnabled(track, enabled) {
        const trackDisplay = this.trackCatalog?.toggle(track, enabled);
        if (!trackDisplay) return;
        await this.setConfig({
            trackDisplay,
        });
    }
    #cellFromPointer({ clientX, clientY }) {
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
        const columnVisibility = this.#activeRepresentation()?.columnVisibility;
        const col = columnVisibility?.visibleToRaw?.[visibleCol] ?? visibleCol;
        const row = Math.min(snapshot.alignment.totalRows - 1, Math.floor(contentY / cellHeight));
        return [col, row];
    }

    #setLoaded(loaded) {
        this.root.dataset.loaded = loaded ? "true" : "false";
        this.#applyViewerFrame();
    }
    
    async #rebuildMinimap({ shouldApply = null } = {}) {
        const {
            activeRepresentation,
            schemeRepresentation,
            schemeAlphabet,
            schemeAlignmentStore,
            schemeAlignmentState,
        } = this.#renderSources();
        if (!activeRepresentation || !schemeRepresentation || !schemeAlignmentStore || !schemeAlignmentState || !this.minimapController) return;
        this.#applyCompatibleScheme(schemeAlphabet);
        await this.minimapController.rebuildForRepresentation(activeRepresentation, {
            alignmentState: schemeAlignmentState,
            alignmentStore: schemeAlignmentStore,
            alphabet: schemeAlphabet,
            cacheToken: `${this.state.getSchemeKey()}:${schemeRepresentation.id}`,
            schemeKey: this.state.getSchemeKey(),
            darkMode: this.state.getResolvedDarkMode(),
            themeBuffer: this.#themeBuffer,
            columnVisibility: activeRepresentation.columnVisibility,
            setMinimapCache: (id, cache) => this.representationStore.setMinimapCache(id, cache),
            shouldApply,
        });
    }

    #syncOverlay(selection = this.state.getSnapshot().selection) {
        this.selectionController?.syncOverlay(selection);
    }

    #syncMinimapSelection(selection = this.state.getSelectionSnapshot()) {
        const alignmentStore = this.#activeStore();
        const active = this.#activeRepresentation();
        this.minimapController?.syncSelectionBands({
            selection,
            alignmentStore,
            columnVisibility: active?.columnVisibility ?? null,
        });
    }

    getSelection() {
        return this.state.getSelectionSnapshot();
    }
    setSelection({ mode, ranges } = {}) {
        if (mode != null) {
            this.#setSelectionMode(mode);
        }
        if (ranges != null) {
            this.state.setSelectionRanges(ranges);
        }
    }
    clearSelection() {
        this.state.clearSelection();
    }

    async exportSelectionAsFasta({
        representationId = null,
        lineWidth = 80,
    } = {}) {
        await this.#init();
        const selection = this.state.getSelectionSnapshot();
        if (!selection.ranges.length) {
            return "";
        }
        const targetId = representationId
            ?? this.#activeRepresentation()?.id
            ?? this.dataOptions.activeRepresentationId
            ?? null;
        if (!targetId) {
            return "";
        }
        const representation = this.representationStore?.get(targetId)
            ?? this.dataOptions.representations.find((candidate) => candidate.id === targetId)
            ?? null;
        if (!representation?.store) {
            throw new Error(`Unknown representation: ${targetId}`);
        }
        return buildSelectionFasta({
            alignmentStore: representation.store,
            selectionRanges: selection.ranges,
            lineWidth,
            decodedTileCache: this.decodedTileCache,
        });
    }

    #setSelectionMode(mode) {
        this.state.setSelectionMode(mode);
        this.selectionController?.resetDrag();
    }

    #createBackend() {
        this.lastThemeUniform = null;
        Object.assign(this, createBackendRuntime({
            backend: this.renderBackend,
            device: this.device,
            format: this.format,
            atlasBitmap: this.atlasBitmap,
            computeShaderCodes: this.computeShaderCodes,
            decodedTileCache: this.decodedTileCache,
            alphabetRegistry: this.alphabetRegistry,
            getProfileStride: () => SCHEMES[this.state.getSchemeKey()].profileStride,
        }));
    }

    #loadStaticAssets() {
        this.computeShaderCodes = {
            clustalx: clustalxComputeShaderCode,
            pid: pidComputeShaderCode,
            similarity: blosumComputeShaderCode,
        };
        if (this.pipelineRegistry) {
            this.pipelineRegistry.computeShaderCodes = this.computeShaderCodes;
        }
    }

    #bindEvents() {
        this.#bindStateEvents();
        this.viewportController?.bind();

        const onThemeChange = (event) => this.#handleThemeChange(event);
        this.themeMedia.addEventListener("change", onThemeChange);
        this.cleanup.push(() => this.themeMedia.removeEventListener("change", onThemeChange));

        const onKeyDown = (event) => this.#handleKeyDown(event);
        window.addEventListener("keydown", onKeyDown);
        this.cleanup.push(() => window.removeEventListener("keydown", onKeyDown));
    }

    #bindStateEvents() {
        let prevThemeDarkMode = null;
        let prevSchemeKey = null;
        this.cleanup.push(this.state.subscribe((snapshot) => {
            if (
                snapshot.theme.darkMode === prevThemeDarkMode &&
                snapshot.scheme.key === prevSchemeKey
            ) {
                return;
            }

            const themeName = snapshot.theme.darkMode ? "dark" : "light";
            this.root.dataset.theme = themeName;
            this.#syncThemeBuffer();
            for (const trackStackView of this.trackStackViews) {
                trackStackView.setTheme?.(this.#trackTheme());
            }
            this.rulerView?.setTheme?.({ darkMode: snapshot.theme.darkMode });
            this.#requestRender();

            prevThemeDarkMode = snapshot.theme.darkMode;
            prevSchemeKey = snapshot.scheme.key;
        }));

        let prevSelection = null;
        this.cleanup.push(this.state.subscribeSelection((selection) => {
            if (!this.selectionController) return;
            if (selection === prevSelection) return;
            prevSelection = selection;
            this.#syncOverlay(selection);
            this.#syncMinimapSelection(selection);
            this.#emit("selectionchange", { selection });
        }));
    }

    #handleThemeChange(event) {
        if (this.state.getThemeSnapshot().mode !== "auto") return;
        this.state.setResolvedDarkMode(event.matches);
        this.minimapTask.schedule();
        this.#requestRender();
    }

    #handleKeyDown(event) {
        if (!this.#activeState()) return;
        const { cellWidth: dx, cellHeight: dy } = this.state.getCellSize();
        const deltaByKey = {
            ArrowLeft: { left: -dx, top: 0 },
            ArrowRight: { left: dx, top: 0 },
            ArrowUp: { left: 0, top: -dy },
            ArrowDown: { left: 0, top: dy },
        };
        const delta = deltaByKey[event.key];
        if (!delta) return;
        const scrollBy = this.alignmentView?.scrollBy?.bind(this.alignmentView)
            ?? ((nextDelta) => this.alignmentView?.scroller?.scrollBy?.(nextDelta));
        scrollBy(delta);
        event.preventDefault();
    }

    async #refreshViews() {
        this.#rebuildTrackDefs();
        await this.#ensureEnabledTrackState();
        this.#rebuildTrackViews();
        await this.#rebuildMinimap();
        this.viewportController?.syncMinimapViewportRect();
        this.#syncMinimapSelection();
        this.#syncOverlay();
        await this.motifController?.refreshActiveRepresentation();
        this.viewportController?.refreshLayout();
        this.#requestRender();
    }

    async #ensureColumnMetrics(id) {
        const representation = this.representationStore?.get(id);
        if (!representation) return null;
        if (representation.columnMetrics) return representation;

        const alphabet = this.alphabetRegistry.get(representation.alphabetId);
        const columnMetrics = await this.columnMetricService.compute({
            alignmentStore: representation.store,
            alphabet,
        });
        return this.representationStore.setColumnMetrics(id, columnMetrics);
    }

    async #ensureColumnVisibility(id, { force = false } = {}) {
        const representation = await this.#ensureColumnMetrics(id);
        if (!representation) return null;
        if (representation.columnVisibility && !force) {
            return representation;
        }
        return this.representationStore.setColumnVisibility(id, buildColumnVisibility({
            alignmentStore: representation.store,
            columnMetrics: representation.columnMetrics,
            masking: this.state.getMaskingSnapshot(),
        }));
    }

    async #ensureTrackState(id) {
        const representation = await this.#ensureColumnMetrics(id);
        if (!representation) return null;
        if (representation.trackState) {
            return representation;
        }
        const alphabet = this.alphabetRegistry.get(representation.alphabetId);
        return this.representationStore.setTrackState(
            id,
            this.trackStateBuilder.build(
                representation.columnMetrics,
                representation.store.totalRows,
                alphabet
            )
        );
    }

    async #ensureProfileState() {
        const {
            schemeRepresentation,
            schemeAlphabet,
            schemeAlignmentStore,
            schemeAlignmentState,
        } = this.#renderSources();
        const schemeKey = this.state.getSchemeKey();
        if (!schemeAlignmentStore || !schemeAlignmentState || !schemeRepresentation) return;
        if (!this.schemePolicy.requiresColumnProfile(schemeKey)) return;
        if (schemeAlignmentState.profileSchemeKey === schemeKey) return;
        const representation = await this.#ensureColumnMetrics(schemeRepresentation.id);
        await this.columnProfileService.compute({
            alignmentStore: schemeAlignmentStore,
            alignmentState: schemeAlignmentState,
            schemeKey,
            columnMetrics: representation?.columnMetrics ?? null,
            alphabet: schemeAlphabet,
        });
        this.representationStore?.setProfileData(
            schemeRepresentation.id,
            schemeAlignmentState.colProfileData ?? null
        );
        this.representationStore?.setProfileSchemeKey(schemeRepresentation.id, schemeKey);
    }

    async #ensureEnabledTrackState() {
        const representationIds = new Set(
            this.enabledTrackBindings
                .map((binding) => binding.representation)
                .filter((id) => id && id !== "active")
        );
        for (const id of representationIds) {
            await this.#ensureTrackState(id);
        }
    }

    async #activateRep(id, { resetView = false } = {}) {
        const representation = this.representationStore.get(id);
        if (!representation) {
            throw new Error(`Unknown representation: ${id}`);
        }
        const snapshot = this.state.getSnapshot();
        const useSnapshotScroll = !snapshot.alignment.loaded;
        const previousScrollLeft = useSnapshotScroll
            ? snapshot.viewport.scrollLeft
            : (this.alignmentView?.getScrollLeft?.() ?? this.alignmentView?.scroller?.scrollLeft ?? snapshot.viewport.scrollLeft);
        const previousScrollTop = useSnapshotScroll
            ? snapshot.viewport.scrollTop
            : (this.alignmentView?.getScrollTop?.() ?? this.alignmentView?.scroller?.scrollTop ?? snapshot.viewport.scrollTop);
        const { store, alphabetId } = representation;
        const { records, totalCols, totalRows } = store;

        this.#clearActiveInteractionState();
        this.isScrolling = false;
        this.state.setAlignment({
            records,
            totalCols,
            totalRows,
            alphabetId,
            representationId: id,
            preserveSelection: !resetView,
            preserveScroll: !resetView,
        });

        const { activeAlphabet, schemeAlphabet } = this.#renderSources();
        this.#applyCompatibleScheme(schemeAlphabet);
        this.renderer = this.pipelineRegistry?.getRenderer(activeAlphabet) ?? null;
        this.alignmentView.renderer = this.renderer;
        await this.#ensureProfileState();
        const active = await this.#ensureColumnVisibility(id);
        await this.#ensureTrackState(id);

        this.alignmentView.setAlignmentSize(totalCols, totalRows, active?.columnVisibility ?? null);
        this.alignmentView.syncSurfaceSize();
        this.alignmentView.scrollTo(
            resetView ? 0 : previousScrollLeft,
            resetView ? 0 : previousScrollTop
        );
        this.headerView?.renderRecords(records);
        this.selectionController?.syncOverlay(this.state.getSelectionSnapshot());
        this.#syncMinimapSelection();
        await this.#uploadWindow();
        this.#setLoaded(true);
        await this.#refreshViews();
    }

    async #registerData(representations) {
        for (const representation of representations) {
            this.representationStore.register(representation.id, representation.store, {
                alphabetId: representation.alphabetId,
            });
        }
    }

    #loadResult(activeId = this.dataOptions.activeRepresentationId) {
        const representations = this.getRepresentations();
        return {
            activeId,
            active: representations.find((representation) => representation.id === activeId) ?? null,
            representations,
        };
    }

    async #setRepresentations(representations, { activeId = null, resetView = true } = {}) {
        this.#assertLive();
        await this.#init();

        const nextActiveId = activeId ?? representations[0]?.id ?? null;
        this.#clearData({
            preserveSelection: !resetView,
            preserveScroll: !resetView,
        });
        this.dataOptions = { representations, activeRepresentationId: nextActiveId };
        this.options.rendering.schemeSourceRepresentationId = normalizeSchemeSource(this.options, representations);

        if (!representations.length || !nextActiveId) {
            this.#rebuildTrackDefs();
            this.#setLoaded(false);
            this.viewportController?.syncMinimapViewportRect?.();
            this.viewportController?.syncTracksViewport?.();
            this.viewportController?.refreshLayout?.();
            this.#requestRender();
            return this.#loadResult(nextActiveId);
        }

        await this.#registerData(representations);
        await this.#activateRep(nextActiveId, { resetView });
        return this.#loadResult(nextActiveId);
    }

    async setActiveRepresentation(id) {
        this.#assertLive();
        await this.#init();
        this.dataOptions = { ...this.dataOptions, activeRepresentationId: id };
        await this.#activateRep(id, { resetView: false });
        return this.getActiveRepresentation();
    }

    async loadData(input, { activeId = null } = {}) {
        const representations = await loadRepresentations(input, {
            defaultAlphabetId: this.options.alphabet,
        });
        return this.#setRepresentations(representations, { activeId });
    }

    #syncThemeBuffer() {
        if (!this.device || !this.#themeBuffer) {
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
        writeThemeUniformBuffer(this.device, this.#themeBuffer, darkMode, colorSchemeId);
        this.lastThemeUniform = { darkMode, colorSchemeId };
    }
    
    async #applyScheme(schemeKey) {
        const snapshot = this.state.getSnapshot();
        const { schemeAlphabet } = this.#renderSources();
        const alphabet = schemeAlphabet;
        if (!this.schemePolicy.isSupported(schemeKey, alphabet)) {
            throw new Error(`Scheme '${schemeKey}' is not supported for alphabet '${alphabet.id}'.`);
        }
        if (
            snapshot.scheme.key === schemeKey
            && this.renderWindow.bindGroup
        ) {
            if (this.schemePolicy.requiresColumnProfile(schemeKey)) {
                await this.#ensureProfileState();
            }
            this.representationStore?.setMinimapCache(this.#activeRepresentation()?.id, null);
            this.minimapTask.schedule();
            return;
        }

        this.state.setScheme(schemeKey);
        this.#syncThemeBuffer();

        if (this.schemePolicy.requiresColumnProfile(schemeKey)) {
            await this.#ensureProfileState();
        }

        this.#applyRenderResources();
        this.representationStore?.setMinimapCache(this.#activeRepresentation()?.id, null);
        this.minimapTask.schedule();
    }

    async #applyMasking(masking) {
        this.state.setColumnMasking(masking);
        const active = this.#activeRepresentation();
        if (!active) return;
        const updated = await this.#ensureColumnVisibility(active.id, { force: true });
        const columnVisibility = updated?.columnVisibility ?? null;
        this.representationStore.setMinimapCache(active.id, null);
        this.#clearActiveWindowState();
        this.alignmentView?.setAlignmentSize(
            active.store.totalCols,
            active.store.totalRows,
            columnVisibility
        );
        this.#syncMinimapSelection();
        this.minimapTask.schedule();
        void this.motifController?.refreshActiveRepresentation();
    }

    async setMotifQuery(query) {
        return await this.motifController?.setQuery(query) ?? 0;
    }

    async #uploadWindow() {
        const sources = this.#renderSources();
        const {
            schemeAlphabet,
            schemeRepresentation,
            activeAlignmentStore,
            activeAlignmentState,
            schemeAlignmentStore,
            schemeAlignmentState,
        } = sources;
        if (!activeAlignmentStore || !activeAlignmentState || !schemeRepresentation || !schemeAlignmentStore || !schemeAlignmentState) {
            return;
        }
        this.#applyCompatibleScheme(schemeAlphabet);

        const windows = await this.#updateWindowPair(sources);
        if (!windows || this.#hasWindowPair(windows, schemeRepresentation.id)) return;

        this.renderWindow.active = windows.activeWindow;
        this.renderWindow.scheme = windows.schemeWindow;
        this.renderWindow.schemeSourceId = schemeRepresentation.id;
        this.#applyRenderResources(sources);
        this.#requestRender();
    }

    async #updateWindowPair({
        activeRepresentation,
        activeAlignmentStore,
        schemeAlignmentStore,
        usesSeparateColorSource,
    }) {
        const bounds = this.viewportController.getVisibleWindowBounds();
        const columnVisibility = activeRepresentation?.columnVisibility ?? null;
        const activeWindow = await this.windowController.update({
            alignmentStore: activeAlignmentStore,
            bounds,
            columnVisibility,
        });
        if (!activeWindow) return null;

        const schemeWindow = usesSeparateColorSource
            ? await this.schemeWindowController.update({
                alignmentStore: schemeAlignmentStore,
                bounds,
                columnVisibility,
            })
            : activeWindow;
        return schemeWindow ? { activeWindow, schemeWindow } : null;
    }

    #hasWindowPair({ activeWindow, schemeWindow }, schemeRepresentationId) {
        return this.renderWindow.active?.key === activeWindow.key
            && this.renderWindow.scheme?.key === schemeWindow.key
            && this.renderWindow.schemeSourceId === schemeRepresentationId;
    }

    #applyRenderResources(sources = this.#renderSources()) {
        const { activeAlignmentState, schemeAlignmentState } = sources;
        if (!this.renderWindow.active || !activeAlignmentState) return;

        const renderResources = this.#renderResources(sources);
        this.renderWindow.bindGroup = renderResources?.bindGroup ?? null;
        this.alignmentView.setRenderResources(renderResources);
        if (!this.renderWindow.bindGroup) return;

        this.state.setGpuResources({
            msaTexture: this.renderWindow.active.texture,
            colProfileBuffer: (schemeAlignmentState ?? activeAlignmentState).colProfileBuffer,
            renderBindGroup: this.renderWindow.bindGroup,
        });
    }

    #renderResources(sources = this.#renderSources()) {
        return createAlignmentRenderResources({
            backend: this.renderBackend,
            device: this.device,
            renderer: this.renderer,
            gpuResources: this.gpuResources,
            pipelineRegistry: this.pipelineRegistry,
            windowState: this.renderWindow.active,
            schemeWindowState: this.renderWindow.scheme ?? this.renderWindow.active,
            sources,
            schemeKey: this.state.getSchemeKey(),
            darkMode: this.state.getResolvedDarkMode(),
        });
    }
    
    #requestRender() {
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
        const alignmentState = this.#activeState();
        if (alignmentState && this.renderWindow.active) {
            if (this.renderBackend === "cpu") {
                this.alignmentView.setRenderResources(this.#renderResources());
            }
            this.alignmentView.syncRenderState({
                totalCols: this.#activeRepresentation()?.columnVisibility?.visibleCount ?? alignmentState.totalCols,
                totalRows: alignmentState.totalRows,
                windowColStart: this.renderWindow.active.colStart,
                windowRowStart: this.renderWindow.active.rowStart,
                windowCols: this.renderWindow.active.colCount,
                windowRows: this.renderWindow.active.rowCount,
            });
            this.alignmentView.renderSurface();
        }
        if (this.renderDirty && !this.frameHandle) {
            this.frameHandle = requestAnimationFrame(this.frame);
        }
    }

    #cancelRender() {
        if (this.frameHandle) {
            cancelAnimationFrame(this.frameHandle);
            this.frameHandle = null;
        }
        this.renderDirty = false;
    }

    destroy() {
        if (this.destroyed) {
            return;
        }
        this.destroyed = true;
        this.initialized = false;
        this.initPromise = null;

        for (const cleanup of this.cleanup.splice(0)) {
            cleanup();
        }
        this.#destroyRuntime();
    }
}
