let logoMeasureCanvas = null;
let logoMeasureContext = undefined;
const LOGO_GLYPH_METRIC_CACHE = new Map();
const LOGO_GLYPH_ALPHA_CACHE = new Map();
const LOGO_GLYPH_RASTER_CACHE = new Map();
let colorParseCanvas = null;
let colorParseContext = undefined;
const COLOR_PARSE_CACHE = new Map();

function clamp01(value) {
    return Math.max(0, Math.min(1, value));
}

function createCanvas(width, height) {
    if (typeof document === "undefined") {
        return null;
    }
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas;
}

function getLogoMeasureResources() {
    if (logoMeasureContext !== undefined) {
        return logoMeasureContext ? { canvas: logoMeasureCanvas, context: logoMeasureContext } : null;
    }
    logoMeasureCanvas = createCanvas(256, 256);
    logoMeasureContext = logoMeasureCanvas?.getContext("2d", { willReadFrequently: true }) ?? null;
    return logoMeasureContext ? { canvas: logoMeasureCanvas, context: logoMeasureContext } : null;
}

function getColorParseContext() {
    if (colorParseContext !== undefined) {
        return colorParseContext;
    }
    colorParseCanvas = createCanvas(1, 1);
    colorParseContext = colorParseCanvas?.getContext("2d", { willReadFrequently: true }) ?? null;
    return colorParseContext;
}

function parseCssColor(color) {
    if (COLOR_PARSE_CACHE.has(color)) {
        return COLOR_PARSE_CACHE.get(color);
    }
    const ctx = getColorParseContext();
    if (!ctx) {
        const fallback = [0, 0, 0, 255];
        COLOR_PARSE_CACHE.set(color, fallback);
        return fallback;
    }
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = "#000";
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 1, 1);
    const parsed = Array.from(ctx.getImageData(0, 0, 1, 1).data);
    COLOR_PARSE_CACHE.set(color, parsed);
    return parsed;
}

