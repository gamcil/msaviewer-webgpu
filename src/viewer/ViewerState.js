/*
State management for the MSA viewer.
*/
import { SCHEMES } from "../schemes/registry.js";

export class ViewerState {
    constructor({
        schemeKey = "clustalx",
        themeMode = "auto",
        darkMode = false,
        cellWidth = 16,
        cellHeight = 16,
    } = {}) {
        this.listeners = new Set();
        this.state = {
            theme: {
                mode: themeMode, // 'light', 'dark', or 'auto'
                darkMode: darkMode, // actual resolved dark mode (true/false)
            },
            scheme: { 
                key: schemeKey, // e.g. 'clustalx', 'pid', 'blosum62', etc.
            },
            alignment: { // MSA data
                records: [],
                totalRows: 0,
                totalCols: 0,
                loaded: false,
            },
            viewport: {
                scrollLeft: 0,
                scrollTop: 0,
                canvasWidth: 800,
                canvasHeight: 600,
                cellWidth: cellWidth,
                cellHeight: cellHeight,
            },
            gpu: {
                msaBuffer: null,
                colProfileBuffer: null,
                renderBindGroup: null,
            }
        }
    }
    getSnapshot() {
        return {
            theme: { ...this.state.theme },
            scheme: { ...this.state.scheme },
            alignment: { ...this.state.alignment },
            viewport: { ...this.state.viewport },
            gpu: { ...this.state.gpu },
        }
    }
    subscribe(listener) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }
    emit() {
        const snapshot = this.getSnapshot();
        for (const listener of this.listeners) {
            listener(snapshot);
        }
    }
    setThemeMode(mode) {
        if (!["light", "dark", "auto"].includes(mode)) return;
        if (this.state.theme.mode === mode) return;
        this.state.theme.mode = mode;
        this.emit();
    }
    setResolvedDarkMode(darkMode) {
        const nextDarkMode = !!darkMode;
        if (this.state.theme.darkMode === nextDarkMode) return;
        this.state.theme.darkMode = nextDarkMode;
        this.emit();
    }
    setScheme(key) {
        if (!(key in SCHEMES)) return;
        if (this.state.scheme.key === key) return;
        this.state.scheme.key = key;
        this.emit();
    }
    setAlignment({ records, totalRows, totalCols }) {
        this.state.alignment = {
            records,
            totalRows,
            totalCols,
            loaded: true,
        };
        this.state.viewport.scrollLeft = 0;
        this.state.viewport.scrollTop = 0;
        this.emit();
    }
    clearAlignment() {
        this.state.alignment = {
            records: [],
            totalRows: 0,
            totalCols: 0,
            loaded: false,
        };
        this.state.viewport.scrollLeft = 0;
        this.state.viewport.scrollTop = 0;
        this.emit();
    }
    setViewportScroll(scrollLeft, scrollTop) {
        if (this.state.viewport.scrollLeft === scrollLeft && this.state.viewport.scrollTop === scrollTop) return;
        this.state.viewport.scrollLeft = scrollLeft;
        this.state.viewport.scrollTop = scrollTop;
        this.emit();
    }
    setCanvasSize(width, height) {
        if (this.state.viewport.canvasWidth === width && this.state.viewport.canvasHeight === height) return;
        this.state.viewport.canvasWidth = width;
        this.state.viewport.canvasHeight = height;
        this.emit();
    }
    setGpuResources(resources) {
        if (
            this.state.gpu.msaBuffer === resources.msaBuffer &&
            this.state.gpu.colProfileBuffer === resources.colProfileBuffer &&
            this.state.gpu.renderBindGroup === resources.renderBindGroup
        ) {
            return;
        }
        this.state.gpu = {
            msaBuffer: resources.msaBuffer ?? null,
            colProfileBuffer: resources.colProfileBuffer ?? null,
            renderBindGroup: resources.renderBindGroup ?? null
        };
        this.emit();
    }
    clearGpuResources() {
        this.state.gpu = { msaBuffer: null, colProfileBuffer: null, renderBindGroup: null };
        this.emit();
    }
}