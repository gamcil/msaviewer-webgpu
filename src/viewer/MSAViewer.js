/* Handles rendering of the MSA alignment and headers, as well as scroll synchronization between them. */
import { ViewerState } from "./ViewerState.js";
import { RepresentationStore } from "./RepresentationStore.js";
import { HeaderView } from "../views/HeaderView.js";
import { AlignmentView } from "../views/AlignmentView.js";
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
import { BarTrackView } from "../views/BarTrackView.js";
import { LineTrackView } from "../views/LineTrackView.js";
import { ConsensusTrackView } from "../views/ConsensusTrackView.js";
import { TrackStateBuilder } from "./TrackStateBuilder.js";
import { MinimapController } from "./MinimapController.js";
import { SchemePolicy } from "./SchemePolicy.js";
import { ViewportController } from "./ViewportController.js";
import { SelectionController } from "./SelectionController.js";
import { ColumnMetricService } from "./ColumnMetricService.js";
import { ColumnProfileService } from "./ColumnProfileService.js";
import { VisibleWindowController } from "./VisibleWindowController.js";
import { defaultAlphabetRegistry } from "../alphabets/index.js";

function writeThemeUniformBuffer(device, buffer, darkMode, colorScheme) {
    const data = new Uint32Array([darkMode, colorScheme]);
    device.queue.writeBuffer(buffer, 0, data);
}

const AUTO_LAYOUT_CSS = `
:host {
    display: block;
    color-scheme: light dark;
    box-sizing: border-box;
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
    --msa-minimap-height: 120px;
    --msa-grid-line: rgba(0, 0, 0, 0.05);
    --msa-scroller-bg: #fff;
    --msa-header-bg: #f0f0f0;
    --msa-header-border: rgba(30, 30, 30, 0.1);
    --msa-scrollbar-thumb: rgba(0, 0, 0, 0.32);
    --msa-scrollbar-track: rgba(0, 0, 0, 0.08);
}

:host([data-theme="dark"]) {
    color-scheme: dark;
    --msa-grid-line: rgba(255, 255, 255, 0.03);
    --msa-scroller-bg: #111;
    --msa-header-bg: #161616;
    --msa-header-border: rgba(255, 255, 255, 0.08);
    --msa-scrollbar-thumb: rgba(255, 255, 255, 0.35);
    --msa-scrollbar-track: rgba(255, 255, 255, 0.12);
}

:host([data-theme="light"]) {
    color-scheme: light;
}

*, *::before, *::after {
    box-sizing: border-box;
}

[hidden] {
    display: none !important;
}

.msa-auto-shell {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    grid-template-rows: auto minmax(0, 1fr) auto;
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
}

.msa-main-row,
.msa-headers,
.viewer-body,
.msa-minimap-body,
.msa-trackstack-body {
    min-width: 0;
}

.msa-main-row,
.viewer-body,
.msa-trackstack-body {
    min-height: 0;
}

.msa-minimap-body {
    grid-column: 2;
    grid-row: 1;
    height: var(--msa-minimap-height);
    padding: 8px;
}

.msa-main-row {
    grid-column: 1 / -1;
    grid-row: 2;
    display: grid;
    grid-template-columns: subgrid;
}

.msa-headers {
    grid-column: 1;
}

.viewer-body {
    grid-column: 2;
    position: relative;
    overflow: hidden;
}

.msa-trackstack-body {
    grid-column: 1 / -1;
    grid-row: 3;
    display: grid;
    grid-template-columns: subgrid;
    align-self: start;
    overflow: visible;
}

.msa-minimap {
    position: relative;
    width: 100%;
    height: 100%;
    border: 1px solid grey;
}

.msa-alignment-scroller {
    position: relative;
    width: 100%;
    height: 100%;
    overflow: auto;
    color-scheme: inherit;
    scrollbar-color: var(--msa-scrollbar-thumb) var(--msa-scrollbar-track);
    background: var(--msa-scroller-bg);
}

:host([data-loaded="false"]) .msa-alignment-scroller {
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
.msa-alignment-overlay-canvas {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    display: block;
    pointer-events: none;
}

.msa-track-row {
    display: grid;
    grid-column: 1 / -1;
    grid-template-columns: subgrid;
    box-sizing: content-box;
    padding: 8px 0;
}

.msa-track-label {
    grid-column: 1;
    display: flex;
    align-items: end;
    justify-content: flex-end;
    text-align: right;
    padding: 0 8px;
    min-width: 100px;
}

.msa-track-body {
    grid-column: 2;
    min-width: 0;
}

.msa-track-canvas {
    display: block;
}
`;

