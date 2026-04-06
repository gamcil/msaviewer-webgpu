import { defineConfig } from "vite";
import { resolve } from "node:path";
import { wgslPlugin } from "./vite.wgsl.plugin.js";

export default defineConfig({
    root: resolve(import.meta.dirname, "src/demo"),
    base: "./",
    plugins: [wgslPlugin()],
    build: {
        outDir: resolve(import.meta.dirname, "dist-demo"),
        emptyOutDir: true,
    },
});
