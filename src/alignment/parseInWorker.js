import { restoreTileStorage } from "./tiledStorage.js";

export async function parseAlignmentInWorker(input, format) {
    if (typeof Worker === "undefined") {
        return null;
    }

    let worker;
    try {
        worker = new Worker(new URL("./alignmentParser.worker.js", import.meta.url), { type: "module" });
    } catch {
        return null;
    }
    let posted = false;
    try {
        const result = await new Promise((resolve, reject) => {
            worker.onmessage = ({ data }) => {
                if (data.error) {
                    reject(new Error(data.error));
                } else {
                    resolve(data);
                }
            };
            worker.onerror = (event) => reject(event.error ?? new Error(event.message));
            try {
                const transfer = typeof ReadableStream !== "undefined" && input instanceof ReadableStream
                    ? [input]
                    : [];
                worker.postMessage({ id: 1, input, format }, transfer);
                posted = true;
            } catch (error) {
                reject(error);
            }
        });
        result.alignment.tileStorage = await restoreTileStorage(result.storage);
        return result.alignment;
    } catch (error) {
        if (!posted) {
            return null;
        }
        throw error;
    } finally {
        worker.terminate();
    }
}
