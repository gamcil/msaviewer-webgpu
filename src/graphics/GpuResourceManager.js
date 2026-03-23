export class GpuResourceManager {
    constructor(device) {
        this.device = device;
        this.singletons = new Map();
        this.growableBuffers = new Map();
        this.growableTextures = new Map();
        this.keyed = new Map();
    }

    createSingletonBuffer(name, { size, usage, data = null }) {
        const existing = this.singletons.get(name);
        existing?.destroy?.();
        const buffer = this.device.createBuffer({ size, usage });
        if (data) {
            this.device.queue.writeBuffer(buffer, 0, data);
        }
        this.singletons.set(name, buffer);
        return buffer;
    }

    setSingleton(name, resource) {
        const existing = this.singletons.get(name);
        if (existing && existing !== resource) {
            existing.destroy?.();
        }
        this.singletons.set(name, resource);
        return resource;
    }

    getSingleton(name) {
        return this.singletons.get(name) ?? null;
    }

    getOrCreateGrowableBuffer(name, { minSize, usage }) {
        const existing = this.growableBuffers.get(name);
        if (existing && existing.size >= minSize) {
            return existing.buffer;
        }
        existing?.buffer?.destroy?.();
        const buffer = this.device.createBuffer({
            size: minSize,
            usage,
        });
        this.growableBuffers.set(name, { buffer, size: minSize, usage });
        return buffer;
    }

    getOrCreateGrowableTexture(name, { width, height, format, usage }) {
        const existing = this.growableTextures.get(name);
        if (
            existing &&
            existing.width >= width &&
            existing.height >= height &&
            existing.format === format &&
            existing.usage === usage
        ) {
            return existing.texture;
        }
        existing?.texture?.destroy?.();
        const texture = this.device.createTexture({
            size: [width, height, 1],
            format,
            usage,
        });
        this.growableTextures.set(name, { texture, width, height, format, usage });
        return texture;
    }

    getOrCreateKeyed(kind, key, factory) {
        if (!this.keyed.has(kind)) {
            this.keyed.set(kind, new Map());
        }
        const bucket = this.keyed.get(kind);
        if (!bucket.has(key)) {
            bucket.set(key, factory());
        }
        return bucket.get(key);
    }

    clearKeyed(kind) {
        const bucket = this.keyed.get(kind);
        if (!bucket) return;
        for (const resource of bucket.values()) {
            resource?.destroy?.();
        }
        bucket.clear();
    }

    destroy() {
        for (const resource of this.singletons.values()) {
            resource?.destroy?.();
        }
        for (const entry of this.growableBuffers.values()) {
            entry.buffer?.destroy?.();
        }
        for (const entry of this.growableTextures.values()) {
            entry.texture?.destroy?.();
        }
        for (const bucket of this.keyed.values()) {
            for (const resource of bucket.values()) {
                resource?.destroy?.();
            }
        }
        this.singletons.clear();
        this.growableBuffers.clear();
        this.growableTextures.clear();
        this.keyed.clear();
    }
}