export class MSAViewer {
    constructor({
        root,
        device,
        format,
        themeMedia,
        alphabet = "aa",
        alphabetRegistry = defaultAlphabetRegistry,
        layout = {},
        views = null,
    }) {
        this.root = root;
        this.device = device;
        this.format = format;
        this.themeMedia = themeMedia ?? window.matchMedia("(prefers-color-scheme: dark)");
        this.alphabetRegistry = alphabetRegistry;
        this.providedViews = views;
        this.layout = {
            header: layout.header !== false,
            minimap: layout.minimap !== false,
            tracks: layout.tracks !== false,
        };
        const initialAlphabet = typeof alphabet === "string" ? this.alphabetRegistry.get(alphabet) : alphabet;
        if (!initialAlphabet) {
            throw new Error(`Unknown alphabet: ${alphabet}`);
        }
        
        this.state = new ViewerState({
            schemeKey: "clustalx",
            themeMode: "auto",
            darkMode: this.themeMedia.matches,
            alphabetId: initialAlphabet.id,
        });

        this.atlasBitmap = null;
        this.shadowRootRef = null;
        this.autoLayoutShell = null;
        this.views = {
            header: null,
            alignment: null,
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
        this.columnMetricService = null;
        this.columnProfileService = null;
        this.visibleWindowController = null;
        this.schemePolicy = new SchemePolicy({
            getActiveAlphabet: () => this.getActiveAlphabet(),
        });
        this.visibleWindowState = null;
        this.decodedTileCache = new TileCache(64 * 1024 * 1024);
        this.viewportOverscanRows = 8;
        this.viewportOverscanCols = 32;
        
        this.isScrolling = false;
        
        this.frameHandle = null;
    }

    get headerView() { return this.views.header; }
    set headerView(view) { this.views.header = view; }

    get alignmentView() { return this.views.alignment; }
    set alignmentView(view) { this.views.alignment = view; }

    get minimapView() { return this.views.minimap; }
    set minimapView(view) { this.views.minimap = view; }

    get trackStackViews() { return this.views.trackStacks; }
    set trackStackViews(views) { this.views.trackStacks = Array.isArray(views) ? views : []; }

    getActiveAlphabet() {
        const activeRepresentation = this.getActiveRepresentation();
        if (activeRepresentation) {
            return this.alphabetRegistry.get(activeRepresentation.alphabetId);
        }
        return this.alphabetRegistry.get(this.state.getSnapshot().alignment.alphabetId);
    }

    getActiveRepresentation() {
        const representationId = this.state.getSnapshot().alignment.representationId;
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
            this.renderer = this.pipelineRegistry.getRenderer(resolvedAlphabet);
            this.alignmentView.renderer = this.renderer;
            await this.recomputeColumnMetrics();
            const updatedTrackState = this.trackStateBuilder.build(
                this.getActiveColumnMetrics(),
                activeAlignmentStore.totalRows,
                resolvedAlphabet
            );
            for (const trackStackView of this.trackStackViews) {
                trackStackView.setTrackState(updatedTrackState);
            }
            const activeRepresentation = this.getActiveRepresentation();
            if (activeRepresentation) {
                this.representationStore.setAlphabetId(activeRepresentation.id, resolvedAlphabet.id);
                this.representationStore.setColumnMetrics(activeRepresentation.id, this.getActiveColumnMetrics());
                this.representationStore.setTrackState(activeRepresentation.id, updatedTrackState);
                this.representationStore.setMinimapCache(activeRepresentation.id, null);
            }
        }
    }

