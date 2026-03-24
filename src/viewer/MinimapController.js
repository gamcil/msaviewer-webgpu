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

    buildVisibleColumnMap(colStart, colCount, columnVisibility) {
        const rawCols = columnVisibility.visibleToRaw.subarray(colStart, colStart + colCount);
        if (rawCols.length === 0) {
            return {
                columnMap: new Uint32Array(0),
                minRawCol: 0,
                rawColCount: 0,
            };
        }

        let minRawCol = rawCols[0];
        let maxRawCol = rawCols[0];
        for (let i = 1; i < rawCols.length; i += 1) {
            const rawCol = rawCols[i];
            if (rawCol < minRawCol) minRawCol = rawCol;
            if (rawCol > maxRawCol) maxRawCol = rawCol;
        }

        const rawColCount = maxRawCol - minRawCol + 1;
        const columnMap = new Uint32Array(rawCols.length * 2);
        for (let i = 0; i < rawCols.length; i += 1) {
            const rawCol = rawCols[i];
            const mapOffset = i * 2;
            columnMap[mapOffset] = rawCol;
            columnMap[mapOffset + 1] = rawCol - minRawCol;
        }

        return {
            columnMap,
            minRawCol,
            rawColCount,
        };
    }

    async materializeVisibleChunk(alignmentStore, rowStart, rowCount, colStart, colCount, columnVisibility) {
        if (!columnVisibility) {
            const chunkData = await materializeWindowFromTiles(
                alignmentStore,
                rowStart,
                rowCount,
                colStart,
                colCount,
                this.decodedTileCache
            );
            const columnMap = new Uint32Array(colCount * 2);
            for (let i = 0; i < colCount; i += 1) {
                const mapOffset = i * 2;
                columnMap[mapOffset] = colStart + i;
                columnMap[mapOffset + 1] = i;
            }
            return { chunkData, columnMap, rawTextureCols: colCount };
        }

        const { columnMap, minRawCol, rawColCount } = this.buildVisibleColumnMap(
            colStart,
            colCount,
            columnVisibility
        );
        if (columnMap.length === 0) {
            return { chunkData: new Uint8Array(0), columnMap, rawTextureCols: 0 };
        }

        const chunkData = await materializeWindowFromTiles(
            alignmentStore,
            rowStart,
            rowCount,
            minRawCol,
            rawColCount,
            this.decodedTileCache
        );

        return { chunkData, columnMap, rawTextureCols: rawColCount };
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
        columnVisibility = null,
    }) {
        const totalRows = alignmentStore.totalRows;
        const totalCols = columnVisibility?.visibleCount ?? alignmentStore.totalCols;
        const maxTextureDim = this.device.limits.maxTextureDimension2D || 8192;
        const chunkCols = Math.min(totalCols, maxTextureDim);
        const chunkRows = Math.min(totalRows, maxTextureDim);

        const minimapSums = new Uint32Array(minimapWidth * minimapHeight * 3);
        const minimapPixels = new Uint8ClampedArray(minimapWidth * minimapHeight * 4);
        const minimapWeights = new Uint32Array(minimapWidth * minimapHeight);

        const minimapPipeline = this.pipelineRegistry.getMinimapPipeline(alphabet);
        const auxBuffer = this.pipelineRegistry.getSchemeAuxBuffer(schemeKey, alphabet);
        const outputBuffer = this.gpuResources.getOrCreateGrowableBuffer("minimapChunkBuffer", {
            minSize: minimapWidth * minimapHeight * 4 * Uint32Array.BYTES_PER_ELEMENT,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
        });
        const zeroBuffer = new Uint32Array(minimapWidth * minimapHeight * 4);
        this.device.queue.writeBuffer(outputBuffer, 0, zeroBuffer);

        for (let rowStart = 0; rowStart < totalRows; rowStart += chunkRows) {
            const rowsInChunk = Math.min(chunkRows, totalRows - rowStart);
            for (let colStart = 0; colStart < totalCols; colStart += chunkCols) {
                const colsInChunk = Math.min(chunkCols, totalCols - colStart);
                const { chunkData, columnMap, rawTextureCols } = await this.materializeVisibleChunk(
                    alignmentStore,
                    rowStart,
                    rowsInChunk,
                    colStart,
                    colsInChunk,
                    columnVisibility
                );
                const chunkTexture = this.gpuResources.getOrCreateGrowableTexture("minimapChunkTexture", {
                    width: rawTextureCols,
                    height: rowsInChunk,
                    format: "r8uint",
                    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
                });
                this.device.queue.writeTexture(
                    { texture: chunkTexture },
                    chunkData,
                    { offset: 0, bytesPerRow: rawTextureCols, rowsPerImage: rowsInChunk },
                    [rawTextureCols, rowsInChunk, 1]
                );
                const visibleColumnMapBuffer = this.gpuResources.getOrCreateGrowableBuffer("minimapVisibleColumnMapBuffer", {
                    minSize: Math.max(1, colsInChunk * 2) * Uint32Array.BYTES_PER_ELEMENT,
                    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
                });
                this.device.queue.writeBuffer(visibleColumnMapBuffer, 0, columnMap);
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
                    visibleColumnMapBuffer,
                    auxBuffer,
                    outputBuffer,
                    params
                );
                this.device.queue.submit([encoder.finish()]);
            }
        }

        await this.device.queue.onSubmittedWorkDone();
        const readback = await this.readChunkBuffer(outputBuffer, minimapWidth, minimapHeight);
        accumulateMinimapChunk(minimapSums, minimapWeights, readback, minimapWidth, minimapHeight);

        finalizeMinimapPixels(minimapPixels, minimapSums, minimapWeights, darkMode);
        return minimapPixels;
    }

    async rebuildForRepresentation(representation, {
        alignmentState,
        alphabet,
        schemeKey,
        darkMode,
        themeBuffer,
        columnVisibility = null,
        setMinimapCache,
        shouldApply = null,
    }) {
        if (!representation || !alignmentState || !this.minimapView || !this.device) return;

        const minimapWidth = this.minimapView.getWidth();
        const minimapHeight = this.minimapView.getHeight();
        if (minimapWidth <= 0 || minimapHeight <= 0) return;

        const visibilityKey = columnVisibility
            ? `${columnVisibility.mode}:${columnVisibility.visibleCount}:${columnVisibility.signature}`
            : "raw";
        const cacheKey = `${this.getCacheKey(minimapWidth, minimapHeight, { schemeKey, darkMode })}:${visibilityKey}`;
        if (representation.minimapCache?.key === cacheKey) {
            if (shouldApply && !shouldApply()) {
                return;
            }
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
            columnVisibility,
        });

        if (shouldApply && !shouldApply()) {
            return;
        }
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
        visibleColCount = null,
    }) {
        if (!alignmentStore || !this.minimapView) return;

        const contentWidth = (visibleColCount ?? alignmentStore.totalCols) * cellWidth;
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
