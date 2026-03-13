/* Handles rendering of the MSA alignment and headers, as well as scroll synchronization between them. */
import { ViewerState } from "./ViewerState.js";
import { HeaderView } from "../views/HeaderView.js";
import { AlignmentView } from "../views/AlignmentView.js";
import { MSARenderer } from "../graphics/pipelines/MSARenderer.js";
import { ColumnProfileCompute } from "../graphics/pipelines/ColumnProfileCompute.js";
import { BLOSUM62 } from "../graphics/data/blosum62.js";
import { SCHEMES } from "../schemes/registry.js";
import { parseFastaAlignment, loadImageBitmap, expandAlignmentForGpu } from "../util.js";
import renderShaderCode from "../graphics/shaders/msa.render.wgsl?raw";
import clustalxComputeShaderCode from "../graphics/shaders/clustalx.compute.wgsl?raw";
import pidComputeShaderCode from "../graphics/shaders/pident.compute.wgsl?raw";
import blosumComputeShaderCode from "../graphics/shaders/blosum.compute.wgsl?raw";

function writeThemeUniformBuffer(device, buffer, darkMode, colorScheme) {
    const data = new Uint32Array([darkMode, colorScheme]);
    device.queue.writeBuffer(buffer, 0, data);
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
        await this.loadStaticAssets();
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

        this.root.appendChild(headerRoot);
        this.root.appendChild(alignmentRoot);

        return { headerRoot, alignmentRoot };
    }

    createViews() {
        const { headerRoot, alignmentRoot } = this.createLayout();
        
        this.renderer = new MSARenderer(this.device, this.format, this.renderShaderCode);

        this.headerView = new HeaderView({
            root: headerRoot,
            rowHeight: this.state.getSnapshot().viewport.cellHeight,
        });
        
        this.alignmentView = new AlignmentView({
            root: alignmentRoot,
            renderer: this.renderer,
            uniformBuffer: this.uniformBuffer,
            device: this.device,
            format: this.format,
            getCellWidth: () => this.state.getSnapshot().viewport.cellWidth,
            getCellHeight: () => this.state.getSnapshot().viewport.cellHeight,
        });
    }
    
    createGpuResources() {
        this.uniformBuffer = this.device.createBuffer({
            size: new Uint32Array(8).byteLength,
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

    async loadStaticAssets() {
        this.computeShaderCodes = {
            clustalx: clustalxComputeShaderCode,
            pid: pidComputeShaderCode,
            blosum62: blosumComputeShaderCode,
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

        // scrolling
        this.onScroll = () => {
            this.alignmentView.syncStage();
            this.state.setViewportScroll(
                this.alignmentView.scroller.scrollLeft,
                this.alignmentView.scroller.scrollTop
            );
        };
        this.alignmentView.scroller.addEventListener("scroll", this.onScroll);

        // window resizing
        this.onResize = () => {
            this.alignmentView.ensureCanvasSize();
            this.state.setCanvasSize(this.alignmentView.canvas.width, this.alignmentView.canvas.height);
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
    }
    
    async loadAlignment({ records, totalCols, totalRows, alignment }) {
        const gpuAlignment = expandAlignmentForGpu(alignment);

        const snapshot = this.state.getSnapshot();
        const scheme = SCHEMES[snapshot.scheme.key];

        const msaBuffer = this.device.createBuffer({
            size: gpuAlignment.byteLength,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });

        const colProfileBuffer = this.device.createBuffer({
            size: totalCols * scheme.profileStride,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });

        this.device.queue.writeBuffer(msaBuffer, 0, gpuAlignment);
        
        // Compute column statistics for current color scheme
        this.alignmentState = { msaBuffer, colProfileBuffer, totalCols, totalRows };
        this.state.setAlignment({ records, totalCols, totalRows }); 

        await this.recomputeColumnProfile();
        
        this.alignmentView.setAlignmentSize(totalCols, totalRows);
        this.alignmentView.scrollTo(0, 0);
        this.alignmentView.syncStage();
        this.alignmentView.syncUniforms({ totalCols, totalRows });

        this.headerView.renderRecords(records);
        this.headerView.syncScroll(this.alignmentView.scroller.scrollTop);

        this.renderBindGroup = this.createRenderBindGroup();
        this.alignmentView.setBindGroup(this.renderBindGroup);
        this.state.setGpuResources({
            msaBuffer,
            colProfileBuffer,
            renderBindGroup: this.renderBindGroup,
        });
    }
    
    async loadFastaAlignment(text) {
        // convenience function for loading directly from loaded FASTA format file
        const parsed = parseFastaAlignment(text);
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
        if (snapshot.scheme.key === schemeKey) return;

        this.state.setScheme(schemeKey);
        this.syncThemeBuffer();

        if (SCHEMES[schemeKey].type === "columnStatistic") {
            await this.recomputeColumnProfile();
        }

        if (this.alignmentState) {
            this.renderBindGroup = this.createRenderBindGroup();
            this.alignmentView.setBindGroup(this.renderBindGroup);

            this.state.setGpuResources({
                msaBuffer: this.alignmentState.msaBuffer,
                colProfileBuffer: this.alignmentState.colProfileBuffer,
                renderBindGroup: this.renderBindGroup,
            });
        }
    }
    
    setTheme({ mode, darkMode }) {
        if (mode != null) this.state.setThemeMode(mode);
        if (darkMode != null) this.state.setResolvedDarkMode(darkMode);
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
        const computePipeline = this.getComputePipeline(snapshot.scheme.key);
        computePipeline.run(
            this.alignmentState.msaBuffer,
            this.alignmentState.colProfileBuffer,
            this.alignmentState.totalCols,
            this.alignmentState.totalRows
        );
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

    createRenderBindGroup() {
        const snapshot = this.state.getSnapshot();
        return this.device.createBindGroup({
            layout: this.renderer.pipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: this.uniformBuffer } },
                { binding: 1, resource: { buffer: this.alignmentState.msaBuffer } },
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
        if (this.alignmentState) {
            this.alignmentView.ensureCanvasSize();
            this.alignmentView.syncStage();
            this.alignmentView.syncUniforms({ totalCols: this.alignmentState.totalCols, totalRows: this.alignmentState.totalRows });
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
