let accessHandle = null;

function respondError(id, error) {
    self.postMessage({
        id,
        error: error instanceof Error ? error.message : String(error),
    });
}

self.onmessage = async ({ data }) => {
    const { id, type } = data;
    try {
        if (type === "open") {
            accessHandle?.close();
            accessHandle = await data.fileHandle.createSyncAccessHandle();
            self.postMessage({ id });
            return;
        }
        if (type === "read") {
            if (!accessHandle) {
                throw new Error("OPFS tile reader is not open.");
            }
            const buffer = new ArrayBuffer(data.byteLength);
            const bytesRead = accessHandle.read(new Uint8Array(buffer), { at: data.byteOffset });
            if (bytesRead !== data.byteLength) {
                throw new Error(`Expected ${data.byteLength} tile bytes, received ${bytesRead}.`);
            }
            self.postMessage({ id, buffer }, [buffer]);
            return;
        }
        if (type === "close") {
            accessHandle?.close();
            accessHandle = null;
            self.postMessage({ id });
            return;
        }
        throw new Error(`Unknown OPFS tile reader request '${type}'.`);
    } catch (error) {
        respondError(id, error);
    }
};
