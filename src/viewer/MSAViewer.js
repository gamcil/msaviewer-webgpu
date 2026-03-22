/* Handles rendering of the MSA alignment and headers, as well as scroll synchronization between them. */
import { ViewerState } from "./ViewerState.js";
import { HeaderView } from "../views/HeaderView.js";
import { AlignmentView } from "../views/AlignmentView.js";
import { MSARenderer } from "../graphics/pipelines/MSARenderer.js";
import { ColumnProfileCompute } from "../graphics/pipelines/ColumnProfileCompute.js";
import { BLOSUM62 } from "../graphics/data/blosum62.js";
import {
    SCHEMES,
    getDefaultSchemeKeyForAlphabet,
    isSchemeSupportedForAlphabet as schemeSupportsAlphabet,
} from "../schemes/registry.js";
import { loadImageBitmap } from "../util.js";
import { parseFastaAlignment } from "../alignment/fasta.js";
import { parseA3MAlignment } from "../alignment/a3m.js";
import { TileCache, getTileIndicesForWindow, loadDecodedTile, materializeWindowFromTiles } from "../alignment/tiledStorage.js";
import renderShaderCode from "../graphics/shaders/msa.render.wgsl?raw";
import clustalxComputeShaderCode from "../graphics/shaders/clustalx.compute.wgsl?raw";
import pidComputeShaderCode from "../graphics/shaders/pident.compute.wgsl?raw";
import blosumComputeShaderCode from "../graphics/shaders/blosum.compute.wgsl?raw";
import minimapComputeShaderCode from "../graphics/shaders/minimap.compute.wgsl?raw";
import { buildMetricShaderCode } from "../graphics/shaders/buildMetricShader.js";
import { buildMSARenderShaderCode } from "../graphics/shaders/buildMSARenderShader.js";
import { buildMinimapShaderCode } from "../graphics/shaders/buildMinimapShader.js";
import { MinimapView } from "../views/MinimapView.js";
import { MinimapCompute } from "../graphics/pipelines/MinimapCompute.js";
import { ColumnMetricCompute } from "../graphics/pipelines/ColumnMetricCompute.js";
import { TrackStackView } from "../views/TrackStackView.js";
import { BarTrackView } from "../views/BarTrackView.js";
import { LineTrackView } from "../views/LineTrackView.js";
import { ConsensusTrackView } from "../views/ConsensusTrackView.js";
import { buildTrackState } from "./buildTrackState.js";
import { defaultAlphabetRegistry } from "../alphabets/index.js";

function writeThemeUniformBuffer(device, buffer, darkMode, colorScheme) {
    const data = new Uint32Array([darkMode, colorScheme]);
    device.queue.writeBuffer(buffer, 0, data);
}

function accumulateMinimapChunk(minimapSums, minimapWeights, chunkResult, width, height) {
    const pixelCount = width * height;
    for (let i = 0; i < pixelCount; i += 1) {
        const srcOffset = i * 4;
        const dstOffset = i * 3;
        minimapSums[dstOffset + 0] += chunkResult[srcOffset + 0];
        minimapSums[dstOffset + 1] += chunkResult[srcOffset + 1];
        minimapSums[dstOffset + 2] += chunkResult[srcOffset + 2];
        minimapWeights[i] += chunkResult[srcOffset + 3];
    }
}

function finalizeMinimapPixels(outPixels, minimapSums, minimapWeights, darkMode) {
    const pixelCount = minimapWeights.length;
    const bg = darkMode ? [20, 20, 23] : [255, 255, 255];
    for (let i = 0; i < pixelCount; i += 1) {
        const weight = minimapWeights[i];
        const srcOffset = i * 3;
        const dstOffset = i * 4;
        if (weight === 0) {
            outPixels[dstOffset + 0] = bg[0];
            outPixels[dstOffset + 1] = bg[1];
            outPixels[dstOffset + 2] = bg[2];
            outPixels[dstOffset + 3] = 255;
            continue;
        }
        outPixels[dstOffset + 0] = Math.round(minimapSums[srcOffset + 0] / weight); 
        outPixels[dstOffset + 1] = Math.round(minimapSums[srcOffset + 1] / weight);
        outPixels[dstOffset + 2] = Math.round(minimapSums[srcOffset + 2] / weight);
        outPixels[dstOffset + 3] = 255;
    }
}

