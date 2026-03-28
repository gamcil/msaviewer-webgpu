import {
    buildOverlayGeometry,
} from "../models/alignmentOverlayGeometry.js";
import { drawSelectionUnion } from "../renderers/selectionUnionRenderer.js";

export class AlignmentOverlayPainter {
    constructor({
        root,
        motifOverlay,
        motifContext,
        overlay,
        overlayContext,
    }) {
        this.root = root;
        this.motifOverlay = motifOverlay;
        this.motifContext = motifContext;
        this.overlay = overlay;
        this.overlayContext = overlayContext;
        this.hoveredCell = null;
        this.selectionMode = "column";
        this.selectionRanges = [];
        this.previewRange = null;
        this.columnVisibility = null;
        this.motifHitsByRow = null;
    }

    setSelectionState({
        hoveredCell = null,
        selectionMode = this.selectionMode,
        selectionRanges = this.selectionRanges,
        previewRange = this.previewRange,
        columnVisibility = this.columnVisibility,
    }) {
        this.hoveredCell = hoveredCell;
        this.selectionMode = selectionMode;
        this.selectionRanges = selectionRanges;
        this.previewRange = previewRange;
        this.columnVisibility = columnVisibility;
    }

    setMotifState({ motifHitsByRow = null } = {}) {
        this.motifHitsByRow = motifHitsByRow;
    }

    setColumnVisibility(columnVisibility) {
        this.columnVisibility = columnVisibility;
    }

    drawMotifOverlay({
        dpr,
        cellWidthCss,
        cellHeightCss,
        colStart,
        colEnd,
        rowStart,
        rowEnd,
        scrollLeft,
        scrollTop,
    }) {
        if (!this.motifContext) return;
        this.clearMotifOverlay();
        if (!this.motifHitsByRow) return;

        const cellWidthPx = Math.max(1, Math.round(cellWidthCss * dpr));
        const cellHeightPx = Math.max(1, Math.round(cellHeightCss * dpr));
        const localScrollLeft = scrollLeft - colStart * cellWidthCss;
        const localScrollTop = scrollTop - rowStart * cellHeightCss;
        const localScrollLeftPx = Math.round(localScrollLeft * dpr);
        const localScrollTopPx = Math.round(localScrollTop * dpr);

        this.motifContext.fillStyle = "rgba(255, 193, 7, 0.28)";
        this.motifContext.strokeStyle = "rgba(255, 193, 7, 0.85)";
        this.motifContext.lineWidth = Math.max(1, Math.round(dpr));

        for (let row = rowStart; row < rowEnd; row += 1) {
            const hits = this.motifHitsByRow[row];
            if (!hits?.length) continue;
            const y = (row - rowStart) * cellHeightPx - localScrollTopPx;
            for (const hit of hits) {
                const hitStart = Math.max(hit.start, colStart);
                const hitEnd = Math.min(hit.start + hit.len, colEnd);
                if (hitStart >= hitEnd) continue;
                const x = (hitStart - colStart) * cellWidthPx - localScrollLeftPx;
                const widthPx = (hitEnd - hitStart) * cellWidthPx;
                this.motifContext.fillRect(x, y, widthPx, cellHeightPx);
                this.motifContext.strokeRect(x + 0.5, y + 0.5, Math.max(0, widthPx - 1), Math.max(0, cellHeightPx - 1));
            }
        }
    }

