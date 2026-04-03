import {
    defaultSchemeColor,
    resolveCellSchemeColor,
} from "../../viewer/backends/cpu/schemeColorCpu.js";

const ATLAS_CELL_SIZE = 64;
const ATLAS_WIDTH = 896;
const ATLAS_HEIGHT = 256;
const ATLAS_PX_RANGE = 6;

function median3(a, b, c) {
    return Math.max(Math.min(a, b), Math.min(Math.max(a, b), c));
}

function clamp01(value) {
    return Math.max(0, Math.min(1, value));
}

function lerp(a, b, t) {
    return a + ((b - a) * t);
}

function glyphCell(raw) {
    if (raw === 45) {
        return [0, 0];
    }
    if (raw >= 65 && raw <= 77) {
        return [(raw - 65) + 1, 0];
    }
    if (raw >= 78 && raw <= 90) {
        return [raw - 78, 1];
    }
    if (raw >= 97 && raw <= 111) {
        return [raw - 97, 2];
    }
    if (raw >= 112 && raw <= 122) {
        return [raw - 112, 3];
    }
    return [0, 0];
}

function parseHexColor(hex) {
    const normalized = String(hex ?? "").trim();
    if (!normalized.startsWith("#")) {
        return { r: 255, g: 255, b: 255 };
    }
    if (normalized.length === 4) {
        return {
            r: parseInt(normalized[1] + normalized[1], 16),
            g: parseInt(normalized[2] + normalized[2], 16),
            b: parseInt(normalized[3] + normalized[3], 16),
        };
    }
    return {
        r: parseInt(normalized.slice(1, 3), 16),
        g: parseInt(normalized.slice(3, 5), 16),
        b: parseInt(normalized.slice(5, 7), 16),
    };
}

function contrastTextColor(background) {
    const { r, g, b } = parseHexColor(background);
    const luma = ((0.299 * r) + (0.587 * g) + (0.114 * b)) / 255;
    return luma > 0.55 ? "#0d0d0d" : "#f2f2f2";
}

export class CpuAlignmentSurface {
    constructor({ atlasBitmap = null } = {}) {
        this.renderer = null;
        this.renderResources = null;
        this.renderState = null;
        this.atlasBitmap = atlasBitmap;
        this.glyphRasterCache = new Map();
        this.atlasPixels = null;

        this.canvas = document.createElement("canvas");
        this.canvas.className = "msa-alignment-canvas";
        this.context = this.canvas.getContext("2d", { alpha: false });
    }

    setRenderer(renderer) {
        this.renderer = renderer;
    }

    setRenderResources(renderResources) {
        this.renderResources = renderResources;
    }

    syncSize(width, height, cssWidth, cssHeight) {
        this.canvas.style.width = `${cssWidth}px`;
        this.canvas.style.height = `${cssHeight}px`;
        if (this.canvas.width !== width || this.canvas.height !== height) {
            this.canvas.width = width;
            this.canvas.height = height;
        }
    }

    syncRenderState(renderState) {
        this.renderState = renderState;
    }