export class MSAViewer {
    constructor({
        root,
        device,
        format,
        themeMedia,
        alphabet = "aa",
        alphabetRegistry = defaultAlphabetRegistry,
    }) {
        this.root = root;
        this.device = device;
        this.format = format;
        this.themeMedia = themeMedia ?? window.matchMedia("(prefers-color-scheme: dark)");
        this.alphabetRegistry = alphabetRegistry;
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

        this.renderShaderCode = null;
        this.atlasBitmap = null;
        
        this.headerView = null;
        this.alignmentView = null;
        this.renderer = null;
        this.renderersByAlphabet = new Map();

        this.uniformBuffer = null;
        this.themeBuffer = null;
        this.renderBindGroup = null;

        this.computeShaderCodes = {};
        this.computePipelines = new Map();
        this.alignmentState = null;
        this.alignmentStore = null;
        this.representations = new Map();
        this.visibleWindowState = null;
        this.decodedTileCache = new TileCache(64 * 1024 * 1024);
        this.viewportOverscanRows = 8;
        this.viewportOverscanCols = 32;
        this.profileChunkBuffer = null;
        this.profileChunkCapacity = 0;
        this.metricTileBuffer = null;
        this.metricTileCapacity = 0;
        this.metricUniformBuffer = null;
        this.metricIntermediateBuffer = null;
        this.metricIntermediateCapacity = 0;
        this.metricBandBuffer = null;
        this.metricBandCapacity = 0;
        this.metricCountBuffer = null;
        this.metricCountCapacity = 0;
        this.metricReadbackBuffer = null;
        this.metricReadbackCapacity = 0;
        this.countsReadbackBuffer = null;
        this.countsReadbackCapacity = 0;
        this.metricPipeline = null;
        this.metricPipelineAlphabetId = null;
        this.qualityMatrixBuffers = new Map();
        this.columnMetrics = null;

        // minimap chunking separate to column statistics
        this.minimapChunkBuffer = null;
        this.minimapChunkCapacity = 0;
        this.minimapReadbackBuffer = null;
        this.minimapReadbackCapacity = 0;
        this.minimapChunkTexture = null;
        this.minimapChunkTextureWidth = 0;
        this.minimapChunkTextureHeight = 0;
        this.minimapPipelinesByAlphabet = new Map();
        
        // alignment view hover state
        this.hoveredCell = null;
        this.hoveredColumn = null;
        
        this.isScrolling = false;
        
        this.frameHandle = null;
    }

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
        return this.representations.get(representationId) ?? null;
    }

    getActiveAlignmentStore() {
        return this.getActiveRepresentation()?.store ?? this.alignmentStore;
    }

    getActiveAlignmentState() {
        return this.getActiveRepresentation()?.alignmentState ?? this.alignmentState;
    }

    getActiveColumnMetrics() {
        return this.getActiveRepresentation()?.columnMetrics ?? this.columnMetrics;
    }

    async setAlphabet(alphabet) {
        const resolvedAlphabet = typeof alphabet === "string" ? this.alphabetRegistry.get(alphabet) : alphabet;
        if (!resolvedAlphabet) {
            throw new Error(`Unknown alphabet: ${alphabet}`);
        }
        const matchingRepresentation = Array.from(this.representations.values())
            .find((representation) => representation.alphabetId === resolvedAlphabet.id);
        if (matchingRepresentation) {
            await this.setActiveRepresentation(matchingRepresentation.id);
            return;
        }
        this.state.setActiveAlphabetId(resolvedAlphabet.id);
        const activeColumnMetrics = this.getActiveColumnMetrics();
        const activeAlignmentStore = this.getActiveAlignmentStore();
        if (activeColumnMetrics && activeAlignmentStore) {
            this.renderer = this.getRendererForAlphabet(resolvedAlphabet);
            this.alignmentView.renderer = this.renderer;
            await this.recomputeColumnMetrics();
            const updatedTrackState = buildTrackState(
                this.getActiveColumnMetrics(),
                activeAlignmentStore.totalRows,
                resolvedAlphabet
            );
            this.trackStackView.setTrackState(
                updatedTrackState
            );
            const activeRepresentation = this.getActiveRepresentation();
            if (activeRepresentation) {
                activeRepresentation.alphabetId = resolvedAlphabet.id;
                activeRepresentation.columnMetrics = this.getActiveColumnMetrics();
                activeRepresentation.trackState = updatedTrackState;
                activeRepresentation.minimapCache = null;
            }
        }
    }

    isSchemeSupportedForAlphabet(schemeKey, alphabet = this.getActiveAlphabet()) {
        return schemeSupportsAlphabet(schemeKey, alphabet);
    }

    getFallbackSchemeForAlphabet(alphabet = this.getActiveAlphabet()) {
        return getDefaultSchemeKeyForAlphabet(alphabet);
    }

    ensureCompatibleSchemeForAlphabet(alphabet = this.getActiveAlphabet()) {
        const snapshot = this.state.getSnapshot();
        if (this.isSchemeSupportedForAlphabet(snapshot.scheme.key, alphabet)) {
            return snapshot.scheme.key;
        }
        const fallbackSchemeKey = this.getFallbackSchemeForAlphabet(alphabet);
        if (fallbackSchemeKey && fallbackSchemeKey !== snapshot.scheme.key) {
            this.state.setScheme(fallbackSchemeKey);
            this.syncThemeBuffer();
        }
        return fallbackSchemeKey;
    }
    
    async init() {
        await this.ensureGpuContext();
        [this.renderShaderCode, this.atlasBitmap] = await Promise.all([
            Promise.resolve(renderShaderCode),
            loadImageBitmap(new URL("../graphics/atlas.png", import.meta.url))
        ]);
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
        this.root.replaceChildren();

        const headerRoot = document.createElement("div");
        headerRoot.className = "msa-headers";

        const alignmentRoot = document.createElement("div");
        alignmentRoot.className = "viewer-body";
        
        const minimapRoot = document.createElement("div");
        minimapRoot.className = "msa-minimap-body";
        
        const trackstackRoot = document.createElement("div");
        trackstackRoot.className = "msa-trackstack-body";
        
        this.root.appendChild(headerRoot);
        this.root.appendChild(alignmentRoot);
        this.root.appendChild(minimapRoot);
        this.root.appendChild(trackstackRoot);

        return { headerRoot, alignmentRoot, minimapRoot, trackstackRoot };
    }

    createViews() {
        const { headerRoot, alignmentRoot, minimapRoot, trackstackRoot } = this.createLayout();
        this.headerRoot = headerRoot;
        this.alignmentRoot = alignmentRoot;
        this.minimapRoot = minimapRoot;
        this.trackstackRoot = trackstackRoot;
        
        this.renderer = this.getRendererForAlphabet(this.getActiveAlphabet());

        this.headerView = new HeaderView({
            root: headerRoot,
            rowHeight: this.state.getSnapshot().viewport.cellHeight,
        });
        
        this.minimapView = new MinimapView({
            root: minimapRoot
        });
        
        this.trackStackView = new TrackStackView({
            root: trackstackRoot
        })

        this.alignmentView = new AlignmentView({
            root: alignmentRoot,
            renderer: this.renderer,
            uniformBuffer: this.uniformBuffer,
            device: this.device,
            format: this.format,
            getCellWidth: () => this.state.getSnapshot().viewport.cellWidth,
            getCellHeight: () => this.state.getSnapshot().viewport.cellHeight,
        });
        
        this.alignmentView.scroller.onmousemove = (event) => {
            if (this.isScrolling) return;
            const [col, row] = this.getCoordsFromScrollerPosition(event);
            if (this.hoveredColumn !== col) {
                this.hoveredColumn = col;
                this.syncAlignmentOverlay();
            }
        }
        this.alignmentView.scroller.onpointerleave = (event) => {
            if (this.hoveredColumn !== null) {
                this.hoveredColumn = null; 
                this.syncAlignmentOverlay();
            }
        }
        this.alignmentView.scroller.onclick = (event) => {
            const [col, row] = this.getCoordsFromScrollerPosition(event);
            this.state.toggleSelectedColumn(col);
        }

        this.setLoadedLayoutVisible(false);
    }
    
    ensureTracks() {
        if (this.qualityTrackView) return;
        const qualityTrackRoot = document.createElement("div");
        qualityTrackRoot.className = "msa-track";
        this.qualityTrackView = new BarTrackView({
            root: qualityTrackRoot,
            id: "quality",
            label: "Quality",
            height: 60
        });
        const occupancyTrackRoot = document.createElement("div");
        occupancyTrackRoot.className = "msa-track";
        this.occupancyTrackView = new BarTrackView({
            root: occupancyTrackRoot,
            id: "occupancy",
            label: "Occupancy",
            height: 60
        });
        const entropyTrackRoot = document.createElement("div");
        entropyTrackRoot.className = "msa-track";
        this.entropyTrackView = new LineTrackView({
            root: entropyTrackRoot,
            id: "entropy",
            label: "Entropy",
            height: 60
        });
        const consensusTrackRoot = document.createElement("div");
        consensusTrackRoot.className = "msa-track";
        this.consensusTrackView = new ConsensusTrackView({
            root: consensusTrackRoot,
            id: "consensus",
            label: "Consensus",
            height: 80,
            darkMode: this.state.getSnapshot().theme.darkMode,
        });

        this.trackStackView.addTrack(this.qualityTrackView);
        this.trackStackView.addTrack(this.occupancyTrackView);
        this.trackStackView.addTrack(this.entropyTrackView);
        this.trackStackView.addTrack(this.consensusTrackView);
        this.trackStackView.setTheme({ darkMode: this.state.getSnapshot().theme.darkMode });
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
    }
    
    async rebuildMinimap() {
        const alignmentStore = this.getActiveAlignmentStore();
        const alignmentState = this.getActiveAlignmentState();
        if (!alignmentStore || !alignmentState || !this.minimapView || !this.device) return;
        const activeRepresentation = this.getActiveRepresentation();
        this.ensureCompatibleSchemeForAlphabet();

        const minimapWidth = this.minimapView.getWidth();
        const minimapHeight = this.minimapView.getHeight();
        if (minimapWidth <= 0 || minimapHeight <= 0) return; 
        const minimapCacheKey = this.getMinimapCacheKey(minimapWidth, minimapHeight);
        if (activeRepresentation?.minimapCache?.key === minimapCacheKey) {
            const { pixels, width, height } = activeRepresentation.minimapCache;
            await this.minimapView.setImageData(pixels, width, height);
            return;
        }

        const totalRows = alignmentStore.totalRows;
        const totalCols = alignmentStore.totalCols;
        const maxTextureDim = this.device.limits.maxTextureDimension2D || 8192;
        const chunkCols = Math.min(totalCols, maxTextureDim);
        const chunkRows = Math.min(totalRows, maxTextureDim);
        
        const minimapSums = new Uint32Array(minimapWidth * minimapHeight * 3);
        const minimapPixels = new Uint8ClampedArray(minimapWidth * minimapHeight * 4);
        const minimapWeights = new Uint32Array(minimapWidth * minimapHeight);
        
        const minimapPipeline = this.getMinimapPipeline();
        
        for (let rowStart = 0; rowStart < totalRows; rowStart += chunkRows) {
            const rowsInChunk = Math.min(chunkRows, totalRows - rowStart);
            for (let colStart = 0; colStart < totalCols; colStart += chunkCols) {
                const colsInChunk = Math.min(chunkCols, totalCols - colStart);
                const chunkData = await materializeWindowFromTiles(
                    alignmentStore,
                    rowStart,
                    rowsInChunk,
                    colStart,
                    colsInChunk,
                    this.decodedTileCache
                );
                const chunkTexture = this.getOrCreateMinimapChunkTexture(colsInChunk, rowsInChunk);
                this.device.queue.writeTexture(
                    { texture: chunkTexture },
                    chunkData,
                    { offset: 0, bytesPerRow: colsInChunk, rowsPerImage: rowsInChunk },
                    [colsInChunk, rowsInChunk, 1]
                );
                const outputBuffer = this.getOrCreateMinimapChunkBuffer(minimapWidth * minimapHeight * 4 * 4);
                const params = {
                    totalRows,
                    totalCols,
                    chunkRowStart: rowStart,
                    chunkColStart: colStart,
                    chunkRows: rowsInChunk,
                    chunkCols: colsInChunk,
                    minimapWidth,
                    minimapHeight,
                };
                const encoder = this.device.createCommandEncoder();
                minimapPipeline.encode(
                    encoder,
                    chunkTexture.createView(),
                    alignmentState.colProfileBuffer,
                    this.themeBuffer,
                    this.getActiveSchemeAuxBuffer(),
                    outputBuffer,
                    params
                );
                this.device.queue.submit([encoder.finish()]);
                const readback = await this.readMinimapChunkBuffer(outputBuffer, minimapWidth, minimapHeight);
                accumulateMinimapChunk(minimapSums, minimapWeights, readback, minimapWidth, minimapHeight);
            }

            await this.device.queue.onSubmittedWorkDone();
        }
        finalizeMinimapPixels(minimapPixels, minimapSums, minimapWeights, this.state.getSnapshot().theme.darkMode);
        if (activeRepresentation) {
            activeRepresentation.minimapCache = {
                key: minimapCacheKey,
                width: minimapWidth,
                height: minimapHeight,
                pixels: minimapPixels.slice(),
            };
        }
        await this.minimapView.setImageData(minimapPixels, minimapWidth, minimapHeight);
    }

    getMinimapCacheKey(width, height) {
        const snapshot = this.state.getSnapshot();
        return [
            snapshot.scheme.key,
            snapshot.theme.darkMode ? "dark" : "light",
            width,
            height,
        ].join(":");
    }
    
    async readMinimapChunkBuffer(outputBuffer, minimapWidth, minimapHeight) {
        const byteLength = minimapWidth * minimapHeight * 4 * Uint32Array.BYTES_PER_ELEMENT;
        const readbackBuffer = this.getOrCreateMinimapReadbackBuffer(byteLength);
        const encoder = this.device.createCommandEncoder();
        encoder.copyBufferToBuffer(outputBuffer, 0, readbackBuffer, 0, byteLength);
        this.device.queue.submit([encoder.finish()]);
        await readbackBuffer.mapAsync(GPUMapMode.READ);
        const copy = new Uint32Array(readbackBuffer.getMappedRange()).slice();
        readbackBuffer.unmap();
        return copy;
    }
    
    getMinimapPipeline() {
        const alphabet = this.getActiveAlphabet();
        if (!this.minimapPipelinesByAlphabet.has(alphabet.id)) {
            this.minimapPipelinesByAlphabet.set(
                alphabet.id,
                new MinimapCompute(this.device, buildMinimapShaderCode(alphabet))
            );
        }
        return this.minimapPipelinesByAlphabet.get(alphabet.id);
    }
    
    syncMinimapViewportRect() {
        const alignmentStore = this.getActiveAlignmentStore();
        if (!alignmentStore || !this.minimapView) return;
        const scrollLeft = this.alignmentView.scroller.scrollLeft;
        const scrollTop = this.alignmentView.scroller.scrollTop;
        const viewportWidth = this.alignmentView.scroller.clientWidth;
        const viewportHeight = this.alignmentView.scroller.clientHeight;
        const contentWidth = alignmentStore.totalCols * this.state.getSnapshot().viewport.cellWidth
        const contentHeight = alignmentStore.totalRows * this.state.getSnapshot().viewport.cellHeight;
        const minimapWidth = this.minimapView.getWidth();
        const minimapHeight = this.minimapView.getHeight();
        const x = scrollLeft / contentWidth * minimapWidth;
        const y = scrollTop / contentHeight * minimapHeight;
        const width = Math.max(1, viewportWidth / contentWidth * minimapWidth);
        const height = Math.max(1, viewportHeight / contentHeight * minimapHeight);
        this.minimapView.setViewportRect({ x, y, width, height });
    }
    
    syncAlignmentOverlay(selectedColumns = this.state.getSnapshot().selection.columns) {
        if (!this.alignmentView) return;
        this.alignmentView.setOverlayState({
            hoveredColumn: this.hoveredColumn,
            selectedColumns,
        });
    }

    // Expose selected columns to outer app
    getSelectedColumns() {
        return new Set(this.state.getSnapshot().selection.columns);
    }
    setSelectedColumns(columns) {
        this.state.setSelectedColumns(new Set(columns));
    }
    clearSelectedColumns() {
        this.state.setSelectedColumns(new Set());
    }
    onSelectionChange(callback) {
        let prev = null;
        return this.state.subscribe((snapshot) => {
            const next = snapshot.selection.columns;
            if (next === prev) return;
            prev = next;
            callback(new Set(next));
        });
    }

    createGpuResources() {
        this.uniformBuffer = this.device.createBuffer({
            size: new Uint32Array(12).byteLength,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        this.themeBuffer = this.device.createBuffer({
            size: new Uint32Array(2).byteLength,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });

        // TODO should not need this
        this.dummyAuxBuffer = this.device.createBuffer({
            size: Int32Array.BYTES_PER_ELEMENT,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
        this.device.queue.writeBuffer(this.dummyAuxBuffer, 0, new Int32Array([0]));

        this.blosum62Buffer = this.device.createBuffer({
            size: BLOSUM62.byteLength,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
        this.device.queue.writeBuffer(this.blosum62Buffer, 0, BLOSUM62);

        this.atlasTexture = this.device.createTexture({
            size: [this.atlasBitmap.width, this.atlasBitmap.height, 1],
            format: "rgba8unorm",
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
        });
        this.device.queue.copyExternalImageToTexture(
            { source: this.atlasBitmap },
            { texture: this.atlasTexture },
            [this.atlasBitmap.width, this.atlasBitmap.height]
        );
        this.atlasSampler = this.device.createSampler({
            magFilter: "linear",
            minFilter: "linear",
        });
    }

    loadStaticAssets() {
        this.computeShaderCodes = {
            clustalx: clustalxComputeShaderCode,
            pid: pidComputeShaderCode,
            blosum62: blosumComputeShaderCode,
            minimap: minimapComputeShaderCode,
        };
        this.computePipelines = new Map();
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

            document.documentElement.dataset.theme = snapshot.theme.darkMode ? "dark" : "light";
            this.syncThemeBuffer();
            this.trackStackView?.setTheme?.({ darkMode: snapshot.theme.darkMode });

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

            this.headerView.syncScroll(snapshot.viewport.scrollTop);
        });
        
        let prevSelectedColumns = null;
        this.unsubscribeSelectionState = this.state.subscribe((snapshot) => {
            if (!this.alignmentView) return;
            const selectedColumns = snapshot.selection.columns;
            if (selectedColumns === prevSelectedColumns) return;
            prevSelectedColumns = selectedColumns;
            this.syncAlignmentOverlay(selectedColumns);    
        })

        // scrolling
        this.onScroll = () => {
            this.isScrolling = true;
            this.hoveredColumn = null;
            this.syncAlignmentOverlay();
            this.state.setViewportScroll(
                this.alignmentView.scroller.scrollLeft,
                this.alignmentView.scroller.scrollTop
            );
            if (this.getActiveAlignmentStore()) {
                void this.uploadVisibleWindow();
            }
            this.syncMinimapViewportRect()
            this.syncTracksViewport();
        };
        this.alignmentView.scroller.addEventListener("scroll", this.onScroll);
        this.alignmentView.scroller.addEventListener("scrollend", () => {
            this.isScrolling = false;
        })

        // window resizing
        this.onResize = () => {
            this.alignmentView.ensureCanvasSize();
            this.headerView.setViewportHeight(this.alignmentView.scroller.clientHeight);
            this.state.setCanvasSize(this.alignmentView.canvas.width, this.alignmentView.canvas.height);
            if (this.getActiveAlignmentStore()) {
                void this.uploadVisibleWindow();
            }
            this.syncMinimapViewportRect()
            this.syncTracksViewport();
        };
        window.addEventListener("resize", this.onResize);

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
        
        // minimap drag
        this.minimapView.onViewportRequest = (request) => {
            if (!request.type) return;
            const alignmentStore = this.getActiveAlignmentStore();
            if (!alignmentStore) return;
            const viewportWidth = this.alignmentView.scroller.clientWidth;
            const viewportHeight = this.alignmentView.scroller.clientHeight;
            const snapshot = this.state.getSnapshot();
            const contentWidth = alignmentStore.totalCols * snapshot.viewport.cellWidth;
            const contentHeight = alignmentStore.totalRows * snapshot.viewport.cellHeight;
            const maxScrollLeft = Math.max(0, contentWidth - viewportWidth);
            const maxScrollTop = Math.max(0, contentHeight - viewportHeight);
            if (request.type === "drag") {
                const { leftRatio, topRatio } = request;
                const scrollLeft = leftRatio * maxScrollLeft;
                const scrollTop = topRatio * maxScrollTop;
                this.alignmentView.scrollTo(scrollLeft, scrollTop)
            } else if (request.type === "jump") {
                const { centerXRatio, centerYRatio } = request;
                const scrollLeft = centerXRatio * contentWidth - viewportWidth / 2;
                const scrollTop = centerYRatio * contentHeight - viewportHeight / 2;
                this.alignmentView.scrollTo(
                    Math.max(0, Math.min(scrollLeft, maxScrollLeft)),
                    Math.max(0, Math.min(scrollTop, maxScrollTop)),
                )                
            }
        }
        
    }
    
    getVisibleWindowBounds() {
        const alignmentStore = this.getActiveAlignmentStore();
        const scrollLeft = this.alignmentView.scroller.scrollLeft;
        const scrollTop = this.alignmentView.scroller.scrollTop;
        const viewportWidth = this.alignmentView.scroller.clientWidth;
        const viewportHeight = this.alignmentView.scroller.clientHeight;
        const cellWidth = this.alignmentView.getRenderedCellWidthCss();
        const cellHeight = this.alignmentView.getRenderedCellHeightCss();
        const rowStart = Math.max(0, Math.floor(scrollTop / cellHeight) - this.viewportOverscanRows);
        const rowEnd = Math.min(
            alignmentStore.totalRows,
            Math.ceil((scrollTop + viewportHeight) / cellHeight) + this.viewportOverscanRows
        );
        const colStart = Math.max(0, Math.floor(scrollLeft / cellWidth) - this.viewportOverscanCols);
        const colEnd = Math.min(
            alignmentStore.totalCols,
            Math.ceil((scrollLeft + viewportWidth) / cellWidth) + this.viewportOverscanCols
        );
        return { rowStart, rowEnd, colStart, colEnd };
    }

    async activateRepresentation(id, { resetView = false } = {}) {
        const representation = this.representations.get(id);
        if (!representation) {
            throw new Error(`Unknown representation: ${id}`);
        }

        const previousSnapshot = this.state.getSnapshot();
        const previousScrollLeft = this.alignmentView?.scroller?.scrollLeft ?? previousSnapshot.viewport.scrollLeft;
        const previousScrollTop = this.alignmentView?.scroller?.scrollTop ?? previousSnapshot.viewport.scrollTop;
        const { store, alphabetId } = representation;
        const { records, totalCols, totalRows } = store;

        this.alignmentStore = store;
        this.alignmentState = representation.alignmentState;
        this.columnMetrics = representation.columnMetrics;
        this.decodedTileCache.clear();
        this.visibleWindowState = null;
        this.hoveredColumn = null;
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
        this.setLoadedLayoutVisible(true);
        this.ensureCompatibleSchemeForAlphabet(this.alphabetRegistry.get(alphabetId));
        this.renderer = this.getRendererForAlphabet(this.getActiveAlphabet());
        this.alignmentView.renderer = this.renderer;

        await this.recomputeColumnProfile();
        if (!representation.columnMetrics) {
            await this.recomputeColumnMetrics();
        }
        const activeColumnMetrics = representation.columnMetrics ?? this.getActiveColumnMetrics();
        if (!representation.trackState) {
            representation.trackState = buildTrackState(activeColumnMetrics, totalRows, this.getActiveAlphabet());
        }

        this.alignmentView.setAlignmentSize(totalCols, totalRows);
        this.alignmentView.ensureCanvasSize();
        if (resetView) {
            this.alignmentView.scrollTo(0, 0);
        } else {
            this.alignmentView.scrollTo(previousScrollLeft, previousScrollTop);
        }
        this.headerView.renderRecords(records);
        this.headerView.syncScroll(this.alignmentView.scroller.scrollTop);
        this.alignmentView.setOverlayState({
            hoveredColumn: null,
            selectedColumns: this.state.getSnapshot().selection.columns,
        });

        await this.uploadVisibleWindow();
        await this.rebuildMinimap();
        this.syncMinimapViewportRect();
        this.syncAlignmentOverlay();
        this.ensureTracks();
        this.trackStackView.setTrackState(representation.trackState);
        this.syncTracksViewport();
        this.headerView.setViewportHeight(this.alignmentView.scroller.clientHeight);
    }

    registerRepresentation(id, store, { alphabetId = id } = {}) {
        const resolvedAlphabet = this.alphabetRegistry.get(alphabetId);
        if (!resolvedAlphabet) {
            throw new Error(`Unknown alphabet: ${alphabetId}`);
        }

        const { totalCols, totalRows } = store;
        const snapshot = this.state.getSnapshot();
        const scheme = SCHEMES[snapshot.scheme.key];

        let colProfileBuffer = this.representations.get(id)?.alignmentState?.colProfileBuffer ?? null;
        if (!colProfileBuffer || this.representations.get(id)?.alignmentState?.totalCols !== totalCols) {
            colProfileBuffer?.destroy?.();
            colProfileBuffer = this.device.createBuffer({
                size: totalCols * scheme.profileStride,
                usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
            });
        }

        const representation = {
            id,
            alphabetId: resolvedAlphabet.id,
            store,
            columnMetrics: null,
            alignmentState: { colProfileBuffer, totalCols, totalRows },
            trackState: null,
            minimapCache: null,
        };
        this.representations.set(id, representation);
        return representation;
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

    syncTracksViewport() {
        if (!this.trackStackView) return;
        const alignmentStore = this.getActiveAlignmentStore();
        if (!alignmentStore) return;
        const scrollLeft = this.alignmentView.scroller.scrollLeft;
        const viewportWidth = this.alignmentView.scroller.clientWidth;
        const cellWidth = this.alignmentView.getRenderedCellWidthCss();
        const totalCols = alignmentStore.totalCols;
        const colStart = Math.floor(scrollLeft / cellWidth);
        const colEnd = Math.min(totalCols, Math.ceil((scrollLeft + viewportWidth) / cellWidth));
        this.trackStackView.setViewport({
            scrollLeft,
            viewportWidth,
            cellWidth,
            totalCols,
            colStart,
            colEnd,
        });
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
        if (!this.isSchemeSupportedForAlphabet(schemeKey)) {
            throw new Error(`Scheme '${schemeKey}' is not supported for alphabet '${this.getActiveAlphabet().id}'.`);
        }
        const alignmentState = this.getActiveAlignmentState();
        if (snapshot.scheme.key === schemeKey) return;

        this.state.setScheme(schemeKey);
        this.syncThemeBuffer();

        if (SCHEMES[schemeKey].type === "columnStatistic") {
            await this.recomputeColumnProfile();
        }

        if (this.visibleWindowState) {
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
        const alphabet = this.getActiveAlphabet();
        const bucketStride = alphabet.metricConfig.bucketStride;

        const totalCols = alignmentStore.totalCols;
        const totalRows = alignmentStore.totalRows;
        const tileCols = alignmentStore.tileCols; // 512
        const tileRows = alignmentStore.tileRows; // 256
        const totalVerticalTiles = alignmentStore.rowTileCount;
        
        const metricPipeline = this.getColumnMetricPipeline();
        const tileBuffer = this.getOrCreateMetricTileBuffer(tileCols * tileRows);
        const uniformBuffer = this.getOrCreateMetricUniformBuffer();
        const intermediateBuffer = this.getOrCreateMetricIntermediateBuffer(
            tileCols * totalVerticalTiles * bucketStride * Uint32Array.BYTES_PER_ELEMENT
        );
        const bandMetricBuffer = this.getOrCreateMetricBandBuffer(
            tileCols * 7 * Float32Array.BYTES_PER_ELEMENT
        );
        const finalQuality = new Float32Array(totalCols);
        const finalOccupancy = new Float32Array(totalCols);
        const finalEntropy = new Float32Array(totalCols);
        const finalModalFractionNonGap = new Float32Array(totalCols);
        const finalInformationContentRaw = new Float32Array(totalCols);
        const finalConsensusIndex = new Uint16Array(totalCols);
        const finalConsensusTie = new Uint8Array(totalCols);
        
        const bandCountBuffer = this.getOrCreateMetricCountBuffer(
            tileCols * bucketStride * Uint32Array.BYTES_PER_ELEMENT
        );
        const finalCounts = new Uint32Array(totalCols * bucketStride);
        
        for (let colTile = 0; colTile < alignmentStore.colTileCount; colTile += 1) {
            const colStart = colTile * tileCols;
            const colsInBand = Math.min(tileCols, totalCols - colStart);
            this.device.queue.writeBuffer(
                intermediateBuffer, 0, new Uint32Array(colsInBand * totalVerticalTiles * bucketStride)
            );
            for (let rowTile = 0; rowTile < totalVerticalTiles; rowTile += 1) {
                const tileIndex = rowTile * alignmentStore.colTileCount + colTile;
                const tileMeta = alignmentStore.tiles[tileIndex];
                const tileData = await loadDecodedTile(alignmentStore, tileIndex, this.decodedTileCache);
                this.device.queue.writeBuffer(tileBuffer, 0, tileData);
                metricPipeline.updateUniforms(
                    uniformBuffer,
                    totalVerticalTiles,
                    totalRows,
                    totalCols,
                    rowTile,
                    colStart,
                    colsInBand
                );
                const encoder = this.device.createCommandEncoder();
                metricPipeline.encodeCount(
                    encoder,
                    tileBuffer,
                    intermediateBuffer,
                    uniformBuffer,
                    colsInBand
                );
                this.device.queue.submit([encoder.finish()]);
            }
            {
                const encoder = this.device.createCommandEncoder();
                metricPipeline.updateUniforms(
                    uniformBuffer,
                    totalVerticalTiles,
                    totalRows,
                    totalCols,
                    0,
                    colStart,
                    colsInBand
                );
                metricPipeline.encodeAggregate(
                    encoder,
                    intermediateBuffer,
                    bandMetricBuffer,
                    uniformBuffer,
                    colsInBand,
                    bandCountBuffer,
                );
                this.device.queue.submit([encoder.finish()]);
            }

            const bandMetrics = await this.readMetricBandBuffer(bandMetricBuffer, colsInBand * 7);
            const bandCounts = await this.readCountBandBuffer(bandCountBuffer, colsInBand * bucketStride);
            for (let i = 0; i < colsInBand; i += 1) {
                const offset = i * 7;
                finalQuality[colStart + i] = bandMetrics[offset];
                finalOccupancy[colStart + i] = bandMetrics[offset + 1];
                finalEntropy[colStart + i] = bandMetrics[offset + 2];
                finalModalFractionNonGap[colStart + i] = bandMetrics[offset + 3];
                finalInformationContentRaw[colStart + i] = bandMetrics[offset + 4];
                finalConsensusIndex[colStart + i] = Math.round(bandMetrics[offset + 5]);
                finalConsensusTie[colStart + i] = Math.round(bandMetrics[offset + 6]);

                const countSrc = i * bucketStride;
                const countDst = (colStart + i) * bucketStride;
                finalCounts.set(bandCounts.subarray(countSrc, countSrc + bucketStride), countDst);
            }
        }
        
        this.columnMetrics = {
            quality: finalQuality,
            occupancy: finalOccupancy,
            entropy: finalEntropy,
            modalFractionNonGap: finalModalFractionNonGap,
            informationContentRaw: finalInformationContentRaw,
            consensusIndex: finalConsensusIndex,
            consensusTie: finalConsensusTie,
            counts: finalCounts,
        };
        const activeRepresentation = this.getActiveRepresentation();
        if (activeRepresentation) {
            activeRepresentation.columnMetrics = this.columnMetrics;
            activeRepresentation.trackState = null;
            activeRepresentation.minimapCache = null;
        }
    }
    
    async recomputeColumnProfile() {
        const alignmentStore = this.getActiveAlignmentStore();
        const alignmentState = this.getActiveAlignmentState();
        const snapshot = this.state.getSnapshot();
        const activeScheme = SCHEMES[snapshot.scheme.key];
        if (activeScheme.type !== "columnStatistic") {
            this.device.queue.writeBuffer(
                alignmentState.colProfileBuffer,
                0,
                new Uint32Array(alignmentState.totalCols),
            );
            return;
        }
        const totalCols = alignmentStore.totalCols;
        const totalRows = alignmentStore.totalRows;
        const maxTextureDim = this.device.limits.maxTextureDimension2D ?? 8192;
        const maxLayers = this.device.limits.maxTextureArrayLayers ?? 256;
        const rowsPerLayer = Math.min(totalRows, maxTextureDim);
        const requiredLayers = Math.ceil(totalRows / rowsPerLayer);
        if (requiredLayers > maxLayers) {
            throw new Error(`Alignment row count exceeds texture array layer limit (${requiredLayers} > ${maxLayers}).`);
        }
        const chunkCols = Math.min(totalCols, maxTextureDim);
        const computePipeline = this.getComputePipeline(snapshot.scheme.key);

        for (let colStart = 0; colStart < totalCols; colStart += chunkCols) {
            const colsInChunk = Math.min(chunkCols, totalCols - colStart);
            const chunkData = await materializeWindowFromTiles(
                alignmentStore,
                0,
                totalRows,
                colStart,
                colsInChunk,
                this.decodedTileCache
            );
            const chunkTexture = this.device.createTexture({
                size: [colsInChunk, rowsPerLayer, requiredLayers],
                format: "r8uint",
                usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
            });
            for (let layer = 0; layer < requiredLayers; layer += 1) {
                const layerRowStart = layer * rowsPerLayer;
                const layerRows = Math.min(rowsPerLayer, totalRows - layerRowStart);
                const layerByteStart = layerRowStart * colsInChunk;
                const layerByteEnd = layerByteStart + layerRows * colsInChunk;
                this.device.queue.writeTexture(
                    {
                        texture: chunkTexture,
                        origin: { x: 0, y: 0, z: layer },
                    },
                    chunkData.subarray(layerByteStart, layerByteEnd),
                    {
                        offset: 0,
                        bytesPerRow: colsInChunk,
                        rowsPerImage: layerRows,
                    },
                    [colsInChunk, layerRows, 1]
                );
            }

            const chunkBuffer = this.getOrCreateProfileChunkBuffer(colsInChunk * activeScheme.profileStride);
            const commandEncoder = this.device.createCommandEncoder();
            computePipeline.encode(
                commandEncoder,
                chunkTexture.createView({ dimension: "2d-array", arrayLayerCount: requiredLayers }),
                chunkBuffer,
                colsInChunk,
                totalRows,
                rowsPerLayer
            );
            commandEncoder.copyBufferToBuffer(
                chunkBuffer,
                0,
                alignmentState.colProfileBuffer,
                colStart * activeScheme.profileStride,
                colsInChunk * activeScheme.profileStride
            );
            this.device.queue.submit([commandEncoder.finish()]);
            chunkTexture.destroy();
        }
        await this.device.queue.onSubmittedWorkDone();
    }

    getComputePipeline(schemeKey) {
        if (!this.computePipelines.has(schemeKey)) {
            this.computePipelines.set(
                schemeKey,
                new ColumnProfileCompute(this.device, this.computeShaderCodes[schemeKey])
            );
        }
        return this.computePipelines.get(schemeKey);
    }

    getColumnMetricPipeline() {
        const alphabet = this.getActiveAlphabet();
        if (!this.metricPipeline || this.metricPipelineAlphabetId !== alphabet.id) {
            this.metricPipeline = new ColumnMetricCompute(
                this.device,
                buildMetricShaderCode(alphabet),
                this.getQualityMatrixBuffer(alphabet)
            );
            this.metricPipelineAlphabetId = alphabet.id;
        }
        return this.metricPipeline;
    }

    getQualityMatrixBuffer(alphabet) {
        if (!alphabet.supports?.quality || !alphabet.qualityMatrix) {
            return this.dummyAuxBuffer;
        }
        if (this.qualityMatrixBuffers.has(alphabet.id)) {
            return this.qualityMatrixBuffers.get(alphabet.id);
        }
        const buffer = this.device.createBuffer({
            size: alphabet.qualityMatrix.byteLength,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
        this.device.queue.writeBuffer(buffer, 0, alphabet.qualityMatrix);
        this.qualityMatrixBuffers.set(alphabet.id, buffer);
        return buffer;
    }

    getActiveSchemeAuxBuffer() {
        const snapshot = this.state.getSnapshot();
        if (snapshot.scheme.key === "blosum62" && this.getActiveAlphabet().supports?.quality) {
            return this.getQualityMatrixBuffer(this.getActiveAlphabet());
        }
        return this.dummyAuxBuffer;
    }

    getOrCreateMetricTileBuffer(byteLength) {
        if (this.metricTileBuffer && this.metricTileCapacity >= byteLength) {
            return this.metricTileBuffer;
        }
        this.metricTileBuffer?.destroy?.();
        this.metricTileCapacity = byteLength;
        this.metricTileBuffer = this.device.createBuffer({
            size: byteLength,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
        return this.metricTileBuffer;
    }

    getOrCreateMetricUniformBuffer() {
        if (this.metricUniformBuffer) {
            return this.metricUniformBuffer;
        }
        this.metricUniformBuffer = this.device.createBuffer({
            size: Uint32Array.BYTES_PER_ELEMENT * 8,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        return this.metricUniformBuffer;
    }

    getOrCreateMetricIntermediateBuffer(byteLength) {
        if (this.metricIntermediateBuffer && this.metricIntermediateCapacity >= byteLength) {
            return this.metricIntermediateBuffer;
        }
        this.metricIntermediateBuffer?.destroy?.();
        this.metricIntermediateCapacity = byteLength;
        this.metricIntermediateBuffer = this.device.createBuffer({
            size: byteLength,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
        return this.metricIntermediateBuffer;
    }

    getOrCreateMetricBandBuffer(byteLength) {
        if (this.metricBandBuffer && this.metricBandCapacity >= byteLength) {
            return this.metricBandBuffer;
        }
        this.metricBandBuffer?.destroy?.();
        this.metricBandCapacity = byteLength;
        this.metricBandBuffer = this.device.createBuffer({
            size: byteLength,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
        });
        return this.metricBandBuffer;
    }

    getOrCreateMetricCountBuffer(byteLength) {
        if (this.metricCountBuffer && this.metricCountCapacity >= byteLength) {
            return this.metricCountBuffer;
        }
        this.metricCountBuffer?.destroy?.();
        this.metricCountCapacity = byteLength;
        this.metricCountBuffer = this.device.createBuffer({
            size: byteLength,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
        });
        return this.metricCountBuffer;
    }

    getOrCreateMetricReadbackBuffer(byteLength) {
        if (this.metricReadbackBuffer && this.metricReadbackCapacity >= byteLength) {
            return this.metricReadbackBuffer;
        }
        this.metricReadbackBuffer?.destroy?.();
        this.metricReadbackCapacity = byteLength;
        this.metricReadbackBuffer = this.device.createBuffer({
            size: byteLength,
            usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
        });
        return this.metricReadbackBuffer;
    }

    async readMetricBandBuffer(metricBuffer, floatCount) {
        const byteLength = floatCount * Float32Array.BYTES_PER_ELEMENT;
        const readbackBuffer = this.getOrCreateMetricReadbackBuffer(byteLength);
        const encoder = this.device.createCommandEncoder();
        encoder.copyBufferToBuffer(metricBuffer, 0, readbackBuffer, 0, byteLength);
        this.device.queue.submit([encoder.finish()]);
        await readbackBuffer.mapAsync(GPUMapMode.READ, 0, byteLength);
        const copy = new Float32Array(readbackBuffer.getMappedRange(0, byteLength)).slice();
        readbackBuffer.unmap();
        return copy;
    }
    
    getOrCreateCountsReadbackBuffer(byteLength) {
        if (this.countsReadbackBuffer && this.countsReadbackCapacity >= byteLength) {
            return this.countsReadbackBuffer;
        }
        this.countsReadbackBuffer?.destroy?.();
        this.countsReadbackCapacity = byteLength;
        this.countsReadbackBuffer = this.device.createBuffer({
            size: byteLength,
            usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
        });
        return this.countsReadbackBuffer;
    }

    async readCountBandBuffer(countBuffer, countValueCount) {
        const byteLength = countValueCount * Uint32Array.BYTES_PER_ELEMENT;
        const readbackBuffer = this.getOrCreateCountsReadbackBuffer(byteLength);
        const encoder = this.device.createCommandEncoder();
        encoder.copyBufferToBuffer(countBuffer, 0, readbackBuffer, 0, byteLength);
        this.device.queue.submit([encoder.finish()]);
        await readbackBuffer.mapAsync(GPUMapMode.READ, 0, byteLength);
        const copy = new Uint32Array(readbackBuffer.getMappedRange(0, byteLength)).slice();
        readbackBuffer.unmap();
        return copy;
    }

    getOrCreateMinimapChunkBuffer(byteLength) {
        if (this.minimapChunkBuffer && this.minimapChunkCapacity >= byteLength) {
            return this.minimapChunkBuffer;
        }
        this.minimapChunkBuffer?.destroy?.();
        this.minimapChunkCapacity = byteLength;
        this.minimapChunkBuffer = this.device.createBuffer({
            size: byteLength,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
        });
        return this.minimapChunkBuffer;
    }

    getOrCreateMinimapReadbackBuffer(byteLength) {
        if (this.minimapReadbackBuffer && this.minimapReadbackCapacity >= byteLength) {
            return this.minimapReadbackBuffer;
        }
        this.minimapReadbackBuffer?.destroy?.();
        this.minimapReadbackCapacity = byteLength;
        this.minimapReadbackBuffer = this.device.createBuffer({
            size: byteLength,
            usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
        });
        return this.minimapReadbackBuffer;
    }

    getOrCreateMinimapChunkTexture(width, height) {
        if (
            this.minimapChunkTexture &&
            this.minimapChunkTextureWidth >= width &&
            this.minimapChunkTextureHeight >= height
        ) {
            return this.minimapChunkTexture;
        }
        this.minimapChunkTexture?.destroy?.();
        this.minimapChunkTextureWidth = width;
        this.minimapChunkTextureHeight = height;
        this.minimapChunkTexture = this.device.createTexture({
            size: [width, height, 1],
            format: "r8uint",
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
        });
        return this.minimapChunkTexture;
    }

    getOrCreateProfileChunkBuffer(byteLength) {
        if (this.profileChunkBuffer && this.profileChunkCapacity >= byteLength) {
            return this.profileChunkBuffer;
        }
        this.profileChunkBuffer?.destroy?.();
        this.profileChunkCapacity = byteLength;
        this.profileChunkBuffer = this.device.createBuffer({
            size: byteLength,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
        });
        return this.profileChunkBuffer;
    }

    async uploadVisibleWindow() {
        const alignmentStore = this.getActiveAlignmentStore();
        const alignmentState = this.getActiveAlignmentState();
        if (!alignmentStore || !alignmentState) {
            return;
        }
        this.ensureCompatibleSchemeForAlphabet();

        const { rowStart, rowEnd, colStart, colEnd } = this.getVisibleWindowBounds();
        const rowCount = rowEnd - rowStart;
        const colCount = colEnd - colStart;
        if (rowCount <= 0 || colCount <= 0) {
            return;
        }
        const key = `${rowStart}:${rowCount}:${colStart}:${colCount}`;
        if (this.visibleWindowState?.key === key) {
            return;
        }

        const data = await materializeWindowFromTiles(
            alignmentStore,
            rowStart,
            rowCount,
            colStart,
            colCount,
            this.decodedTileCache
        );

        const previousTexture = this.visibleWindowState?.texture ?? null;
        const needsNewTexture =
            !previousTexture ||
            this.visibleWindowState.rowCount !== rowCount ||
            this.visibleWindowState.colCount !== colCount;

        const texture = needsNewTexture
            ? this.device.createTexture({
                size: [Math.max(1, colCount), Math.max(1, rowCount), 1],
                format: "r8uint",
                usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
            })
            : previousTexture;

        this.device.queue.writeTexture(
            { texture },
            data,
            {
                offset: 0,
                bytesPerRow: Math.max(1, colCount),
                rowsPerImage: Math.max(1, rowCount),
            },
            [Math.max(1, colCount), Math.max(1, rowCount), 1]
        );

        this.visibleWindowState = { key, rowStart, rowCount, colStart, colCount, texture };
        this.decodedTileCache.retain(
            getTileIndicesForWindow(alignmentStore, rowStart, rowCount, colStart, colCount)
        );
        this.renderBindGroup = this.createRenderBindGroup();
        this.alignmentView.setBindGroup(this.renderBindGroup);
        this.state.setGpuResources({
            msaTexture: texture,
            colProfileBuffer: alignmentState.colProfileBuffer,
            renderBindGroup: this.renderBindGroup,
        });

        // cleanup
        if (needsNewTexture && previousTexture) {
            previousTexture.destroy();
        }
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
                    resource: { buffer: this.getActiveSchemeAuxBuffer() }
                },
            ]
        });
    }

    getRendererForAlphabet(alphabet) {
        if (!this.renderersByAlphabet.has(alphabet.id)) {
            this.renderersByAlphabet.set(
                alphabet.id,
                new MSARenderer(this.device, this.format, buildMSARenderShaderCode(alphabet))
            );
        }
        return this.renderersByAlphabet.get(alphabet.id);
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

        this.alignmentView.scroller.removeEventListener("scroll", this.onScroll);
        window.removeEventListener("resize", this.onResize);
        window.removeEventListener("keydown", this.onKeyDown);
        this.themeMedia.removeEventListener("change", this.onThemeChange);
    }
}
