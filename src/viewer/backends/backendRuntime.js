import { WebGPUAlignmentSurface } from "../../views/renderers/WebGPUAlignmentSurface.js";
import { CpuAlignmentSurface } from "../../views/renderers/CpuAlignmentSurface.js";
import { RepresentationStore } from "../state/RepresentationStore.js";
import { ColumnMetricService } from "../ColumnMetricService.js";
import { ColumnProfileService } from "../ColumnProfileService.js";
import { VisibleWindowController } from "../controllers/VisibleWindowController.js";
import { MinimapController } from "../controllers/MinimapController.js";

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

export function createBackendServices({
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
        visibleWindowController: new VisibleWindowController({
            backend,
            device,
            gpuResources,
            decodedTileCache,
        }),
        schemeVisibleWindowController: new VisibleWindowController({
            backend,
            device,
            gpuResources,
            decodedTileCache,
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