    drawOverlay({
        dpr,
        cellWidthCss,
        cellHeightCss,
        colStart,
        colEnd,
        rowStart,
        rowEnd,
        scrollLeft,
        scrollTop,
    }) {
        if (!this.overlayContext) return;

        const cellWidthPx = Math.max(1, Math.round(cellWidthCss * dpr));
        this.clearOverlay();
        const localScrollLeft = scrollLeft - colStart * cellWidthCss;
        const localScrollLeftPx = Math.round(localScrollLeft * dpr);
        const localScrollTop = scrollTop - rowStart * cellHeightCss;
        const localScrollTopPx = Math.round(localScrollTop * dpr);
        const cellHeightPx = Math.max(1, Math.round(cellHeightCss * dpr));
        const heightPx = (rowEnd - rowStart) * cellHeightPx;
        const geometry = this.buildOverlayGeometry({ colStart, colEnd, rowStart, rowEnd });

        this.drawCellSelectionUnion({
            rowIntervals: geometry.committedRowIntervals,
            colStart,
            rowStart,
            cellWidthPx,
            cellHeightPx,
            localScrollLeftPx,
            localScrollTopPx,
            fillStyle: this.getSelectionFillStyle(),
            strokeStyle: this.getSelectionStrokeStyle(),
            dashed: true,
            dpr,
        });
        this.drawCellSelectionUnion({
            rowIntervals: geometry.previewRowIntervals,
            colStart,
            rowStart,
            cellWidthPx,
            cellHeightPx,
            localScrollLeftPx,
            localScrollTopPx,
            fillStyle: "rgba(89, 211, 255, 0.10)",
            strokeStyle: "rgba(0, 122, 178, 0.95)",
            dashed: false,
            dpr,
        });

        this.overlayContext.strokeStyle = this.getSelectionStrokeStyle();
        this.overlayContext.lineWidth = Math.max(1.2, Math.round(1.2 * dpr));
        if (this.selectionMode === "row") {
            const hoveredRow = geometry.hoveredRow;
            if (hoveredRow >= rowStart && hoveredRow < rowEnd) {
                const y = (hoveredRow - rowStart) * cellHeightPx - localScrollTopPx;
                this.overlayContext.strokeRect(0.5, y + 0.5, Math.max(0, this.overlay.width - 1), Math.max(0, cellHeightPx - 1));
            }
        } else if (geometry.hoveredVisibleCol >= colStart && geometry.hoveredVisibleCol < colEnd) {
            if (this.selectionMode === "cell") {
                const hoveredRow = geometry.hoveredRow;
                const x = (geometry.hoveredVisibleCol - colStart) * cellWidthPx - localScrollLeftPx;
                if (hoveredRow >= rowStart && hoveredRow < rowEnd) {
                    const y = (hoveredRow - rowStart) * cellHeightPx - localScrollTopPx;
                    this.overlayContext.strokeRect(x + 0.5, y + 0.5, Math.max(0, cellWidthPx - 1), Math.max(0, cellHeightPx - 1));
                }
            } else {
                const x = (geometry.hoveredVisibleCol - colStart) * cellWidthPx - localScrollLeftPx;
                this.overlayContext.strokeRect(x + 0.5, 0.5, Math.max(0, cellWidthPx - 1), Math.max(0, heightPx - 1));
            }
        }
    }

    clearOverlay() {
        if (!this.overlayContext) return;
        this.overlayContext.clearRect(0, 0, this.overlay.width, this.overlay.height);
    }

    clearMotifOverlay() {
        if (!this.motifContext) return;
        this.motifContext.clearRect(0, 0, this.motifOverlay.width, this.motifOverlay.height);
    }

    buildOverlayGeometry({ colStart, colEnd, rowStart, rowEnd }) {
        return buildOverlayGeometry({
            selectionRanges: this.selectionRanges,
            previewRange: this.previewRange,
            hoveredCell: this.hoveredCell,
            columnVisibility: this.columnVisibility,
            colStart,
            colEnd,
            rowStart,
            rowEnd,
        });
    }

    drawCellSelectionUnion({
        rowIntervals,
        colStart,
        rowStart,
        cellWidthPx,
        cellHeightPx,
        localScrollLeftPx,
        localScrollTopPx,
        fillStyle,
        strokeStyle,
        dashed,
        dpr,
    }) {
        if (rowIntervals.size === 0) return;

        const lineWidth = dashed ? Math.max(1.2, Math.round(1.2 * dpr)) : Math.max(1, Math.round(dpr));
        drawSelectionUnion({
            context: this.overlayContext,
            rowIntervals,
            getRowY: (row) => (row - rowStart) * cellHeightPx - localScrollTopPx,
            getRowHeight: () => cellHeightPx,
            getIntervalX: (interval) => (interval.colStart - colStart) * cellWidthPx - localScrollLeftPx,
            getIntervalWidth: (interval) => (interval.colEnd - interval.colStart) * cellWidthPx,
            washFillStyle: this.getSelectionWashFillStyle(),
            fillStyle,
            strokeStyle,
            lineWidth,
            lineDash: dashed ? [Math.max(4, Math.round(4 * dpr)), Math.max(3, Math.round(3 * dpr))] : [],
        });
    }

    getSelectionWashFillStyle() {
        return "rgba(255, 255, 255, 0.6)";
    }

    getSelectionFillStyle() {
        return "rgba(89, 211, 255, 0.16)";
    }

    getSelectionStrokeStyle() {
        const docTheme = document.documentElement.dataset.theme;
        const rootTheme = this.root?.getRootNode?.()?.host?.dataset?.theme;
        const isDark = rootTheme === "dark" || (rootTheme == null && docTheme === "dark");
        return isDark ? "rgb(20, 70, 96)" : "rgb(0, 122, 178)";
    }
}
