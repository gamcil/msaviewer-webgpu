import { MSARenderer } from "./pipelines/MSARenderer.js";
import { MinimapCompute } from "./pipelines/MinimapCompute.js";
import { ColumnMetricCompute } from "./pipelines/ColumnMetricCompute.js";
import { buildMetricShaderCode } from "./shaders/buildMetricShader.js";
import { buildMSARenderShaderCode } from "./shaders/buildMSARenderShader.js";
import { buildMinimapShaderCode } from "./shaders/buildMinimapShader.js";

export class PipelineRegistry {
    constructor({
        device,
        format,
        gpuResources,
        getDummyStorageBuffer,
    }) {
        this.device = device;
        this.format = format;
        this.gpuResources = gpuResources;
        this.getDummyStorageBuffer = getDummyStorageBuffer;
    }

    getRenderer(alphabet) {
        return this.gpuResources.getOrCreateKeyed("renderers", alphabet.id, () =>
            new MSARenderer(this.device, this.format, buildMSARenderShaderCode(alphabet))
        );
    }

    getMinimapPipeline(alphabet) {
        return this.gpuResources.getOrCreateKeyed("minimapPipelines", alphabet.id, () =>
            new MinimapCompute(this.device, buildMinimapShaderCode(alphabet))
        );
    }

    getColumnMetricPipeline(alphabet) {
        return this.gpuResources.getOrCreateKeyed("metricPipelines", alphabet.id, () =>
            new ColumnMetricCompute(
                this.device,
                buildMetricShaderCode(alphabet),
                this.getQualityMatrixBuffer(alphabet)
            )
        );
    }

    getQualityMatrixBuffer(alphabet) {
        if (!alphabet.supports?.quality || !alphabet.qualityMatrix) {
            return this.getDummyStorageBuffer();
        }
        return this.gpuResources.getOrCreateKeyed("qualityMatrices", alphabet.id, () => {
            const buffer = this.device.createBuffer({
                size: alphabet.qualityMatrix.byteLength,
                usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
            });
            this.device.queue.writeBuffer(buffer, 0, alphabet.qualityMatrix);
            return buffer;
        });
    }

    getSchemeAuxBuffer(schemeKey, alphabet) {
        if (schemeKey === "similarity" && alphabet.supports?.quality) {
            return this.getQualityMatrixBuffer(alphabet);
        }
        return this.getDummyStorageBuffer();
    }
}
