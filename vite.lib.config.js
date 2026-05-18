import { defineConfig } from "vite";
import { resolve } from "node:path";
import { wgslPlugin } from "./vite.wgsl.plugin.js";

export default defineConfig({
    plugins: [wgslPlugin()],
    build: {
        outDir: resolve(import.meta.dirname, "dist"),
        emptyOutDir: true,
        sourcemap: false,
        target: "es2022",
        assetsInlineLimit: 0,
        lib: {
            entry: resolve(import.meta.dirname, "src/index.js"),
            formats: ["es"],
            fileName: () => "index.js",
        },
        rollupOptions: {
            output: {
                assetFileNames: "assets/[name][extname]",
                chunkFileNames: "chunks/[name]-[hash].js",
            },
        },
    },
});
