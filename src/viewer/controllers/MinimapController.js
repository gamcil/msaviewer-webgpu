import { getProjectedChunkColCount, materializeProjectedWindow } from "../projectedWindow.js";
import { projectSelectionRowIntervals } from "../../views/models/alignmentOverlayGeometry.js";

function finalizeMinimapPixels(outPixels, readback, darkMode) {
    const pixelCount = outPixels.length / 4;
    const bg = darkMode ? [20, 20, 23] : [255, 255, 255];
    for (let i = 0; i < pixelCount; i += 1) {
        const srcOffset = i * 4;
        const dstOffset = i * 4;
        const weight = readback[srcOffset + 3];
        if (weight === 0) {
            outPixels[dstOffset + 0] = bg[0];
            outPixels[dstOffset + 1] = bg[1];
            outPixels[dstOffset + 2] = bg[2];
            outPixels[dstOffset + 3] = 255;
            continue;
        }
        outPixels[dstOffset + 0] = Math.round(readback[srcOffset + 0] / weight);
        outPixels[dstOffset + 1] = Math.round(readback[srcOffset + 1] / weight);
        outPixels[dstOffset + 2] = Math.round(readback[srcOffset + 2] / weight);
        outPixels[dstOffset + 3] = 255;
    }
}

function buildSelectionBands({ selection, totalRows, totalCols, columnVisibility = null }) {
    if (!selection?.ranges?.length || totalRows <= 0 || totalCols <= 0) {
        return { rowIntervals: new Map(), totalRows, totalCols };
    }
    return {
        rowIntervals: projectSelectionRowIntervals(
            selection.ranges,
            columnVisibility,
            0,
            totalCols,
            0,
            totalRows
        ),
        totalRows,
        totalCols,
    };
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
        this.chunkResources = [];
    }

    getCacheKey(width, height, { schemeKey, darkMode }) {
        return [
            schemeKey,
            darkMode ? "dark" : "light",
            width,
            height,
        ].join(":");
    }

    getChunkColCount(totalCols, colStart, maxVisibleChunkCols, maxTextureDim, columnVisibility) {
        return getProjectedChunkColCount(totalCols, colStart, maxVisibleChunkCols, maxTextureDim, columnVisibility);
    }

    async materializeVisibleChunk(alignmentStore, rowStart, rowCount, colStart, colCount, columnVisibility) {
        const { data, columnMap, rawTextureCols } = await materializeProjectedWindow({
            alignmentStore,
            rowStart,
            rowCount,
            colStart,
            colCount,
            columnVisibility,
            decodedTileCache: this.decodedTileCache,
        });
        return { chunkData: data, columnMap, rawTextureCols };
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

    getOrCreateChunkResources(slot, { rawTextureCols, rowsInChunk, colsInChunk, paramsByteLength }) {
        const existing = this.chunkResources[slot];
        const needsNewTexture = !existing ||
            existing.textureWidth < rawTextureCols ||
            existing.textureHeight < rowsInChunk;
        const needsNewColumnMapBuffer = !existing ||
            existing.columnMapBufferSize < Math.max(1, colsInChunk * 2) * Uint32Array.BYTES_PER_ELEMENT;
        const needsNewParamsBuffer = !existing || existing.paramsBufferSize < paramsByteLength;

        const next = existing ?? {};
        if (needsNewTexture) {
            next.texture?.destroy?.();
            next.texture = this.device.createTexture({
                size: [Math.max(1, rawTextureCols), Math.max(1, rowsInChunk), 1],
                format: "r8uint",
                usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
            });
            next.textureWidth = rawTextureCols;
            next.textureHeight = rowsInChunk;
        }
        if (needsNewColumnMapBuffer) {
            next.visibleColumnMapBuffer?.destroy?.();
            next.visibleColumnMapBuffer = this.device.createBuffer({
                size: Math.max(1, colsInChunk * 2) * Uint32Array.BYTES_PER_ELEMENT,
                usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
            });
            next.columnMapBufferSize = Math.max(1, colsInChunk * 2) * Uint32Array.BYTES_PER_ELEMENT;
        }
        if (needsNewParamsBuffer) {
            next.paramsBuffer?.destroy?.();
            next.paramsBuffer = this.device.createBuffer({
                size: paramsByteLength,
                usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            });
            next.paramsBufferSize = paramsByteLength;
        }
        this.chunkResources[slot] = next;
        return next;
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
        const maxVisibleChunkCols = Math.min(totalCols, maxTextureDim);
        const chunkRows = Math.min(totalRows, maxTextureDim);

        const minimapPixels = new Uint8ClampedArray(minimapWidth * minimapHeight * 4);

        const minimapPipeline = this.pipelineRegistry.getMinimapPipeline(alphabet);
        const auxBuffer = this.pipelineRegistry.getSchemeAuxBuffer(schemeKey, alphabet);
        const outputBuffer = this.gpuResources.getOrCreateGrowableBuffer("minimapChunkBuffer", {
            minSize: minimapWidth * minimapHeight * 4 * Uint32Array.BYTES_PER_ELEMENT,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
        });
        const zeroBuffer = new Uint32Array(minimapWidth * minimapHeight * 4);
        this.device.queue.writeBuffer(outputBuffer, 0, zeroBuffer);
        const paramsByteLength = Uint32Array.BYTES_PER_ELEMENT * 8;

        for (let rowStart = 0; rowStart < totalRows; rowStart += chunkRows) {
            const rowsInChunk = Math.min(chunkRows, totalRows - rowStart);
            const chunkEntries = [];
            let slot = 0;
            for (let colStart = 0; colStart < totalCols;) {
                const colsInChunk = this.getChunkColCount(
                    totalCols,
                    colStart,
                    maxVisibleChunkCols,
                    maxTextureDim,
                    columnVisibility
                );
                const { chunkData, columnMap, rawTextureCols } = await this.materializeVisibleChunk(
                    alignmentStore,
                    rowStart,
                    rowsInChunk,
                    colStart,
                    colsInChunk,
                    columnVisibility
                );
                const resources = this.getOrCreateChunkResources(slot, {
                    rawTextureCols,
                    rowsInChunk,
                    colsInChunk,
                    paramsByteLength,
                });
                this.device.queue.writeTexture(
                    { texture: resources.texture },
                    chunkData,
                    { offset: 0, bytesPerRow: rawTextureCols, rowsPerImage: rowsInChunk },
                    [rawTextureCols, rowsInChunk, 1]
                );
                this.device.queue.writeBuffer(resources.visibleColumnMapBuffer, 0, columnMap);
                chunkEntries.push({
                    resources,
                    params: {
                    totalRows,
                    totalCols,
                    chunkRowStart: rowStart,
                    chunkColStart: colStart,
                    chunkRows: rowsInChunk,
                    chunkCols: colsInChunk,
                    minimapWidth,
                    minimapHeight,
                    },
                });
                colStart += colsInChunk;
                slot += 1;
            }
            if (chunkEntries.length === 0) continue;
            const encoder = this.device.createCommandEncoder();
            for (const chunk of chunkEntries) {
                minimapPipeline.encode(
                    encoder,
                    chunk.resources.texture.createView(),
                    alignmentState.colProfileBuffer,
                    themeBuffer,
                    chunk.resources.visibleColumnMapBuffer,
                    auxBuffer,
                    outputBuffer,
                    chunk.resources.paramsBuffer,
                    chunk.params
                );
            }
            this.device.queue.submit([encoder.finish()]);
        }

        await this.device.queue.onSubmittedWorkDone();
        const readback = await this.readChunkBuffer(outputBuffer, minimapWidth, minimapHeight);
        finalizeMinimapPixels(minimapPixels, readback, darkMode);
        return minimapPixels;
    }

    async rebuildForRepresentation(representation, {
        alignmentStore = representation?.store ?? null,
        alignmentState,
        alphabet,
        cacheToken = "",
        schemeKey,
        darkMode,
        themeBuffer,
        columnVisibility = null,
        setMinimapCache,
        shouldApply = null,
    }) {
        if (!representation || !alignmentStore || !alignmentState || !this.minimapView || !this.device) return;

        const { width: minimapWidth, height: minimapHeight } = this.minimapView.getViewportPixelSize();
        if (minimapWidth <= 0 || minimapHeight <= 0) return;

        const visibilityKey = columnVisibility
            ? `${columnVisibility.mode}:${columnVisibility.visibleCount}:${columnVisibility.signature}`
            : "raw";
        const cacheKey = `${this.getCacheKey(minimapWidth, minimapHeight, { schemeKey, darkMode })}:${visibilityKey}:${cacheToken}`;
        if (representation.minimapCache?.key === cacheKey) {
            if (shouldApply && !shouldApply()) {
                return;
            }
            const { pixels, width, height } = representation.minimapCache;
            await this.minimapView.setImageData(pixels, width, height);
            return;
        }

        const pixels = await this.computePixels({
            alignmentStore,
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
        const { width: minimapWidth, height: minimapHeight } = this.minimapView.getViewportPixelSize();
        const x = scrollLeft / contentWidth * minimapWidth;
        const y = scrollTop / contentHeight * minimapHeight;
        const width = Math.max(1, viewportWidth / contentWidth * minimapWidth);
        const height = Math.max(1, viewportHeight / contentHeight * minimapHeight);
        this.minimapView.setViewportRect({ x, y, width, height });
    }

    syncSelectionBands({
        selection,
        alignmentStore,
        columnVisibility = null,
    }) {
        if (!this.minimapView) return;
        const totalRows = alignmentStore?.totalRows ?? 0;
        const totalCols = columnVisibility?.visibleCount ?? alignmentStore?.totalCols ?? 0;
        this.minimapView.setSelectionBands(
            buildSelectionBands({
                selection,
                totalRows,
                totalCols,
                columnVisibility,
            })
        );
    }
}
