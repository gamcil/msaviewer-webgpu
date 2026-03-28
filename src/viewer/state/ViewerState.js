/*
State management for the MSA viewer.
*/
import { SCHEMES } from "../../schemes/registry.js";

function buildCellSelectionRowIntervals(ranges) {
    const rowIntervals = new Map();
    for (const range of ranges) {
        for (let row = range.rowStart; row < range.rowEnd; row += 1) {
            const intervals = rowIntervals.get(row) ?? [];
            intervals.push({ colStart: range.colStart, colEnd: range.colEnd });
            rowIntervals.set(row, intervals);
        }
    }

    for (const [row, intervals] of rowIntervals.entries()) {
        intervals.sort((a, b) => a.colStart - b.colStart || a.colEnd - b.colEnd);
        const merged = [];
        for (const interval of intervals) {
            const last = merged[merged.length - 1];
            if (last && interval.colStart <= last.colEnd) {
                last.colEnd = Math.max(last.colEnd, interval.colEnd);
            } else {
                merged.push({ ...interval });
            }
        }
        rowIntervals.set(row, merged);
    }

    return rowIntervals;
}

function normalizeCellSelectionRanges(ranges) {
    const rowIntervals = buildCellSelectionRowIntervals(ranges);
    const rows = Array.from(rowIntervals.keys()).sort((a, b) => a - b);
    const result = [];
    const active = new Map();

    for (const row of rows) {
        const intervals = rowIntervals.get(row) ?? [];
        const intervalKeys = new Set(intervals.map((interval) => `${interval.colStart}:${interval.colEnd}`));

        for (const [key, rect] of Array.from(active.entries())) {
            if (!intervalKeys.has(key)) {
                result.push(rect);
                active.delete(key);
            }
        }

        for (const interval of intervals) {
            const key = `${interval.colStart}:${interval.colEnd}`;
            const existing = active.get(key);
            if (existing && existing.rowEnd === row) {
                existing.rowEnd = row + 1;
            } else if (!existing) {
                active.set(key, {
                    colStart: interval.colStart,
                    colEnd: interval.colEnd,
                    rowStart: row,
                    rowEnd: row + 1,
                });
            }
        }
    }

    for (const rect of active.values()) {
        result.push(rect);
    }

    return result.sort((a, b) =>
        a.rowStart - b.rowStart ||
        a.colStart - b.colStart ||
        a.rowEnd - b.rowEnd ||
        a.colEnd - b.colEnd
    );
}

function normalizeSelectionRanges(ranges, mode = "column") {
    const normalized = (Array.isArray(ranges) ? ranges : [])
        .filter((range) =>
            Number.isInteger(range?.colStart) &&
            Number.isInteger(range?.colEnd) &&
            Number.isInteger(range?.rowStart) &&
            Number.isInteger(range?.rowEnd) &&
            range.colEnd > range.colStart &&
            range.rowEnd > range.rowStart
        )
        .map((range) => ({ ...range }));

    if (mode === "cell") {
        return normalizeCellSelectionRanges(normalized);
    }

    let changed = true;
    while (changed) {
        changed = false;
        normalized.sort((a, b) =>
            a.rowStart - b.rowStart ||
            a.rowEnd - b.rowEnd ||
            a.colStart - b.colStart ||
            a.colEnd - b.colEnd
        );

        outer: for (let i = 0; i < normalized.length; i += 1) {
            for (let j = i + 1; j < normalized.length; j += 1) {
                const a = normalized[i];
                const b = normalized[j];
                const sameRows = a.rowStart === b.rowStart && a.rowEnd === b.rowEnd;
                const sameCols = a.colStart === b.colStart && a.colEnd === b.colEnd;
                const colsTouch = a.colStart <= b.colEnd && b.colStart <= a.colEnd;
                const rowsTouch = a.rowStart <= b.rowEnd && b.rowStart <= a.rowEnd;
                if (sameRows && colsTouch) {
                    normalized[i] = {
                        colStart: Math.min(a.colStart, b.colStart),
                        colEnd: Math.max(a.colEnd, b.colEnd),
                        rowStart: a.rowStart,
                        rowEnd: a.rowEnd,
                    };
                    normalized.splice(j, 1);
                    changed = true;
                    break outer;
                }
                if (sameCols && rowsTouch) {
                    normalized[i] = {
                        colStart: a.colStart,
                        colEnd: a.colEnd,
                        rowStart: Math.min(a.rowStart, b.rowStart),
                        rowEnd: Math.max(a.rowEnd, b.rowEnd),
                    };
                    normalized.splice(j, 1);
                    changed = true;
                    break outer;
                }
            }
        }
    }

    return normalized;
}