    applyCompatibleSchemeForAlphabet(alphabet = this.getActiveAlphabet()) {
        const snapshot = this.state.getSnapshot();
        const compatibleSchemeKey = this.schemePolicy.getCompatibleScheme(snapshot.scheme.key, alphabet);
        if (compatibleSchemeKey && compatibleSchemeKey !== snapshot.scheme.key) {
            this.state.setScheme(compatibleSchemeKey);
            this.syncThemeBuffer();
        }
        return compatibleSchemeKey;
    }
    
    async init() {
        await this.ensureGpuContext();
        this.atlasBitmap = await loadImageBitmap(new URL("../graphics/atlas.png", import.meta.url));
        this.createGpuResources();
        this.createViews();
        this.loadStaticAssets();
        this.bindEvents();
        this.syncThemeBuffer();
        this.startFrameLoop();
    }
    
    async ensureGpuContext() {
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

        const mainRowRoot = document.createElement("div");
        mainRowRoot.className = "msa-main-row";

        const headerRoot = this.layout.header ? document.createElement("div") : null;
        if (headerRoot) {
            headerRoot.className = "msa-headers";
        }

        const alignmentRoot = document.createElement("div");
        alignmentRoot.className = "viewer-body";
        
        const minimapRoot = this.layout.minimap ? document.createElement("div") : null;
        if (minimapRoot) {
            minimapRoot.className = "msa-minimap-body";
        }
        
        const trackstackRoot = this.layout.tracks ? document.createElement("div") : null;
        if (trackstackRoot) {
            trackstackRoot.className = "msa-trackstack-body";
        }
        
        mountRoot.appendChild(mainRowRoot);
        if (headerRoot) {
            mainRowRoot.appendChild(headerRoot);
        }
        mainRowRoot.appendChild(alignmentRoot);
        if (minimapRoot) {
            mountRoot.appendChild(minimapRoot);
        }
        if (trackstackRoot) {
            mountRoot.appendChild(trackstackRoot);
        }

        return { mainRowRoot, headerRoot, alignmentRoot, minimapRoot, trackstackRoot };
    }

