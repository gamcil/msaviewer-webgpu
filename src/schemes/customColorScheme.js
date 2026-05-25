import { normalizeColor, sampleColormap } from "./colormaps.js";

function clampByte(value) {
    if (!Number.isFinite(value)) return 0;
    return Math.min(255, Math.max(0, Math.round(value)));
}

export function packRgbaColor(color) {
    const rgba = normalizeColor(color);
    if (!rgba) return 0;
    return (
        (rgba[0] & 0xFF) |
        ((rgba[1] & 0xFF) << 8) |
        ((rgba[2] & 0xFF) << 16) |
        ((rgba[3] & 0xFF) << 24)
    ) >>> 0;
}

export function unpackRgbaColor(packed) {
    if (!packed) return null;
    const alpha = (packed >>> 24) & 0xFF;
    if (alpha === 0) return null;
    return [
        packed & 0xFF,
        (packed >>> 8) & 0xFF,
        (packed >>> 16) & 0xFF,
        alpha,
    ];
}

export function colorToHex(rgba) {
    if (!rgba) return null;
    const [r, g, b] = rgba;
    return `#${[r, g, b].map((value) => clampByte(value).toString(16).padStart(2, "0")).join("")}`;
}

function resolveScalarColor({ value, min, max, colormap, missingValue }) {
    if (!Number.isFinite(value) || value === missingValue) {
        return null;
    }
    const t = (value - min) / (max - min || 1);
    return normalizeColor(sampleColormap(colormap, t));
}

export function computeCustomSchemeColors({ values, min, max, colormap, missingValue = null }) {
    const colors = new Uint32Array(values.length);
    for (let col = 0; col < values.length; col += 1) {
        colors[col] = packRgbaColor(resolveScalarColor({
            value: values[col],
            min,
            max,
            colormap,
            missingValue,
        }));
    }
    return colors;
}

export function computeCustomSchemeProfileData({ scheme, totalCols }) {
    if (scheme.columnCount !== totalCols) {
        throw new Error(`Custom color scheme '${scheme.key}' has ${scheme.columnCount} columns, but the active alignment has ${totalCols}.`);
    }
    return scheme.colors;
}