function countCellSelectionComponentsFromRowIntervals(rowIntervals) {
    const rows = Array.from(rowIntervals.keys()).sort((a, b) => a - b);
    if (rows.length === 0) return 0;

    const nodes = [];
    const nodesByRow = new Map();

    for (const row of rows) {
        const intervals = rowIntervals.get(row) ?? [];
        for (const interval of intervals) {
            const node = {
                row,
                colStart: interval.colStart,
                colEnd: interval.colEnd,
                neighbors: [],
            };
            nodes.push(node);
            const rowNodes = nodesByRow.get(row) ?? [];
            rowNodes.push(node);
            nodesByRow.set(row, rowNodes);
        }
    }

    for (const row of rows) {
        const currentNodes = nodesByRow.get(row) ?? [];
        const previousNodes = nodesByRow.get(row - 1) ?? [];
        if (previousNodes.length === 0) continue;

        let previousIndex = 0;
        for (const node of currentNodes) {
            while (previousIndex < previousNodes.length && previousNodes[previousIndex].colEnd <= node.colStart) {
                previousIndex += 1;
            }
            for (let scanIndex = previousIndex; scanIndex < previousNodes.length; scanIndex += 1) {
                const previous = previousNodes[scanIndex];
                if (previous.colStart >= node.colEnd) break;
                previous.neighbors.push(node);
                node.neighbors.push(previous);
            }
        }
    }

    let components = 0;
    const visited = new Set();
    for (const node of nodes) {
        if (visited.has(node)) continue;
        components += 1;
        const stack = [node];
        visited.add(node);
        while (stack.length > 0) {
            const current = stack.pop();
            for (const neighbor of current.neighbors) {
                if (visited.has(neighbor)) continue;
                visited.add(neighbor);
                stack.push(neighbor);
            }
        }
    }

    return components;
}

