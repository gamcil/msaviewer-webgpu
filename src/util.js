async function loadImageBitmap(url) {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Failed to load ${url}: ${response.status}`);
    }
    const blob = await response.blob();
    return createImageBitmap(blob);
}

function isPlainObject(value) {
    return value != null && typeof value === "object" && !Array.isArray(value);
}

function mergeObjects(base = {}, override = {}) {
    if (!isPlainObject(override)) {
        return { ...base };
    }
    const result = { ...base };
    for (const [key, value] of Object.entries(override)) {
        result[key] = isPlainObject(value) && isPlainObject(base[key])
            ? mergeObjects(base[key], value)
            : value;
    }
    return result;
}

export { isPlainObject, loadImageBitmap, mergeObjects };
