async function loadImageBitmap(url) {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Failed to load ${url}: ${response.status}`);
    }
    const blob = await response.blob();
    return createImageBitmap(blob);
}

export { loadImageBitmap };