function formatRgbaColor([r, g, b, a]) {
    const alpha = Math.round((a / 255) * 1000) / 1000;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function createColorRamp(overrides = {}) {
    return {
        minScore: 0,
        maxScore: 1,
        minColor: null,
        maxColor: null,
        target: "fill",
        ...overrides,
    };
}

export function prepareColorRamp(ramp) {
    if (!ramp) {
        return null;
    }
    if (ramp.minColor == null || ramp.maxColor == null) {
        return {
            ...ramp,
            parsedMinColor: null,
            parsedMaxColor: null,
        };
    }
    return {
        ...ramp,
        parsedMinColor: parseCssColor(ramp.minColor),
        parsedMaxColor: parseCssColor(ramp.maxColor),
    };
}

export function interpolateColor(minColor, maxColor, t) {
    const start = Array.isArray(minColor) ? minColor : parseCssColor(minColor);
    const end = Array.isArray(maxColor) ? maxColor : parseCssColor(maxColor);
    const mix = clamp01(t);
    const r = Math.round(start[0] + (end[0] - start[0]) * mix);
    const g = Math.round(start[1] + (end[1] - start[1]) * mix);
    const b = Math.round(start[2] + (end[2] - start[2]) * mix);
    const a = Math.round(start[3] + (end[3] - start[3]) * mix);
    return formatRgbaColor([r, g, b, a]);
}

export function resolveInterpolatedColor(score, {
    minScore = 0,
    maxScore = 1,
    minColor,
    maxColor,
    parsedMinColor = null,
    parsedMaxColor = null,
} = {}) {
    if (minColor == null || maxColor == null) {
        return null;
    }
    if (maxScore <= minScore) {
        return maxColor;
    }
    const t = (score - minScore) / (maxScore - minScore);
    return interpolateColor(parsedMinColor ?? minColor, parsedMaxColor ?? maxColor, t);
}

function getLogoGlyphMetrics(font, glyph) {
    const cacheKey = `${font}::${glyph}`;
    const cached = LOGO_GLYPH_METRIC_CACHE.get(cacheKey);
    if (cached) {
        return cached;
    }

    const resources = getLogoMeasureResources();
    if (!resources) {
        return {
            left: 0,
            top: 0,
            right: 63,
            bottom: 99,
            width: 64,
            height: 100,
            ascent: 80,
        };
    }

    const { canvas, context: ctx } = resources;
    const width = canvas.width;
    const height = canvas.height;
    const baselineY = 200;
    const drawX = width / 2;

    ctx.clearRect(0, 0, width, height);
    ctx.font = font;
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = "#000";
    ctx.fillText(glyph, drawX, baselineY);

    const imageData = ctx.getImageData(0, 0, width, height);
    const pixels = imageData.data;
    let top = height;
    let bottom = -1;
    let left = width;
    let right = -1;

    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
            const alpha = pixels[(y * width + x) * 4 + 3];
            if (alpha === 0) continue;
            top = Math.min(top, y);
            bottom = Math.max(bottom, y);
            left = Math.min(left, x);
            right = Math.max(right, x);
        }
    }

    const metrics = ctx.measureText(glyph);
    const fallbackAscent = metrics.actualBoundingBoxAscent || 80;
    const fallbackDescent = metrics.actualBoundingBoxDescent || 20;
    const result = bottom >= top
        ? {
            left,
            top,
            right,
            bottom,
            width: Math.max(1, right - left + 1),
            height: Math.max(1, bottom - top + 1),
            ascent: Math.max(1, baselineY - top),
        }
        : {
            left: Math.max(0, Math.floor(drawX - (metrics.width / 2))),
            top: Math.max(0, Math.floor(baselineY - fallbackAscent)),
            right: Math.min(width - 1, Math.ceil(drawX + (metrics.width / 2))),
            bottom: Math.min(height - 1, Math.ceil(baselineY + fallbackDescent)),
            width: Math.max(1, metrics.width),
            height: Math.max(1, fallbackAscent + fallbackDescent),
            ascent: Math.max(1, fallbackAscent),
        };

    LOGO_GLYPH_METRIC_CACHE.set(cacheKey, result);
    return result;
}

function getLogoGlyphAlpha(font, glyph) {
    const cacheKey = `${font}::${glyph}`;
    const cached = LOGO_GLYPH_ALPHA_CACHE.get(cacheKey);
    if (cached) {
        return cached;
    }

    const resources = getLogoMeasureResources();
    if (!resources) {
        return null;
    }
    const metrics = getLogoGlyphMetrics(font, glyph);
    const alphaCanvas = createCanvas(
        Math.max(1, Math.ceil(metrics.width)),
        Math.max(1, Math.ceil(metrics.height))
    );
    if (!alphaCanvas) {
        return null;
    }
    const alphaContext = alphaCanvas.getContext("2d");
    if (!alphaContext) {
        return null;
    }
    alphaContext.clearRect(0, 0, alphaCanvas.width, alphaCanvas.height);
    alphaContext.drawImage(
        resources.canvas,
        metrics.left,
        metrics.top,
        metrics.width,
        metrics.height,
        0,
        0,
        alphaCanvas.width,
        alphaCanvas.height
    );
    LOGO_GLYPH_ALPHA_CACHE.set(cacheKey, alphaCanvas);
    return alphaCanvas;
}

function getLogoGlyphRaster(font, glyph, color = "#333") {
    const cacheKey = `${font}::${glyph}::${color}`;
    const cached = LOGO_GLYPH_RASTER_CACHE.get(cacheKey);
    if (cached) {
        return cached;
    }

    const alphaCanvas = getLogoGlyphAlpha(font, glyph);
    if (!alphaCanvas) {
        return null;
    }

    const rasterCanvas = createCanvas(alphaCanvas.width, alphaCanvas.height);
    if (!rasterCanvas) {
        return null;
    }
    const rasterContext = rasterCanvas.getContext("2d");
    if (!rasterContext) {
        return null;
    }
    rasterContext.clearRect(0, 0, rasterCanvas.width, rasterCanvas.height);
    rasterContext.drawImage(alphaCanvas, 0, 0);
    rasterContext.globalCompositeOperation = "source-in";
    rasterContext.fillStyle = color;
    rasterContext.fillRect(0, 0, rasterCanvas.width, rasterCanvas.height);
    rasterContext.globalCompositeOperation = "source-over";
    LOGO_GLYPH_RASTER_CACHE.set(cacheKey, rasterCanvas);
    return rasterCanvas;
}

