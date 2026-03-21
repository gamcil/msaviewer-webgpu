/* Handles rendering of the MSA alignment and headers, as well as scroll synchronization between them. */
import { ViewerState } from "./ViewerState.js";
import { HeaderView } from "../views/HeaderView.js";
import { AlignmentView } from "../views/AlignmentView.js";
import { MSARenderer } from "../graphics/pipelines/MSARenderer.js";
import { ColumnProfileCompute } from "../graphics/pipelines/ColumnProfileCompute.js";
import { BLOSUM62 } from "../graphics/data/blosum62.js";
import { SCHEMES } from "../schemes/registry.js";
import { loadImageBitmap } from "../util.js";
import { parseFastaAlignment } from "../alignment/fasta.js";
import { parseA3MAlignment } from "../alignment/a3m.js";
import { TileCache, getTileIndicesForWindow, loadDecodedTile, materializeWindowFromTiles } from "../alignment/tiledStorage.js";
import renderShaderCode from "../graphics/shaders/msa.render.wgsl?raw";
import clustalxComputeShaderCode from "../graphics/shaders/clustalx.compute.wgsl?raw";
import pidComputeShaderCode from "../graphics/shaders/pident.compute.wgsl?raw";
import blosumComputeShaderCode from "../graphics/shaders/blosum.compute.wgsl?raw";
import minimapComputeShaderCode from "../graphics/shaders/minimap.compute.wgsl?raw";
import metricsComputeShaderCode from "../graphics/shaders/metrics.compute.wgsl?raw";
import { MinimapView } from "../views/MinimapView.js";
import { MinimapCompute } from "../graphics/pipelines/MinimapCompute.js";
import { ColumnMetricCompute } from "../graphics/pipelines/ColumnMetricCompute.js";
import { TrackStackView } from "../views/TrackStackView.js";
import { BarTrackView } from "../views/BarTrackView.js";
import { LineTrackView } from "../views/LineTrackView.js";

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
    }) {
        this.root = root;
        this.device = device;
        this.format = format;
        this.themeMedia = themeMedia ?? window.matchMedia("(prefers-color-scheme: dark)");
        
        this.state = new ViewerState({
            schemeKey: "clustalx",
            themeMode: "auto",
            darkMode: this.themeMedia.matches,
        });

        this.renderShaderCode = null;
        this.atlasBitmap = null;
        
        this.headerView = null;
        this.alignmentView = null;
        this.renderer = null;

        this.uniformBuffer = null;
        this.themeBuffer = null;
        this.renderBindGroup = null;

        this.computeShaderCodes = {};
        this.computePipelines = new Map();
        this.alignmentState = null;
        this.alignmentStore = null;
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
        this.metricReadbackBuffer = null;
        this.metricReadbackCapacity = 0;
        this.metricPipeline = null;
        this.columnMetrics = null;

        // minimap chunking separate to column statistics
        this.minimapChunkBuffer = null;
        this.minimapChunkCapacity = 0;
        this.minimapReadbackBuffer = null;
        this.minimapReadbackCapacity = 0;
        this.minimapChunkTexture = null;
        this.minimapChunkTextureWidth = 0;
        this.minimapChunkTextureHeight = 0;
        
        // alignment view hover state
        this.hoveredCell = null;
        this.hoveredColumn = null;
        
        this.isScrolling = false;
        
        this.frameHandle = null;
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
        
        this.renderer = new MSARenderer(this.device, this.format, this.renderShaderCode);

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
        this.trackStackView.addTrack(this.qualityTrackView);
        this.trackStackView.addTrack(this.occupancyTrackView);
        this.trackStackView.addTrack(this.entropyTrackView);
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
        if (!this.alignmentStore || !this.minimapView || !this.device) return;

        const minimapWidth = this.minimapView.getWidth();
        const minimapHeight = this.minimapView.getHeight();
        if (minimapWidth <= 0 || minimapHeight <= 0) return; 

        const totalRows = this.alignmentStore.totalRows;
        const totalCols = this.alignmentStore.totalCols;
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
                    this.alignmentStore,
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
                    this.alignmentState.colProfileBuffer,
                    this.themeBuffer,
                    this.state.getSnapshot().scheme.key === "blosum62" ? this.blosum62Buffer : this.dummyAuxBuffer,
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
        await this.minimapView.setImageData(minimapPixels, minimapWidth, minimapHeight);
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
        if (!this.minimapPipeline) {
            this.minimapPipeline = new MinimapCompute(this.device, this.computeShaderCodes["minimap"]);
        }
        return this.minimapPipeline;
    }
    
    syncMinimapViewportRect() {
        if (!this.alignmentStore || !this.minimapView) return;
        const scrollLeft = this.alignmentView.scroller.scrollLeft;
        const scrollTop = this.alignmentView.scroller.scrollTop;
        const viewportWidth = this.alignmentView.scroller.clientWidth;
        const viewportHeight = this.alignmentView.scroller.clientHeight;
        const contentWidth = this.alignmentStore.totalCols * this.state.getSnapshot().viewport.cellWidth
        const contentHeight = this.alignmentStore.totalRows * this.state.getSnapshot().viewport.cellHeight;
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
            metrics: metricsComputeShaderCode,
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
            if (this.alignmentStore) {
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
            if (this.alignmentStore) {
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
            if (!this.alignmentState) return;
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
            const viewportWidth = this.alignmentView.scroller.clientWidth;
            const viewportHeight = this.alignmentView.scroller.clientHeight;
            const snapshot = this.state.getSnapshot();
            const contentWidth = this.alignmentStore.totalCols * snapshot.viewport.cellWidth;
            const contentHeight = this.alignmentStore.totalRows * snapshot.viewport.cellHeight;
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
        const scrollLeft = this.alignmentView.scroller.scrollLeft;
        const scrollTop = this.alignmentView.scroller.scrollTop;
        const viewportWidth = this.alignmentView.scroller.clientWidth;
        const viewportHeight = this.alignmentView.scroller.clientHeight;
        const cellWidth = this.alignmentView.getRenderedCellWidthCss();
        const cellHeight = this.alignmentView.getRenderedCellHeightCss();
        const rowStart = Math.max(0, Math.floor(scrollTop / cellHeight) - this.viewportOverscanRows);
        const rowEnd = Math.min(
            this.alignmentStore.totalRows,
            Math.ceil((scrollTop + viewportHeight) / cellHeight) + this.viewportOverscanRows
        );
        const colStart = Math.max(0, Math.floor(scrollLeft / cellWidth) - this.viewportOverscanCols);
        const colEnd = Math.min(
            this.alignmentStore.totalCols,
            Math.ceil((scrollLeft + viewportWidth) / cellWidth) + this.viewportOverscanCols
        );
        return { rowStart, rowEnd, colStart, colEnd };
    }

    async loadAlignment(store) {
        const { records, totalCols, totalRows } = store;
        const snapshot = this.state.getSnapshot();
        const scheme = SCHEMES[snapshot.scheme.key];

        let colProfileBuffer = this.alignmentState?.colProfileBuffer ?? null;
        if (!colProfileBuffer || this.alignmentState?.totalCols !== totalCols) {
            colProfileBuffer?.destroy?.();
            colProfileBuffer = this.device.createBuffer({
                size: totalCols * scheme.profileStride,
                usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
            });
        }

        this.alignmentStore = store;
        this.decodedTileCache.clear();
        this.visibleWindowState = null;
        this.columnMetrics = null;
        this.hoveredColumn = null;
        this.isScrolling = false;
        this.alignmentState = { colProfileBuffer, totalCols, totalRows };
        this.state.setAlignment({ records, totalCols, totalRows });
        this.setLoadedLayoutVisible(true);

        await this.recomputeColumnProfile();
        await this.recomputeColumnMetrics();
        
        // quality tracks

        this.alignmentView.setAlignmentSize(totalCols, totalRows);
        this.alignmentView.scrollTo(0, 0);
        this.alignmentView.ensureCanvasSize();
        this.headerView.renderRecords(records);
        this.headerView.syncScroll(this.alignmentView.scroller.scrollTop);
        this.alignmentView.setOverlayState({
            hoveredColumn: null,
            selectedColumns: this.state.getSnapshot().selection.columns,
        });

        await this.uploadVisibleWindow();
        await this.rebuildMinimap();
        this.syncMinimapViewportRect()
        this.syncAlignmentOverlay();
        this.ensureTracks();
        this.qualityTrackView.setData(this.columnMetrics.quality);
        this.occupancyTrackView.setData(this.columnMetrics.occupancy);
        this.entropyTrackView.setData(this.columnMetrics.entropy);
        this.syncTracksViewport();
        this.headerView.setViewportHeight(this.alignmentView.scroller.clientHeight);
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
        const scrollLeft = this.alignmentView.scroller.scrollLeft;
        const viewportWidth = this.alignmentView.scroller.clientWidth;
        const cellWidth = this.alignmentView.getRenderedCellWidthCss();
        const totalCols = this.alignmentStore.totalCols;
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
                colProfileBuffer: this.alignmentState.colProfileBuffer,
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
        if (!this.alignmentStore) return;

        const totalCols = this.alignmentStore.totalCols;
        const totalRows = this.alignmentStore.totalRows;
        const tileCols = this.alignmentStore.tileCols; // 512
        const tileRows = this.alignmentStore.tileRows; // 256
        const totalVerticalTiles = this.alignmentStore.rowTileCount;
        
        const metricPipeline = this.getColumnMetricPipeline();
        const tileBuffer = this.getOrCreateMetricTileBuffer(tileCols * tileRows);
        const uniformBuffer = this.getOrCreateMetricUniformBuffer();
        const intermediateBuffer = this.getOrCreateMetricIntermediateBuffer(
            tileCols * totalVerticalTiles * 21 * Uint32Array.BYTES_PER_ELEMENT
        );
        const bandMetricBuffer = this.getOrCreateMetricBandBuffer(
            tileCols * 3 * Float32Array.BYTES_PER_ELEMENT
        );
        const finalQuality = new Float32Array(totalCols);
        const finalOccupancy = new Float32Array(totalCols);
        const finalEntropy = new Float32Array(totalCols);
        
        for (let colTile = 0; colTile < this.alignmentStore.colTileCount; colTile += 1) {
            const colStart = colTile * tileCols;
            const colsInBand = Math.min(tileCols, totalCols - colStart);
            this.device.queue.writeBuffer(
                intermediateBuffer, 0, new Uint32Array(colsInBand * totalVerticalTiles * 21)
            );
            for (let rowTile = 0; rowTile < totalVerticalTiles; rowTile += 1) {
                const tileIndex = rowTile * this.alignmentStore.colTileCount + colTile;
                const tileMeta = this.alignmentStore.tiles[tileIndex];
                const tileData = await loadDecodedTile(this.alignmentStore, tileIndex, this.decodedTileCache);
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
                    colsInBand
                );
                this.device.queue.submit([encoder.finish()]);
            }

            const bandMetrics = await this.readMetricBandBuffer(bandMetricBuffer, colsInBand * 3);
            for (let i = 0; i < colsInBand; i += 1) {
                const offset = i * 3;
                finalQuality[colStart + i] = bandMetrics[offset];
                finalOccupancy[colStart + i] = bandMetrics[offset + 1];
                finalEntropy[colStart + i] = bandMetrics[offset + 2];
            }
        }
        
        this.columnMetrics = {
            quality: finalQuality,
            occupancy: finalOccupancy,
            entropy: finalEntropy,
        };
    }
    
    async recomputeColumnProfile() {
        const snapshot = this.state.getSnapshot();
        const activeScheme = SCHEMES[snapshot.scheme.key];
        if (activeScheme.type !== "columnStatistic") {
            this.device.queue.writeBuffer(
                this.alignmentState.colProfileBuffer,
                0,
                new Uint32Array(this.alignmentState.totalCols),
            );
            return;
        }
        const totalCols = this.alignmentStore.totalCols;
        const totalRows = this.alignmentStore.totalRows;
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
                this.alignmentStore,
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
                this.alignmentState.colProfileBuffer,
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
        if (!this.metricPipeline) {
            this.metricPipeline = new ColumnMetricCompute(
                this.device,
                this.computeShaderCodes.metrics,
                this.blosum62Buffer
            );
        }
        return this.metricPipeline;
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
        if (!this.alignmentStore) {
            return;
        }

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
            this.alignmentStore,
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
            getTileIndicesForWindow(this.alignmentStore, rowStart, rowCount, colStart, colCount)
        );
        this.renderBindGroup = this.createRenderBindGroup();
        this.alignmentView.setBindGroup(this.renderBindGroup);
        this.state.setGpuResources({
            msaTexture: texture,
            colProfileBuffer: this.alignmentState.colProfileBuffer,
            renderBindGroup: this.renderBindGroup,
        });

        // cleanup
        if (needsNewTexture && previousTexture) {
            previousTexture.destroy();
        }
    }

    createRenderBindGroup() {
        const snapshot = this.state.getSnapshot();
        return this.device.createBindGroup({
            layout: this.renderer.pipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: this.uniformBuffer } },
                { binding: 1, resource: this.visibleWindowState.texture.createView() },
                { binding: 2, resource: { buffer: this.alignmentState.colProfileBuffer } },
                { binding: 3, resource: { buffer: this.themeBuffer } },
                { binding: 4, resource: this.atlasTexture.createView() },
                { binding: 5, resource: this.atlasSampler },
                {
                    binding: 6,
                    resource: {
                        buffer: snapshot.scheme.key === "blosum62" ? this.blosum62Buffer : this.dummyAuxBuffer,
                    }
                },
            ]
        });
    }
    
    frame = () => {
        if (this.alignmentState && this.visibleWindowState) {
            this.alignmentView.ensureCanvasSize();
            this.alignmentView.syncUniforms({
                totalCols: this.alignmentState.totalCols,
                totalRows: this.alignmentState.totalRows,
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
