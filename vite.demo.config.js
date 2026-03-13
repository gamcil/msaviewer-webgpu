import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
    root: resolve(import.meta.dirname, "src/demo"),
    base: "./",
    build: {
        outDir: resolve(import.meta.dirname, "dist-demo"),
        emptyOutDir: true,
    },
});
