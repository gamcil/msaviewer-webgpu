import { WebGPUAlignmentSurface } from "../../views/renderers/WebGPUAlignmentSurface.js";
import { CpuAlignmentSurface } from "../../views/renderers/CpuAlignmentSurface.js";
import { RepresentationStore } from "../state/RepresentationStore.js";
import { ColumnMetricService } from "../ColumnMetricService.js";
import { ColumnProfileService } from "../ColumnProfileService.js";
import { VisibleWindowController } from "../controllers/VisibleWindowController.js";
import { MinimapController } from "../controllers/MinimapController.js";
import { GpuResourceManager } from "../../graphics/GpuResourceManager.js";
import { PipelineRegistry } from "../../graphics/PipelineRegistry.js";

export function normalizeRenderingBackend(value) {
    return value === "auto" || value === "webgpu" || value === "cpu"
        ? value
        : "auto";
}

export function resolveRenderingBackendKind(requestedBackend, { hasWebGPU }) {
    const backend = normalizeRenderingBackend(requestedBackend);
    if (backend === "auto") {
        return hasWebGPU ? "webgpu" : "cpu";
    }
    return backend;
}

export function createAlignmentSurface({
    backend,
    device,
    format,
    uniformBuffer,
    renderer,
    atlasBitmap = null,
}) {
    if (backend === "webgpu") {
        return new WebGPUAlignmentSurface({
            device,
            format,
            uniformBuffer,
            renderer,
        });
    }
    if (backend === "cpu") {
        return new CpuAlignmentSurface({ atlasBitmap });
    }
    throw new Error(`Unknown alignment surface backend '${backend}'.`);
}

function createAlignmentBindGroup({
    device,
    renderer,
    gpuResources,
    pipelineRegistry,
    windowState,
    schemeWindowState,
    activeAlignmentState,
    schemeAlignmentState,
    schemeAlphabet,
    schemeKey,
}) {
    return device.createBindGroup({
        layout: renderer.pipeline.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: gpuResources.getSingleton("uniformBuffer") } },
            { binding: 1, resource: windowState.texture.createView() },
            { binding: 2, resource: schemeWindowState.texture.createView() },
            { binding: 3, resource: { buffer: (schemeAlignmentState ?? activeAlignmentState).colProfileBuffer } },
            { binding: 4, resource: { buffer: gpuResources.getSingleton("themeBuffer") } },
            { binding: 5, resource: gpuResources.getSingleton("atlasTexture").createView() },
            { binding: 6, resource: gpuResources.getSingleton("atlasSampler") },
            { binding: 7, resource: { buffer: windowState.visibleColumnMapBuffer } },
            {
                binding: 8,
                resource: {
                    buffer: pipelineRegistry.getSchemeAuxBuffer(schemeKey, schemeAlphabet),
                },
            },
        ],
    });
}

export function createAlignmentRenderResources({
    backend,
    device,
    renderer,
    gpuResources,
    pipelineRegistry,
    windowState,
    schemeWindowState = windowState,
    sources,
    schemeKey,
    darkMode,
}) {
    const {
        activeAlphabet,
        activeRepresentation,
        schemeAlphabet,
        schemeRepresentation,
        activeAlignmentState,
        schemeAlignmentState,
    } = sources;
    if (!windowState || !schemeWindowState || !activeRepresentation || !schemeRepresentation) {
        return null;
    }
    if (backend === "cpu") {
        return {
            kind: "cpu",
            activeWindow: windowState,
            schemeWindow: schemeWindowState,
            activeAlphabet,
            schemeAlphabet,
            schemeKey,
            darkMode,
            schemeColumnMetrics: schemeRepresentation.columnMetrics,
            schemeProfileData: schemeAlignmentState?.colProfileData ?? null,
            activeAlignmentState,
            schemeAlignmentState,
        };
    }
    return {
        kind: "webgpu",
        bindGroup: createAlignmentBindGroup({
            device,
            renderer,
            gpuResources,
            pipelineRegistry,
            windowState,
            schemeWindowState,
            activeAlignmentState,
            schemeAlignmentState,
            schemeAlphabet,
            schemeKey,
        }),
    };
}