    ensureAtlasPixels() {
        if (this.atlasPixels) {
            return this.atlasPixels;
        }
        if (!this.atlasBitmap) {
            return null;
        }
        const sourceCanvas = document.createElement("canvas");
        sourceCanvas.width = this.atlasBitmap.width;
        sourceCanvas.height = this.atlasBitmap.height;
        const sourceContext = sourceCanvas.getContext("2d", { willReadFrequently: true });
        if (!sourceContext) {
            return null;
        }
        sourceContext.clearRect(0, 0, sourceCanvas.width, sourceCanvas.height);
        sourceContext.drawImage(this.atlasBitmap, 0, 0);
        this.atlasPixels = sourceContext.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height).data;
        return this.atlasPixels;
    }

    sampleAtlasDistance(raw, localUvX, localUvY) {
        const atlasPixels = this.ensureAtlasPixels();
        if (!atlasPixels) {
            return -0.5;
        }
        const [cellX, cellY] = glyphCell(raw);
        const atlasX = (cellX * ATLAS_CELL_SIZE) + (localUvX * ATLAS_CELL_SIZE) - 0.5;
        const atlasY = (cellY * ATLAS_CELL_SIZE) + (localUvY * ATLAS_CELL_SIZE) - 0.5;
        const x0 = Math.max(0, Math.min(ATLAS_WIDTH - 1, Math.floor(atlasX)));
        const y0 = Math.max(0, Math.min(ATLAS_HEIGHT - 1, Math.floor(atlasY)));
        const x1 = Math.max(0, Math.min(ATLAS_WIDTH - 1, x0 + 1));
        const y1 = Math.max(0, Math.min(ATLAS_HEIGHT - 1, y0 + 1));
        const tx = clamp01(atlasX - x0);
        const ty = clamp01(atlasY - y0);

        const sampleMedian = (x, y) => {
            const offset = ((y * ATLAS_WIDTH) + x) * 4;
            return median3(
                atlasPixels[offset] / 255,
                atlasPixels[offset + 1] / 255,
                atlasPixels[offset + 2] / 255,
            );
        };

        const top = lerp(sampleMedian(x0, y0), sampleMedian(x1, y0), tx);
        const bottom = lerp(sampleMedian(x0, y1), sampleMedian(x1, y1), tx);
        return lerp(top, bottom, ty) - 0.5;
    }

    getGlyphMaskScale(width, height) {
        const unitRangeX = ATLAS_PX_RANGE / ATLAS_WIDTH;
        const unitRangeY = ATLAS_PX_RANGE / ATLAS_HEIGHT;
        const atlasUvDerivativeX = Math.max((1 / Math.max(1, width)) * (ATLAS_CELL_SIZE / ATLAS_WIDTH), 1e-6);
        const atlasUvDerivativeY = Math.max((1 / Math.max(1, height)) * (ATLAS_CELL_SIZE / ATLAS_HEIGHT), 1e-6);
        const screenTexSizeX = 1 / atlasUvDerivativeX;
        const screenTexSizeY = 1 / atlasUvDerivativeY;
        return Math.max(0.5 * ((unitRangeX * screenTexSizeX) + (unitRangeY * screenTexSizeY)), 1);
    }

    getGlyphRaster(raw, color, width, height) {
        const cacheKey = `${raw}::${color}::${width}::${height}`;
        const cached = this.glyphRasterCache.get(cacheKey);
        if (cached) {
            return cached;
        }
        if (!this.ensureAtlasPixels()) {
            return null;
        }
        const rasterCanvas = document.createElement("canvas");
        rasterCanvas.width = Math.max(1, width);
        rasterCanvas.height = Math.max(1, height);
        const rasterContext = rasterCanvas.getContext("2d");
        if (!rasterContext) {
            return null;
        }
        const imageData = rasterContext.createImageData(rasterCanvas.width, rasterCanvas.height);
        const pixels = imageData.data;
        const { r, g, b } = parseHexColor(color);
        const glyphMaskScale = this.getGlyphMaskScale(rasterCanvas.width, rasterCanvas.height);

        for (let y = 0; y < rasterCanvas.height; y += 1) {
            for (let x = 0; x < rasterCanvas.width; x += 1) {
                const localUvX = (x + 0.5) / rasterCanvas.width;
                const localUvY = (y + 0.5) / rasterCanvas.height;
                const glyphDistance = this.sampleAtlasDistance(raw, localUvX, localUvY);
                const glyphMask = clamp01((glyphDistance * glyphMaskScale) + 0.5);
                const offset = ((y * rasterCanvas.width) + x) * 4;
                pixels[offset] = r;
                pixels[offset + 1] = g;
                pixels[offset + 2] = b;
                pixels[offset + 3] = Math.round(glyphMask * 255);
            }
        }
        rasterContext.putImageData(imageData, 0, 0);
        this.glyphRasterCache.set(cacheKey, rasterCanvas);
        return rasterCanvas;
    }

    render() {
        if (!this.renderResources || this.renderResources.kind !== "cpu" || !this.renderState) return;
        const {
            activeWindow,
            schemeWindow,
            schemeAlphabet,
            schemeKey,
            darkMode,
            schemeProfileData,
        } = this.renderResources;
        if (!activeWindow?.data || !schemeWindow?.data) return;

        const {
            scrollPxX,
            scrollPxY,
            gridPxX,
            gridPxY,
            windowCols,
            windowRows,
        } = this.renderState;

        const context = this.context;
        const canvasWidth = this.canvas.width;
        const canvasHeight = this.canvas.height;
        const baseBackground = defaultSchemeColor(darkMode);
        context.save();
        context.clearRect(0, 0, canvasWidth, canvasHeight);
        context.fillStyle = baseBackground;
        context.fillRect(0, 0, canvasWidth, canvasHeight);
        context.imageSmoothingEnabled = true;

        for (let row = 0; row < windowRows; row += 1) {
            const y = (row * gridPxY) - scrollPxY;
            if (y >= canvasHeight || y + gridPxY <= 0) continue;
            const activeRowOffset = row * activeWindow.rawTextureCols;
            const schemeRowOffset = row * schemeWindow.rawTextureCols;
            for (let column = 0; column < windowCols; column += 1) {
                const x = (column * gridPxX) - scrollPxX;
                if (x >= canvasWidth || x + gridPxX <= 0) continue;
                const mapOffset = column * 2;
                const rawCol = activeWindow.columnMap[mapOffset];
                const rawWindowCol = activeWindow.columnMap[mapOffset + 1];
                const activeRaw = activeWindow.data[activeRowOffset + rawWindowCol];
                const schemeRawWindowCol = schemeWindow.columnMap[mapOffset + 1];
                const schemeRaw = schemeWindow.data[schemeRowOffset + schemeRawWindowCol];
                const background = resolveCellSchemeColor({
                    rawResidue: schemeRaw,
                    rawCol,
                    schemeKey,
                    schemeAlphabet,
                    schemeProfileData,
                    darkMode,
                });
                context.fillStyle = background;
                context.fillRect(x, y, gridPxX, gridPxY);

                if (gridPxX < 6 || gridPxY < 8) continue;
                const glyphRaster = this.getGlyphRaster(activeRaw, contrastTextColor(background), gridPxX, gridPxY);
                if (!glyphRaster) continue;
                context.drawImage(glyphRaster, x, y);
            }
        }
        context.restore();
    }
}