    getAutoLayoutMountRoot() {
        if (!this.shadowRootRef) {
            this.shadowRootRef = this.root.shadowRoot ?? this.root.attachShadow({ mode: "open" });
        }
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

    createAutoViews() {
        const { mainRowRoot, headerRoot, alignmentRoot, minimapRoot, trackstackRoot } = this.createLayout();
        this.mainRowRoot = mainRowRoot;
        this.headerRoot = headerRoot;
        this.alignmentRoot = alignmentRoot;
        this.minimapRoot = minimapRoot;
        this.trackstackRoot = trackstackRoot;
        this.renderer = this.pipelineRegistry.getRenderer(this.getActiveAlphabet());
        this.headerView = headerRoot ? new HeaderView({
            root: headerRoot,
            rowHeight: this.state.getSnapshot().viewport.cellHeight,
        }) : null;
        this.minimapView = minimapRoot ? new MinimapView({ root: minimapRoot }) : null;
        this.minimapController = this.minimapView ? new MinimapController({
            device: this.device,
            gpuResources: this.gpuResources,
            pipelineRegistry: this.pipelineRegistry,
            minimapView: this.minimapView,
            decodedTileCache: this.decodedTileCache,
        }) : null;
        this.trackStackViews = trackstackRoot ? [new TrackStackView({ root: trackstackRoot })] : [];
        this.alignmentView = new AlignmentView({
            root: alignmentRoot,
            renderer: this.renderer,
            uniformBuffer: this.uniformBuffer,
            device: this.device,
            format: this.format,
            getCellWidth: () => this.state.getSnapshot().viewport.cellWidth,
            getCellHeight: () => this.state.getSnapshot().viewport.cellHeight,
        });
        this.viewportController = new ViewportController({
            state: this.state,
            alignmentView: this.alignmentView,
            headerView: this.headerView,
            minimapView: this.minimapView,
            getTrackStackViews: () => this.trackStackViews,
            minimapController: this.minimapController,
            getAlignmentStore: () => this.getActiveAlignmentStore(),
            getOverscanRows: () => this.viewportOverscanRows,
            getOverscanCols: () => this.viewportOverscanCols,
            uploadVisibleWindow: () => this.uploadVisibleWindow(),
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
        this.selectionController.bind();

        this.setLoadedLayoutVisible(false);
    }

    attachProvidedViews({
        headerView = null,
        alignmentView,
        minimapView = null,
        trackStackViews = null,
    }) {
        if (!alignmentView) {
            throw new Error("Manual view mode requires an alignmentView.");
        }
        this.renderer = this.pipelineRegistry.getRenderer(this.getActiveAlphabet());
        this.headerView = headerView;
        this.alignmentView = alignmentView;
        this.minimapView = minimapView;
        this.trackStackViews = trackStackViews ?? [];
        if (this.alignmentView) {
            this.alignmentView.renderer = this.renderer;
        }
        this.minimapController = this.minimapView ? new MinimapController({
            device: this.device,
            gpuResources: this.gpuResources,
            pipelineRegistry: this.pipelineRegistry,
            minimapView: this.minimapView,
            decodedTileCache: this.decodedTileCache,
        }) : null;
        this.viewportController = new ViewportController({
            state: this.state,
            alignmentView: this.alignmentView,
            headerView: this.headerView,
            minimapView: this.minimapView,
            getTrackStackViews: () => this.trackStackViews,
            minimapController: this.minimapController,
            getAlignmentStore: () => this.getActiveAlignmentStore(),
            getOverscanRows: () => this.viewportOverscanRows,
            getOverscanCols: () => this.viewportOverscanCols,
            uploadVisibleWindow: () => this.uploadVisibleWindow(),
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
        this.selectionController.bind();
    }

    createViews() {
        if (this.providedViews) {
            this.attachProvidedViews(this.providedViews);
            return;
        }
        this.createAutoViews();
    }

    createDefaultTracksForStack() {
        const qualityTrackRoot = document.createElement("div");
        qualityTrackRoot.className = "msa-track";
        const qualityTrackView = new BarTrackView({
            root: qualityTrackRoot,
            id: "quality",
            label: "Quality",
            height: 60
        });

        const occupancyTrackRoot = document.createElement("div");
        occupancyTrackRoot.className = "msa-track";
        const occupancyTrackView = new BarTrackView({
            root: occupancyTrackRoot,
            id: "occupancy",
            label: "Occupancy",
            height: 60
        });

        const entropyTrackRoot = document.createElement("div");
        entropyTrackRoot.className = "msa-track";
        const entropyTrackView = new LineTrackView({
            root: entropyTrackRoot,
            id: "entropy",
            label: "Entropy",
            height: 60
        });

        const consensusTrackRoot = document.createElement("div");
        consensusTrackRoot.className = "msa-track";
        const consensusTrackView = new ConsensusTrackView({
            root: consensusTrackRoot,
            id: "consensus",
            label: "Consensus",
            height: 80,
            darkMode: this.state.getSnapshot().theme.darkMode,
        });

        return [
            qualityTrackView,
            occupancyTrackView,
            entropyTrackView,
            consensusTrackView,
        ];
    }
    
    ensureTracks() {
        if (this.trackStackViews.length === 0) return;
        for (const trackStackView of this.trackStackViews) {
            if (trackStackView.tracks.length > 0) continue;
            for (const track of this.createDefaultTracksForStack()) {
                trackStackView.addTrack(track);
            }
            trackStackView.setTheme({ darkMode: this.state.getSnapshot().theme.darkMode });
        }
    }
    
    getCoordsFromScrollerPosition({ clientX, clientY }) {
        const bounds = this.alignmentView.scroller.getBoundingClientRect();
        const contentX = clientX - bounds.left + this.alignmentView.scroller.scrollLeft;
        const contentY = clientY - bounds.top  + this.alignmentView.scroller.scrollTop;
        const cellWidth = this.alignmentView.getRenderedCellWidthCss();
        const cellHeight = this.alignmentView.getRenderedCellHeightCss();
        const snapshot = this.state.getSnapshot();
        const col = Math.floor(contentX / cellWidth);
        const row = Math.min(snapshot.alignment.totalRows - 1, Math.floor(contentY / cellHeight));
        return [col, row];
    }

    setLoadedLayoutVisible(loaded) {
        this.root.dataset.loaded = loaded ? "true" : "false";
        if (this.headerRoot) {
            this.headerRoot.hidden = !loaded;
        }
        if (this.minimapRoot) {
            this.minimapRoot.hidden = !loaded;
        }
        if (this.trackstackRoot) {
            this.trackstackRoot.hidden = !loaded;
        }
    }
    
    async rebuildMinimap() {
        const alignmentStore = this.getActiveAlignmentStore();
        const alignmentState = this.getActiveAlignmentState();
        const activeRepresentation = this.getActiveRepresentation();
        if (!alignmentStore || !alignmentState || !activeRepresentation || !this.minimapController) return;
        this.applyCompatibleSchemeForAlphabet();
        await this.minimapController.rebuildForRepresentation(activeRepresentation, {
            alignmentState,
            alphabet: this.getActiveAlphabet(),
            schemeKey: this.state.getSnapshot().scheme.key,
            darkMode: this.state.getSnapshot().theme.darkMode,
            themeBuffer: this.themeBuffer,
            setMinimapCache: (id, cache) => this.representationStore.setMinimapCache(id, cache),
        });
    }
    
    syncAlignmentOverlay(selectedColumns = this.state.getSnapshot().selection.columns) {
        this.selectionController?.syncOverlay(selectedColumns);
    }

    // Expose selected columns to outer app
    getSelectedColumns() {
        return this.selectionController?.getSelectedColumns() ?? new Set();
    }
    setSelectedColumns(columns) {
        this.selectionController?.setSelectedColumns(columns);
    }
    clearSelectedColumns() {
        this.selectionController?.clearSelectedColumns();
    }
    onSelectionChange(callback) {
        return this.selectionController?.onSelectionChange(callback) ?? (() => {});
    }

    createGpuResources() {
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

        this.representationStore = new RepresentationStore({
            device: this.device,
            alphabetRegistry: this.alphabetRegistry,
            getProfileStride: () => SCHEMES[this.state.getSnapshot().scheme.key].profileStride,
        });
        this.pipelineRegistry = new PipelineRegistry({
            device: this.device,
            format: this.format,
            gpuResources: this.gpuResources,
            computeShaderCodes: this.computeShaderCodes,
            getDummyStorageBuffer: () => this.dummyStorageBuffer,
        });
        this.columnMetricService = new ColumnMetricService({
            device: this.device,
            gpuResources: this.gpuResources,
            pipelineRegistry: this.pipelineRegistry,
            decodedTileCache: this.decodedTileCache,
            getMetricUniformBuffer: () => this.metricUniformBuffer,
        });
        this.columnProfileService = new ColumnProfileService({
            device: this.device,
            gpuResources: this.gpuResources,
            pipelineRegistry: this.pipelineRegistry,
            decodedTileCache: this.decodedTileCache,
        });
        this.visibleWindowController = new VisibleWindowController({
            device: this.device,
            decodedTileCache: this.decodedTileCache,
        });
    }

    loadStaticAssets() {
        this.computeShaderCodes = {
            clustalx: clustalxComputeShaderCode,
            pid: pidComputeShaderCode,
            blosum62: blosumComputeShaderCode,
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
                trackStackView.setTheme?.({ darkMode: snapshot.theme.darkMode });
            }

            prevThemeDarkMode = snapshot.theme.darkMode;
            prevSchemeKey = snapshot.scheme.key;
        });

        let prevAlignmentLoaded = null;
        let prevScrollTop = null;
        this.unsubscribeViewportState = this.state.subscribe((snapshot) => {
            if (
                snapshot.alignment.loaded === prevAlignmentLoaded &&
                snapshot.viewport.scrollTop === prevScrollTop
            ) {
                return;
            }

            prevAlignmentLoaded = snapshot.alignment.loaded;
            prevScrollTop = snapshot.viewport.scrollTop;

            if (!snapshot.alignment.loaded) {
                return;
            }

            this.viewportController?.syncHeaderScroll(snapshot.viewport.scrollTop);
        });
        
        let prevSelectedColumns = null;
        this.unsubscribeSelectionState = this.state.subscribe((snapshot) => {
            if (!this.selectionController) return;
            const selectedColumns = snapshot.selection.columns;
            if (selectedColumns === prevSelectedColumns) return;
            prevSelectedColumns = selectedColumns;
            this.syncAlignmentOverlay(selectedColumns);    
        })

        this.viewportController?.bind();

        // dark/light theme changing
        this.onThemeChange = (event) => {
            const snapshot = this.state.getSnapshot();
            if (snapshot.theme.mode === "auto") {
                this.setTheme({ darkMode: event.matches });
            }
        };
        this.themeMedia.addEventListener("change", this.onThemeChange);

        // keyboard scrolling
        this.onKeyDown = (event) => {
            if (!this.getActiveAlignmentState()) return;
            let handled = true;
            const dx = this.state.getSnapshot().viewport.cellWidth;
            const dy = this.state.getSnapshot().viewport.cellHeight;
            if (event.key === "ArrowLeft") {
                this.alignmentView.scroller.scrollBy({ left: -dx, top: 0 });
            } else if (event.key === "ArrowRight") {
                this.alignmentView.scroller.scrollBy({ left: dx, top: 0 });
            } else if (event.key === "ArrowUp") {
                this.alignmentView.scroller.scrollBy({ left: 0, top: -dy });
            } else if (event.key === "ArrowDown") {
                this.alignmentView.scroller.scrollBy({ left: 0, top: dy });
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
        return {
            previousScrollLeft: this.alignmentView?.scroller?.scrollLeft ?? previousSnapshot.viewport.scrollLeft,
            previousScrollTop: this.alignmentView?.scroller?.scrollTop ?? previousSnapshot.viewport.scrollTop,
            resetView,
        };
    }

    prepareActiveRepresentation(representation, id, { resetView }) {
        const { store, alphabetId } = representation;
        const { records, totalCols, totalRows } = store;

        this.decodedTileCache.clear();
        this.visibleWindowController?.clear?.();
        this.visibleWindowState = null;
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
        this.setLoadedLayoutVisible(true);
        this.applyCompatibleSchemeForAlphabet(this.alphabetRegistry.get(alphabetId));
        this.renderer = this.pipelineRegistry.getRenderer(this.getActiveAlphabet());
        this.alignmentView.renderer = this.renderer;
    }

    async ensureActiveRepresentationDerivedState(representation, id) {
        const { totalRows } = representation.store;

        await this.recomputeColumnProfile();
        if (!representation.columnMetrics) {
            await this.recomputeColumnMetrics();
        }

        const activeColumnMetrics = representation.columnMetrics ?? this.getActiveColumnMetrics();
        if (!representation.trackState) {
            this.representationStore.setTrackState(
                id,
                this.trackStateBuilder.build(activeColumnMetrics, totalRows, this.getActiveAlphabet())
            );
        }
    }

    applyActiveRepresentationToViews(representation, { previousScrollLeft, previousScrollTop, resetView }) {
        const { records, totalCols, totalRows } = representation.store;

        this.alignmentView.setAlignmentSize(totalCols, totalRows);
        this.alignmentView.ensureCanvasSize();
        if (resetView) {
            this.alignmentView.scrollTo(0, 0);
        } else {
            this.alignmentView.scrollTo(previousScrollLeft, previousScrollTop);
        }
        this.headerView?.renderRecords(records);
        this.headerView?.syncScroll(this.alignmentView.scroller.scrollTop);
        this.selectionController?.syncOverlay(this.state.getSnapshot().selection.columns);
    }

    async finalizeActiveRepresentationActivation(id) {
        await this.uploadVisibleWindow();
        await this.rebuildMinimap();
        this.viewportController?.syncMinimapViewportRect();
        this.syncAlignmentOverlay();
        this.ensureTracks();
        for (const trackStackView of this.trackStackViews) {
            trackStackView.setTrackState(this.representationStore.get(id).trackState);
        }
        this.viewportController?.syncTracksViewport();
        this.viewportController?.refreshLayout();
    }

    async activateRepresentation(id, { resetView = false } = {}) {
        const representation = this.representationStore.get(id);
        if (!representation) {
            throw new Error(`Unknown representation: ${id}`);
        }

        const activationContext = this.getRepresentationActivationContext(resetView);
        this.prepareActiveRepresentation(representation, id, activationContext);
        await this.ensureActiveRepresentationDerivedState(representation, id);
        this.applyActiveRepresentationToViews(representation, activationContext);
        await this.finalizeActiveRepresentationActivation(id);
    }

    registerRepresentation(id, store, { alphabetId = id } = {}) {
        return this.representationStore.register(id, store, { alphabetId });
    }

    async loadRepresentation(id, store, { alphabetId = id } = {}) {
        this.registerRepresentation(id, store, { alphabetId });
        await this.activateRepresentation(id, { resetView: true });
    }

    async loadRepresentations(representations, { activeId = null } = {}) {
        if (!Array.isArray(representations) || representations.length === 0) {
            throw new Error("loadRepresentations requires a non-empty array.");
        }

        let nextActiveId = activeId;
        for (const representation of representations) {
            const { id, store, alphabetId = id } = representation;
            if (!id || !store) {
                throw new Error("Each representation must include an id and store.");
            }
            this.registerRepresentation(id, store, { alphabetId });

            if (nextActiveId == null) {
                nextActiveId = id;
            }
        }

        await this.activateRepresentation(nextActiveId, { resetView: true });
    }

    async setActiveRepresentation(id) {
        await this.activateRepresentation(id, { resetView: false });
    }

    async loadAlignment(store) {
        const defaultRepresentationId = this.state.getSnapshot().alignment.representationId ?? "default";
        const activeAlphabetId = this.state.getSnapshot().alignment.alphabetId;
        await this.loadRepresentation(defaultRepresentationId, store, { alphabetId: activeAlphabetId });
    }
    
    async loadFastaAlignment(source, format = "fasta") {
        const parsed = format === "a3m"
            ? await parseA3MAlignment(source)
            : await parseFastaAlignment(source);
        await this.loadAlignment(parsed);
        return parsed;
    }

    syncThemeBuffer() {
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
    
    async setScheme(schemeKey) {
        const snapshot = this.state.getSnapshot();
        const alphabet = this.getActiveAlphabet();
        if (!this.schemePolicy.isSupported(schemeKey, alphabet)) {
            throw new Error(`Scheme '${schemeKey}' is not supported for alphabet '${alphabet.id}'.`);
        }
        if (snapshot.scheme.key === schemeKey) return;

        const alignmentState = this.getActiveAlignmentState();
        this.state.setScheme(schemeKey);
        this.syncThemeBuffer();

        if (this.schemePolicy.requiresColumnProfile(schemeKey)) {
            await this.recomputeColumnProfile();
        }

        if (this.visibleWindowState && alignmentState) {
            this.renderBindGroup = this.createRenderBindGroup();
            this.alignmentView.setBindGroup(this.renderBindGroup);

            this.state.setGpuResources({
                msaTexture: this.visibleWindowState.texture,
                colProfileBuffer: alignmentState.colProfileBuffer,
                renderBindGroup: this.renderBindGroup,
            });
        }
        await this.rebuildMinimap();
    }
    
    async setTheme({ mode, darkMode }) {
        if (mode != null) this.state.setThemeMode(mode);
        if (darkMode != null) this.state.setResolvedDarkMode(darkMode);
        await this.rebuildMinimap();
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
        }
    }
    
    async recomputeColumnProfile() {
        const alignmentStore = this.getActiveAlignmentStore();
        const alignmentState = this.getActiveAlignmentState();
        if (!alignmentStore || !alignmentState) return;
        await this.columnProfileService.compute({
            alignmentStore,
            alignmentState,
            schemeKey: this.state.getSnapshot().scheme.key,
        });
    }

    async uploadVisibleWindow() {
        const alignmentStore = this.getActiveAlignmentStore();
        const alignmentState = this.getActiveAlignmentState();
        if (!alignmentStore || !alignmentState) {
            return;
        }
        this.applyCompatibleSchemeForAlphabet();

        const nextVisibleWindowState = await this.visibleWindowController.update({
            alignmentStore,
            bounds: this.viewportController.getVisibleWindowBounds(),
        });
        if (!nextVisibleWindowState) {
            return;
        }
        if (this.visibleWindowState?.key === nextVisibleWindowState.key) {
            return;
        }
        this.visibleWindowState = nextVisibleWindowState;
        this.renderBindGroup = this.createRenderBindGroup();
        this.alignmentView.setBindGroup(this.renderBindGroup);
        this.state.setGpuResources({
            msaTexture: nextVisibleWindowState.texture,
            colProfileBuffer: alignmentState.colProfileBuffer,
            renderBindGroup: this.renderBindGroup,
        });
    }

    createRenderBindGroup() {
        const alignmentState = this.getActiveAlignmentState();
        const snapshot = this.state.getSnapshot();
        return this.device.createBindGroup({
            layout: this.renderer.pipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: this.uniformBuffer } },
                { binding: 1, resource: this.visibleWindowState.texture.createView() },
                { binding: 2, resource: { buffer: alignmentState.colProfileBuffer } },
                { binding: 3, resource: { buffer: this.themeBuffer } },
                { binding: 4, resource: this.atlasTexture.createView() },
                { binding: 5, resource: this.atlasSampler },
                {
                    binding: 6,
                    resource: {
                        buffer: this.pipelineRegistry.getSchemeAuxBuffer(
                            this.state.getSnapshot().scheme.key,
                            this.getActiveAlphabet()
                        )
                    }
                },
            ]
        });
    }
    
    frame = () => {
        const alignmentState = this.getActiveAlignmentState();
        if (alignmentState && this.visibleWindowState) {
            this.alignmentView.ensureCanvasSize();
            this.alignmentView.syncUniforms({
                totalCols: alignmentState.totalCols,
                totalRows: alignmentState.totalRows,
                windowColStart: this.visibleWindowState.colStart,
                windowRowStart: this.visibleWindowState.rowStart,
                windowCols: this.visibleWindowState.colCount,
                windowRows: this.visibleWindowState.rowCount,
            });
            this.alignmentView.render();
        }
        this.frameHandle = requestAnimationFrame(this.frame);
    }
    
    startFrameLoop() {
        if (!this.frameHandle) {
            this.frameHandle = requestAnimationFrame(this.frame);
        }
    }

    stopFrameLoop() {
        if (this.frameHandle) {
            cancelAnimationFrame(this.frameHandle);
            this.frameHandle = null;
        }
    }

    destroy() {
        this.stopFrameLoop();
        
        this.unsubscribeThemeState?.();
        this.unsubscribeViewportState?.();

        this.selectionController?.destroy?.();
        this.viewportController?.destroy?.();
        window.removeEventListener("keydown", this.onKeyDown);
        this.themeMedia.removeEventListener("change", this.onThemeChange);
        this.visibleWindowController?.clear?.();
        this.representationStore?.destroy?.();
        this.gpuResources?.destroy?.();
    }
}
