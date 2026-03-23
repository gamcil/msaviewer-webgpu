import { materializeWindowFromTiles } from "../alignment/tiledStorage.js";

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

export class MinimapController {
    constructor({
        device,
        gpuResources,
        pipelineRegistry,
        minimapView,
        decodedTileCache,
    }) {
        this.device = device;
        this.gpuResources = gpuResources;
        this.pipelineRegistry = pipelineRegistry;
        this.minimapView = minimapView;
        this.decodedTileCache = decodedTileCache;
    }

    getCacheKey(width, height, { schemeKey, darkMode }) {
        return [
            schemeKey,
            darkMode ? "dark" : "light",
            width,
            height,
        ].join(":");
    }

    async readChunkBuffer(outputBuffer, minimapWidth, minimapHeight) {
        const byteLength = minimapWidth * minimapHeight * 4 * Uint32Array.BYTES_PER_ELEMENT;
        const readbackBuffer = this.gpuResources.getOrCreateGrowableBuffer("minimapReadbackBuffer", {
            minSize: byteLength,
            usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
        });
        const encoder = this.device.createCommandEncoder();
        encoder.copyBufferToBuffer(outputBuffer, 0, readbackBuffer, 0, byteLength);
        this.device.queue.submit([encoder.finish()]);
        await readbackBuffer.mapAsync(GPUMapMode.READ);
        const copy = new Uint32Array(readbackBuffer.getMappedRange()).slice();
        readbackBuffer.unmap();
        return copy;
    }

    async computePixels({
        alignmentStore,
        alignmentState,
        alphabet,
        schemeKey,
        darkMode,
        minimapWidth,
        minimapHeight,
        themeBuffer,
    }) {
        const totalRows = alignmentStore.totalRows;
        const totalCols = alignmentStore.totalCols;
        const maxTextureDim = this.device.limits.maxTextureDimension2D || 8192;
        const chunkCols = Math.min(totalCols, maxTextureDim);
        const chunkRows = Math.min(totalRows, maxTextureDim);

        const minimapSums = new Uint32Array(minimapWidth * minimapHeight * 3);
        const minimapPixels = new Uint8ClampedArray(minimapWidth * minimapHeight * 4);
        const minimapWeights = new Uint32Array(minimapWidth * minimapHeight);

        const minimapPipeline = this.pipelineRegistry.getMinimapPipeline(alphabet);
        const auxBuffer = this.pipelineRegistry.getSchemeAuxBuffer(schemeKey, alphabet);

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
                const chunkTexture = this.gpuResources.getOrCreateGrowableTexture("minimapChunkTexture", {
                    width: colsInChunk,
                    height: rowsInChunk,
                    format: "r8uint",
                    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
                });
                this.device.queue.writeTexture(
                    { texture: chunkTexture },
                    chunkData,
                    { offset: 0, bytesPerRow: colsInChunk, rowsPerImage: rowsInChunk },
                    [colsInChunk, rowsInChunk, 1]
                );
                const outputBuffer = this.gpuResources.getOrCreateGrowableBuffer("minimapChunkBuffer", {
                    minSize: minimapWidth * minimapHeight * 4 * 4,
                    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
                });
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
                    themeBuffer,
                    auxBuffer,
                    outputBuffer,
                    params
                );
                this.device.queue.submit([encoder.finish()]);
                const readback = await this.readChunkBuffer(outputBuffer, minimapWidth, minimapHeight);
                accumulateMinimapChunk(minimapSums, minimapWeights, readback, minimapWidth, minimapHeight);
            }
            await this.device.queue.onSubmittedWorkDone();
        }

        finalizeMinimapPixels(minimapPixels, minimapSums, minimapWeights, darkMode);
        return minimapPixels;
    }

    async rebuildForRepresentation(representation, {
        alignmentState,
        alphabet,
        schemeKey,
        darkMode,
        themeBuffer,
        setMinimapCache,
    }) {
        if (!representation || !alignmentState || !this.minimapView || !this.device) return;

        const minimapWidth = this.minimapView.getWidth();
        const minimapHeight = this.minimapView.getHeight();
        if (minimapWidth <= 0 || minimapHeight <= 0) return;

        const cacheKey = this.getCacheKey(minimapWidth, minimapHeight, { schemeKey, darkMode });
        if (representation.minimapCache?.key === cacheKey) {
            const { pixels, width, height } = representation.minimapCache;
            await this.minimapView.setImageData(pixels, width, height);
            return;
        }

        const pixels = await this.computePixels({
            alignmentStore: representation.store,
            alignmentState,
            alphabet,
            schemeKey,
            darkMode,
            minimapWidth,
            minimapHeight,
            themeBuffer,
        });

        setMinimapCache?.(representation.id, {
            key: cacheKey,
            width: minimapWidth,
            height: minimapHeight,
            pixels: pixels.slice(),
        });
        await this.minimapView.setImageData(pixels, minimapWidth, minimapHeight);
    }

    syncViewportRect({
        alignmentStore,
        scrollLeft,
        scrollTop,
        viewportWidth,
        viewportHeight,
        cellWidth,
        cellHeight,
    }) {
        if (!alignmentStore || !this.minimapView) return;

        const contentWidth = alignmentStore.totalCols * cellWidth;
        const contentHeight = alignmentStore.totalRows * cellHeight;
        const minimapWidth = this.minimapView.getWidth();
        const minimapHeight = this.minimapView.getHeight();
        const x = scrollLeft / contentWidth * minimapWidth;
        const y = scrollTop / contentHeight * minimapHeight;
        const width = Math.max(1, viewportWidth / contentWidth * minimapWidth);
        const height = Math.max(1, viewportHeight / contentHeight * minimapHeight);
        this.minimapView.setViewportRect({ x, y, width, height });
    }
}
