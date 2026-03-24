/*
State management for the MSA viewer.
*/
import { SCHEMES } from "../schemes/registry.js";

export class ViewerState {
    constructor({
        schemeKey = "clustalx",
        themeMode = "auto",
        darkMode = false,
        alphabetId = "aa",
        representationId = null,
        cellWidth = 16,
        cellHeight = 16,
        hideInsertionColumns = false,
        gapThreshold = null,
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
            masking: {
                hideInsertionColumns,
                gapThreshold: Number.isFinite(gapThreshold) ? gapThreshold : null,
            },
            alignment: { // MSA data
                records: [],
                totalRows: 0,
                totalCols: 0,
                alphabetId,
                representationId,
                loaded: false,
            },
            selection: {
                columns: new Set(),
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
            masking: { ...this.state.masking },
            alignment: { ...this.state.alignment },
            viewport: { ...this.state.viewport },
            gpu: { ...this.state.gpu },
            selection: { ...this.state.selection, columns: new Set(this.state.selection.columns) },
        }
    }
    subscribe(listener) {
        this.listeners.add(listener);
        listener(this.getSnapshot());
        return () => this.listeners.delete(listener);
    }
    emit() {
        const snapshot = this.getSnapshot();
        for (const listener of this.listeners) {
            listener(snapshot);
        }
    }
    setSelectedColumns(set) {
        this.state.selection.columns = set;
        this.emit();
    }
    toggleSelectedColumn(col) {
        const next = new Set(this.state.selection.columns);
        if (next.has(col)) next.delete(col);
        else next.add(col);
        this.state.selection.columns = next;
        this.emit();
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
    setColumnMasking({ hideInsertionColumns, gapThreshold } = {}) {
        const nextHideInsertionColumns = hideInsertionColumns == null
            ? this.state.masking.hideInsertionColumns
            : hideInsertionColumns === true;
        const nextGapThreshold = gapThreshold == null
            ? this.state.masking.gapThreshold
            : (Number.isFinite(gapThreshold) ? gapThreshold : null);
        if (
            this.state.masking.hideInsertionColumns === nextHideInsertionColumns &&
            this.state.masking.gapThreshold === nextGapThreshold
        ) {
            return;
        }
        this.state.masking.hideInsertionColumns = nextHideInsertionColumns;
        this.state.masking.gapThreshold = nextGapThreshold;
        this.emit();
    }
    setAlignment({
        records,
        totalRows,
        totalCols,
        alphabetId = this.state.alignment.alphabetId,
        representationId = this.state.alignment.representationId,
        preserveSelection = false,
        preserveScroll = false,
    }) {
        this.state.alignment = {
            records,
            totalRows,
            totalCols,
            alphabetId,
            representationId,
            loaded: true,
        };
        if (!preserveSelection) {
            this.state.selection.columns = new Set();
        }
        if (!preserveScroll) {
            this.state.viewport.scrollLeft = 0;
            this.state.viewport.scrollTop = 0;
        }
        this.emit();
    }
    setActiveAlphabetId(alphabetId) {
        if (!alphabetId || this.state.alignment.alphabetId === alphabetId) return;
        this.state.alignment.alphabetId = alphabetId;
        this.emit();
    }
    setActiveRepresentationId(representationId, alphabetId = this.state.alignment.alphabetId) {
        if (!representationId) return;
        if (
            this.state.alignment.representationId === representationId &&
            this.state.alignment.alphabetId === alphabetId
        ) {
            return;
        }
        this.state.alignment.representationId = representationId;
        this.state.alignment.alphabetId = alphabetId;
        this.emit();
    }
    clearAlignment() {
        this.state.alignment = {
            records: [],
            totalRows: 0,
            totalCols: 0,
            alphabetId: this.state.alignment.alphabetId,
            representationId: this.state.alignment.representationId,
            loaded: false,
        };
        this.state.selection.columns = new Set();
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