export function warmSequenceLogoGlyphCache(font, glyphColorPairs = []) {
    for (const { glyph, color } of glyphColorPairs) {
        if (!glyph) continue;
        getLogoGlyphRaster(font, glyph, color ?? "#333");
    }
}

export function renderBars(context, {
    bars,
    cellWidthPx,
    localScrollLeftPx,
    canvasHeight,
    fillStyle = "rgba(89, 211, 255, 0.25)",
    strokeStyle = null,
    lineWidth = 1,
}) {
    if (!bars?.length) return;

    const hasPerBarStyles = bars.some((bar) =>
        bar.fillStyle !== undefined ||
        bar.strokeStyle !== undefined ||
        bar.lineWidth !== undefined
    );

    if (hasPerBarStyles) {
        for (const { column, fraction, baseY = canvasHeight, plotHeight = canvasHeight, fillStyle: barFillStyle, strokeStyle: barStrokeStyle, lineWidth: barLineWidth } of bars) {
            const x = column * cellWidthPx - localScrollLeftPx;
            const barHeight = plotHeight * fraction;
            if (barFillStyle) {
                context.fillStyle = barFillStyle;
                context.fillRect(x, baseY - barHeight, cellWidthPx, barHeight);
            }
            if (barStrokeStyle) {
                context.strokeStyle = barStrokeStyle;
                context.lineWidth = barLineWidth ?? lineWidth;
                context.strokeRect(x, baseY - barHeight, cellWidthPx, barHeight);
            }
        }
        return;
    }

    if (fillStyle) {
        context.fillStyle = fillStyle;
    }
    if (strokeStyle) {
        context.strokeStyle = strokeStyle;
        context.lineWidth = lineWidth;
    }

    context.beginPath();
    for (const { column, fraction, baseY = canvasHeight, plotHeight = canvasHeight } of bars) {
        const x = column * cellWidthPx - localScrollLeftPx;
        const barHeight = plotHeight * fraction;
        context.rect(x, baseY - barHeight, cellWidthPx, barHeight);
    }
    if (fillStyle) {
        context.fill();
    }
    if (strokeStyle) {
        context.stroke();
    }
}

export function renderLine(context, {
    points,
    canvasHeight,
    strokeStyle = "rgb(0, 122, 178)",
    fillStyle = null,
    lineWidth = 1,
    showPoints = false,
    pointRadius = 5,
    skipZeroPoints = true,
}) {
    if (!points?.length) return;

    context.strokeStyle = strokeStyle;
    context.lineWidth = lineWidth;
    if (fillStyle) {
        context.fillStyle = fillStyle;
        context.beginPath();
        context.moveTo(points[0].x, canvasHeight);
        for (const { x, y } of points) {
            context.lineTo(x, y);
        }
        context.lineTo(points[points.length - 1].x, canvasHeight);
        context.closePath();
        context.fill();
    }

    context.beginPath();
    context.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i += 1) {
        context.lineTo(points[i].x, points[i].y);
    }
    context.stroke();

    if (!showPoints) return;

    for (const { score, x, y, pointFillStyle, pointStrokeStyle, pointLineWidth } of points) {
        if (skipZeroPoints && score === 0) continue;
        context.beginPath();
        context.arc(x, y, pointRadius, 0, Math.PI * 2, false);
        if (pointFillStyle ?? fillStyle) {
            context.fillStyle = pointFillStyle ?? fillStyle;
            context.fill();
        }
        context.strokeStyle = pointStrokeStyle ?? strokeStyle;
        context.lineWidth = pointLineWidth ?? lineWidth;
        context.stroke();
    }
}