function createBackendServices({
    backend,
    device,
    gpuResources,
    pipelineRegistry,
    decodedTileCache,
    alphabetRegistry,
    getProfileStride,
    getMetricUniformBuffer,
}) {
    return {
        representationStore: new RepresentationStore({
            device,
            alphabetRegistry,
            getProfileStride,
        }),
        columnMetricService: new ColumnMetricService({
            backend,
            device,
            gpuResources,
            pipelineRegistry,
            decodedTileCache,
            getMetricUniformBuffer,
        }),
        columnProfileService: new ColumnProfileService({
            backend,
            device,
            gpuResources,
            pipelineRegistry,
            decodedTileCache,
        }),
        windowController: new VisibleWindowController({
            backend,
            device,
            gpuResources,
            decodedTileCache,
        }),
        schemeWindowController: new VisibleWindowController({
            backend,
            device,
            gpuResources,
            decodedTileCache,
        }),
    };
}

function createGpuRuntime({
    device,
    format,
    atlasBitmap,
    computeShaderCodes,
}) {
    const gpuResources = new GpuResourceManager(device);
    gpuResources.createSingletonBuffer("uniformBuffer", {
        size: new Uint32Array(12).byteLength,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    gpuResources.createSingletonBuffer("themeBuffer", {
        size: new Uint32Array(2).byteLength,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    gpuResources.createSingletonBuffer("dummyStorageBuffer", {
        size: Int32Array.BYTES_PER_ELEMENT,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        data: new Int32Array([0]),
    });
    gpuResources.createSingletonBuffer("metricUniformBuffer", {
        size: Uint32Array.BYTES_PER_ELEMENT * 8,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const atlasTexture = gpuResources.setSingleton("atlasTexture", device.createTexture({
        size: [atlasBitmap.width, atlasBitmap.height, 1],
        format: "rgba8unorm",
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    }));
    device.queue.copyExternalImageToTexture(
        { source: atlasBitmap },
        { texture: atlasTexture },
        [atlasBitmap.width, atlasBitmap.height]
    );
    gpuResources.setSingleton("atlasSampler", device.createSampler({
        magFilter: "linear",
        minFilter: "linear",
    }));

    return {
        gpuResources,
        pipelineRegistry: new PipelineRegistry({
            device,
            format,
            gpuResources,
            computeShaderCodes,
            getDummyStorageBuffer: () => gpuResources.getSingleton("dummyStorageBuffer") ?? null,
        }),
    };
}

export function createBackendRuntime({
    backend,
    device,
    format,
    atlasBitmap,
    computeShaderCodes = {},
    decodedTileCache,
    alphabetRegistry,
    getProfileStride,
}) {
    const { gpuResources, pipelineRegistry } = backend === "webgpu"
        ? createGpuRuntime({ device, format, atlasBitmap, computeShaderCodes })
        : { gpuResources: null, pipelineRegistry: null };

    return {
        gpuResources,
        pipelineRegistry,
        ...createBackendServices({
            backend,
            device: backend === "webgpu" ? device : null,
            gpuResources,
            pipelineRegistry,
            decodedTileCache,
            alphabetRegistry,
            getProfileStride,
            getMetricUniformBuffer: () => gpuResources?.getSingleton("metricUniformBuffer") ?? null,
        }),
    };
}

export function createBackendMinimapController({
    backend,
    device,
    gpuResources,
    pipelineRegistry,
    minimapView,
    decodedTileCache,
}) {
    if (!minimapView) {
        return null;
    }
    return new MinimapController({
        backend,
        device,
        gpuResources,
        pipelineRegistry,
        minimapView,
        decodedTileCache,
    });
}
