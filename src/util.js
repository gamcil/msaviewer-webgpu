async function loadImageSource(url) {
    const image = new Image();
    image.decoding = "async";
    image.src = String(url);
    if (typeof image.decode === "function") {
        await image.decode();
        return image;
    }
    await new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = () => reject(new Error(`Failed to load image: ${url}`));
    });
    return image;
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

export { isPlainObject, loadImageSource, mergeObjects };