function countNormalizedSelectionComponents(normalized, mode = "column") {
    if (normalized.length === 0) return 0;
    if (mode === "cell") {
        return countCellSelectionComponentsFromRowIntervals(buildCellSelectionRowIntervals(normalized));
    }
    return normalized.length;
}

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
        this.selectionListeners = new Set();
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
                mode: "column",
                ranges: [],
                componentCount: 0,
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
            selection: {
                mode: this.state.selection.mode,
                ranges: this.state.selection.ranges.map((range) => ({ ...range })),
                componentCount: this.state.selection.componentCount,
            },
        }
    }
    getSelectionSnapshot() {
        return {
            mode: this.state.selection.mode,
            ranges: this.state.selection.ranges.map((range) => ({ ...range })),
            componentCount: this.state.selection.componentCount,
        };
    }
    subscribe(listener) {
        this.listeners.add(listener);
        listener(this.getSnapshot());
        return () => this.listeners.delete(listener);
    }
    subscribeSelection(listener) {
        this.selectionListeners.add(listener);
        listener(this.getSelectionSnapshot());
        return () => this.selectionListeners.delete(listener);
    }
    emit() {
        const snapshot = this.getSnapshot();
        for (const listener of this.listeners) {
            listener(snapshot);
        }
    }
    emitSelection() {
        const snapshot = this.getSelectionSnapshot();
        for (const listener of this.selectionListeners) {
            listener(snapshot);
        }
    }
    getSelectionMode() {
        return this.state.selection.mode;
    }
    getSchemeKey() {
        return this.state.scheme.key;
    }
    getThemeSnapshot() {
        return { ...this.state.theme };
    }
    getResolvedDarkMode() {
        return this.state.theme.darkMode;
    }
    getViewportSnapshot() {
        return { ...this.state.viewport };
    }
    getCellSize() {
        return {
            cellWidth: this.state.viewport.cellWidth,
            cellHeight: this.state.viewport.cellHeight,
        };
    }
    getMaskingSnapshot() {
        return { ...this.state.masking };
    }
    getAlignmentIdentity() {
        return {
            alphabetId: this.state.alignment.alphabetId,
            representationId: this.state.alignment.representationId,
        };
    }
    getAlignmentBounds() {
        return {
            totalRows: this.state.alignment.totalRows,
            totalCols: this.state.alignment.totalCols,
        };
    }
    applySelectionRanges(ranges, mode = this.state.selection.mode) {
        const normalizedRanges = normalizeSelectionRanges(ranges, mode);
        this.state.selection.ranges = normalizedRanges;
        this.state.selection.componentCount = countNormalizedSelectionComponents(normalizedRanges, mode);
    }
    setSelectionMode(mode) {
        if (!["column", "row", "cell"].includes(mode)) return;
        if (this.state.selection.mode === mode) return;
        this.state.selection.mode = mode;
        this.state.selection.componentCount = countNormalizedSelectionComponents(this.state.selection.ranges, mode);
        this.emitSelection();
        this.emit();
    }

    setSelectionRanges(ranges) {
        this.applySelectionRanges(ranges, this.state.selection.mode);
        this.emitSelection();
        this.emit();
    }

    appendSelectionRanges(ranges) {
        if (!Array.isArray(ranges) || ranges.length === 0) return;
        this.applySelectionRanges([
            ...this.state.selection.ranges,
            ...ranges,
        ], this.state.selection.mode);
        this.emitSelection();
        this.emit();
    }

    clearSelection() {
        if (this.state.selection.ranges.length === 0) return;
        this.state.selection.ranges = [];
        this.state.selection.componentCount = 0;
        this.emitSelection();
        this.emit();
    }

    setSelectedColumns(set) {
        const totalRows = this.state.alignment.totalRows;
        const sorted = Array.from(set).filter((value) => Number.isInteger(value) && value >= 0).sort((a, b) => a - b);
        const ranges = [];
        for (const col of sorted) {
            const lastRange = ranges[ranges.length - 1];
            if (lastRange && col === lastRange.colEnd) {
                lastRange.colEnd = col + 1;
                continue;
            }
            ranges.push({
                colStart: col,
                colEnd: col + 1,
                rowStart: 0,
                rowEnd: totalRows,
            });
        }
        this.state.selection.mode = "column";
        this.applySelectionRanges(ranges, "column");
        this.emitSelection();
        this.emit();
    }

    toggleSelectedColumn(col) {
        const next = this.getSelectedColumns();
        if (next.has(col)) next.delete(col);
        else next.add(col);
        this.setSelectedColumns(next);
    }

    getSelectedColumns() {
        const totalRows = this.state.alignment.totalRows;
        const selected = new Set();
        for (const range of this.state.selection.ranges) {
            if (range.rowStart !== 0 || range.rowEnd !== totalRows) continue;
            for (let col = range.colStart; col < range.colEnd; col += 1) {
                selected.add(col);
            }
        }
        return selected;
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
            this.state.selection.ranges = [];
            this.state.selection.componentCount = 0;
            this.emitSelection();
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
        this.state.selection.ranges = [];
        this.state.selection.componentCount = 0;
        this.emitSelection();
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