export function renderGlyphs(context, {
    glyphs,
    cellWidthPx,
    localScrollLeftPx,
    canvasHeight,
    font,
    fillStyle = "#333",
    textAlign = "center",
    textBaseline = "bottom",
}) {
    if (!glyphs?.length) return;

    context.font = font;
    context.textAlign = textAlign;
    context.textBaseline = textBaseline;

    for (const { column, glyph, color = fillStyle, y = canvasHeight } of glyphs) {
        const x = column * cellWidthPx + cellWidthPx / 2 - localScrollLeftPx;
        context.fillStyle = color;
        context.fillText(glyph, x, y);
    }
}

export function renderSequenceLogo(context, {
    columns,
    cellWidthPx,
    localScrollLeftPx,
    plotHeightPx,
    font = `bold 100px "IBM Plex Mono", monospace`,
    maxScaleX = 1.25,
    capGlyphHeight = true,
    maxGlyphHeightRatio = 0.9,
    minGlyphPixelHeight = 1,
}) {
    if (!columns?.length) return;

    for (const { column, stackHeightPx, letters } of columns) {
        const columnX = column * cellWidthPx - localScrollLeftPx;
        const xCenter = columnX + cellWidthPx / 2;
        const stackTopPx = plotHeightPx - stackHeightPx;
        let stackedOffsetPx = 0;
        const maxGlyphHeightPx = Math.min(plotHeightPx * maxGlyphHeightRatio, cellWidthPx * 2.5);

        const effectiveMinGlyphPixelHeight = Math.max(2, minGlyphPixelHeight);
        const renderableLetters = letters
            .filter(({ heightPx }) => heightPx >= effectiveMinGlyphPixelHeight)
            .map((letter) => {
                const renderedHeightPx = capGlyphHeight
                    ? Math.min(letter.heightPx, maxGlyphHeightPx)
                    : letter.heightPx;
                return {
                    ...letter,
                    renderedHeightPx,
                };
            });

        const totalRenderedHeightPx = renderableLetters.reduce(
            (sum, letter) => sum + letter.renderedHeightPx,
            0
        );
        const availableGapPx = Math.max(0, stackHeightPx - totalRenderedHeightPx);
        const interLetterGapPx = renderableLetters.length > 1
            ? availableGapPx / (renderableLetters.length - 1)
            : 0;

        for (const { glyph, color, renderedHeightPx } of renderableLetters) {
            const finalHeightPx = renderedHeightPx;

            const glyphMetrics = getLogoGlyphMetrics(font, glyph);
            const glyphRaster = getLogoGlyphRaster(font, glyph, color ?? "#333");
            if (!glyphRaster) {
                stackedOffsetPx += finalHeightPx + interLetterGapPx;
                continue;
            }
            const scaleX = Math.min(cellWidthPx / glyphMetrics.width, maxScaleX);
            const scaledGlyphWidthPx = glyphMetrics.width * scaleX;
            const glyphTopPx = stackTopPx + stackedOffsetPx;
            const glyphBottomPx = glyphTopPx + finalHeightPx;
            const glyphLeftPx = xCenter - (scaledGlyphWidthPx / 2);
            const needsClip =
                scaledGlyphWidthPx > cellWidthPx ||
                glyphLeftPx < columnX ||
                glyphLeftPx + scaledGlyphWidthPx > columnX + cellWidthPx ||
                glyphTopPx < 0 ||
                glyphBottomPx > plotHeightPx;

            if (needsClip) {
                context.save();
                context.beginPath();
                context.rect(columnX, 0, cellWidthPx, plotHeightPx);
                context.clip();
            }
            context.drawImage(
                glyphRaster,
                glyphLeftPx,
                glyphTopPx,
                scaledGlyphWidthPx,
                finalHeightPx
            );
            if (needsClip) {
                context.restore();
            }

            stackedOffsetPx += finalHeightPx + interLetterGapPx;
        }
    }
}
