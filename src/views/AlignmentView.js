/*
View for the alignment itself
*/

import { AlignmentOverlayPainter } from "./helpers/AlignmentOverlayPainter.js";

export class AlignmentView {
    constructor({
        root,
        surfaceRenderer,
        getCellWidth,
        getCellHeight,
        headerWidth = 0,
        rulerHeight = 0,
        headerVisible = true,
        rulerVisible = true,
    }) {
        this.root = root;
        this.surfaceRenderer = surfaceRenderer;
        this.getCellWidth = getCellWidth;
        this.getCellHeight = getCellHeight;
        this.headerWidth = headerWidth;
        this.rulerHeight = rulerHeight;
        this.headerVisible = headerVisible;
        this.rulerVisible = rulerVisible;
        this.loaded = true;
        this.totalCols = 0;
        this.totalRows = 0;
        this.contentWidth = 0;
        this.contentHeight = 0;

        this.topRow = document.createElement("div");
        this.topRow.className = "msa-alignment-top-row";

        this.corner = document.createElement("div");
        this.corner.className = "msa-alignment-corner";

        this.rulerSlot = document.createElement("div");
        this.rulerSlot.className = "msa-ruler-body";

        this.bodyRow = document.createElement("div");
        this.bodyRow.className = "msa-alignment-body-row";

        this.leftColumn = document.createElement("div");
        this.leftColumn.className = "msa-alignment-left-column";

        this.headerSlot = document.createElement("div");
        this.headerSlot.className = "msa-headers";

        this.trackLabelSlot = document.createElement("div");
        this.trackLabelSlot.className = "msa-track-label-stack";

        this.contentColumn = document.createElement("div");
        this.contentColumn.className = "msa-alignment-content-column";

        this.horizontalScroller = document.createElement("div");
        this.horizontalScroller.className = "msa-alignment-horizontal-scroller";

        this.contentStack = document.createElement("div");
        this.contentStack.className = "msa-alignment-content-stack";

        this.alignmentShell = document.createElement("div");
        this.alignmentShell.className = "msa-alignment-viewport";

        this.verticalScroller = document.createElement("div");
        this.verticalScroller.className = "msa-alignment-vertical-scroller";

        this.interactionProxy = document.createElement("div");
        this.interactionProxy.className = "msa-alignment-interaction-proxy";

        this.spacer = document.createElement("div");
        this.spacer.className = "msa-alignment-spacer";

        this.proxySpacer = document.createElement("div");
        this.proxySpacer.className = "msa-alignment-spacer";

        this.trackBodySlot = document.createElement("div");
        this.trackBodySlot.className = "msa-track-body-stack";

        this.canvas = this.surfaceRenderer.canvas;

        this.motifOverlay = document.createElement("canvas");
        this.motifOverlay.className = "msa-alignment-motif-canvas";
        this.motifContext = this.motifOverlay.getContext("2d");

        this.overlay = document.createElement("canvas");
        this.overlay.className = "msa-alignment-overlay-canvas";
        this.overlayContext = this.overlay.getContext("2d");

        this.verticalScroller.appendChild(this.spacer);
        this.interactionProxy.appendChild(this.proxySpacer);
        this.alignmentShell.appendChild(this.verticalScroller);
        this.alignmentShell.appendChild(this.canvas);
        this.alignmentShell.appendChild(this.motifOverlay);
        this.alignmentShell.appendChild(this.overlay);
        this.alignmentShell.appendChild(this.interactionProxy);
        this.contentStack.appendChild(this.alignmentShell);
        this.contentStack.appendChild(this.trackBodySlot);
        this.horizontalScroller.appendChild(this.contentStack);
        this.contentColumn.appendChild(this.horizontalScroller);
        this.leftColumn.appendChild(this.headerSlot);
        this.leftColumn.appendChild(this.trackLabelSlot);
        this.topRow.appendChild(this.corner);
        this.topRow.appendChild(this.rulerSlot);
        this.bodyRow.appendChild(this.leftColumn);
        this.bodyRow.appendChild(this.contentColumn);
        this.root.appendChild(this.topRow);
        this.root.appendChild(this.bodyRow);

        this.scroller = this.verticalScroller;

        this.overlayPainter = new AlignmentOverlayPainter({
            root: this.alignmentShell,
            motifOverlay: this.motifOverlay,
            motifContext: this.motifContext,
            overlay: this.overlay,
            overlayContext: this.overlayContext,
        });

        this.isSyncingScroll = false;
        this.bindScrollSync();
        this.syncViewportChrome();
        this.setLoadedState(true);
    }

    bindScrollSync() {
        this.onProxyScroll = () => {
            if (this.isSyncingScroll) return;
            this.isSyncingScroll = true;
            if (this.horizontalScroller.scrollLeft !== this.interactionProxy.scrollLeft) {
                this.horizontalScroller.scrollLeft = this.interactionProxy.scrollLeft;
            }
            if (this.verticalScroller.scrollTop !== this.interactionProxy.scrollTop) {
                this.verticalScroller.scrollTop = this.interactionProxy.scrollTop;
            }
            this.isSyncingScroll = false;
        };
        this.onHorizontalScroll = () => {
            if (this.isSyncingScroll) return;
            if (this.horizontalScroller.scrollLeft === this.interactionProxy.scrollLeft) return;
            this.isSyncingScroll = true;
            this.interactionProxy.scrollLeft = this.horizontalScroller.scrollLeft;
            this.isSyncingScroll = false;
        };
        this.onVerticalScroll = () => {
            if (this.isSyncingScroll) return;
            if (this.verticalScroller.scrollTop === this.interactionProxy.scrollTop) return;
            this.isSyncingScroll = true;
            this.interactionProxy.scrollTop = this.verticalScroller.scrollTop;
            this.isSyncingScroll = false;
        };
        this.interactionProxy.addEventListener("scroll", this.onProxyScroll, { passive: true });
        this.verticalScroller.addEventListener("scroll", this.onVerticalScroll, { passive: true });
        this.horizontalScroller.addEventListener("scroll", this.onHorizontalScroll, { passive: true });
    }

    getHorizontalScrollElement() {
        return this.horizontalScroller;
    }

    getVerticalScrollElement() {
        return this.verticalScroller;
    }

    getScrollLeft() {
        return this.horizontalScroller.scrollLeft;
    }

    getScrollTop() {
        return this.verticalScroller.scrollTop;
    }

    getVerticalScrollbarThickness() {
        return Math.max(0, this.verticalScroller.offsetWidth - this.verticalScroller.clientWidth);
    }

    getViewportWidthCss() {
        const shellWidth = this.alignmentShell.clientWidth || this.horizontalScroller.clientWidth || this.contentColumn.clientWidth || 0;
        return Math.max(1, shellWidth - this.getVerticalScrollbarThickness());
    }

    getViewportHeightCss() {
        return Math.max(1, this.verticalScroller.clientHeight || this.alignmentShell.clientHeight || 0);
    }

    getViewportBounds() {
        const bounds = this.alignmentShell.getBoundingClientRect();
        return {
            left: bounds.left,
            top: bounds.top,
            width: Math.max(1, (this.alignmentShell.clientWidth || bounds.width) - this.getVerticalScrollbarThickness()),
            height: Math.max(1, this.verticalScroller.clientHeight || bounds.height),
        };
    }

    getInteractionTarget() {
        return this.interactionProxy;
    }

    getHorizontalScrollbarThickness() {
        return Math.max(0, this.horizontalScroller.offsetHeight - this.horizontalScroller.clientHeight);
    }

    applyContentSize() {
        this.contentStack.style.width = `${Math.max(1, this.contentWidth, this.horizontalScroller.clientWidth || 0)}px`;
        this.spacer.style.width = `${Math.max(1, this.contentWidth) }px`;
        this.spacer.style.height = `${this.contentHeight}px`;
        this.proxySpacer.style.width = `${Math.max(1, this.contentWidth) }px`;
        this.proxySpacer.style.height = `${this.contentHeight}px`;
    }

    syncViewportChrome() {
        const leftChromeWidth = this.headerVisible ? this.headerWidth : 0;

        Object.assign(this.root.style, {
            gridTemplateRows: this.rulerVisible ? `${this.rulerHeight}px minmax(0, 1fr)` : "0px minmax(0, 1fr)",
        });

        Object.assign(this.topRow.style, {
            gridTemplateColumns: `${leftChromeWidth}px minmax(0, 1fr)`,
        });
        this.topRow.hidden = !this.rulerVisible && leftChromeWidth <= 0;

        this.corner.style.borderBottom = this.rulerVisible ? "1px solid var(--msa-header-border)" : "";

        Object.assign(this.rulerSlot.style, {
            height: `${this.rulerHeight}px`,
        });
        this.rulerSlot.hidden = !this.rulerVisible;

        Object.assign(this.bodyRow.style, {
            gridTemplateColumns: `${leftChromeWidth}px minmax(0, 1fr)`,
        });

        this.leftColumn.style.borderRight = leftChromeWidth > 0 ? "1px solid var(--msa-header-border)" : "";

        this.headerSlot.hidden = !this.headerVisible;

        this.trackBodySlot.style.paddingBottom = "0px";

        this.applyContentSize();
    }

    setLoadedState(loaded) {
        this.loaded = loaded;
        this.root.classList.toggle("is-unloaded", !loaded);
    }

    setViewportChrome({ headerWidth, rulerHeight, headerVisible, rulerVisible }) {
        if (headerWidth != null) {
            this.headerWidth = headerWidth;
        }
        if (rulerHeight != null) {
            this.rulerHeight = rulerHeight;
        }
        if (headerVisible != null) {
            this.headerVisible = headerVisible;
        }
        if (rulerVisible != null) {
            this.rulerVisible = rulerVisible;
        }
        this.syncViewportChrome();
        this.setLoadedState(this.loaded);
        this.syncSurfaceSize();
    }

    getRenderedCellWidthCss() {
        const dpr = window.devicePixelRatio || 1;
        return Math.max(1, Math.round(this.getCellWidth() * dpr)) / dpr;
    }

    getRenderedCellHeightCss() {
        const dpr = window.devicePixelRatio || 1;
        return Math.max(1, Math.round(this.getCellHeight() * dpr)) / dpr;
    }

    set renderer(renderer) {
        this.surfaceRenderer?.setRenderer(renderer);
    }

    get renderer() {
        return this.surfaceRenderer?.renderer ?? null;
    }

    setRenderResources(renderResources) {
        this.surfaceRenderer?.setRenderResources?.(renderResources);
    }

    syncRenderState({ totalCols, totalRows, windowColStart = 0, windowRowStart = 0, windowCols = 0, windowRows = 0 }) {
        const dpr = window.devicePixelRatio || 1;
        const cellWidthCss = this.getRenderedCellWidthCss();
        const cellHeightCss = this.getRenderedCellHeightCss();
        const gridPxX = Math.max(1, Math.round(cellWidthCss * dpr));
        const gridPxY = Math.max(1, Math.round(cellHeightCss * dpr));
        const localScrollLeft = this.getScrollLeft() - windowColStart * cellWidthCss;
        const localScrollTop = this.getScrollTop() - windowRowStart * cellHeightCss;
        this.surfaceRenderer?.syncRenderState({
            scrollPxX: Math.round(localScrollLeft * dpr),
            scrollPxY: Math.round(localScrollTop * dpr),
            totalCols,
            totalRows,
            gridPxX,
            gridPxY,
            windowColStart,
            windowRowStart,
            windowCols,
            windowRows,
        });
    }

    getVisibleColumnRange() {
        const scrollLeft = this.getScrollLeft();
        const viewportWidth = this.getViewportWidthCss();
        const cellWidth = this.getRenderedCellWidthCss();
        const colStart = Math.floor(scrollLeft / cellWidth);
        const colEnd = Math.min(this.totalCols, Math.ceil((scrollLeft + viewportWidth) / cellWidth));
        return [colStart, colEnd];
    }

    setOverlayState({
        hoveredCell = null,
        selectionMode = "column",
        selectionRanges = [],
        previewRange = null,
        columnVisibility = undefined,
    }) {
        this.overlayPainter.setSelectionState({
            hoveredCell,
            selectionMode,
            selectionRanges,
            previewRange,
            columnVisibility,
        });
        this.renderOverlays();
    }

    getVisibleRowRange() {
        const scrollTop = this.getScrollTop();
        const viewportHeight = this.getViewportHeightCss();
        const cellHeight = this.getRenderedCellHeightCss();
        const rowStart = Math.floor(scrollTop / cellHeight);
        const rowEnd = Math.min(this.totalRows, Math.ceil((scrollTop + viewportHeight) / cellHeight));
        return [rowStart, rowEnd];
    }

    setMotifState({ motifHitsByRow = null } = {}) {
        this.overlayPainter.setMotifState({ motifHitsByRow });
        this.renderOverlays();
    }

    renderMotifOverlay() {
        const dpr = window.devicePixelRatio || 1;
        const cellWidthCss = this.getRenderedCellWidthCss();
        const cellHeightCss = this.getRenderedCellHeightCss();
        const [colStart, colEnd] = this.getVisibleColumnRange();
        const [rowStart, rowEnd] = this.getVisibleRowRange();
        this.overlayPainter.drawMotifOverlay({
            dpr,
            cellWidthCss,
            cellHeightCss,
            colStart,
            colEnd,
            rowStart,
            rowEnd,
            scrollLeft: this.getScrollLeft(),
            scrollTop: this.getScrollTop(),
        });
    }

    renderSelectionOverlay() {
        const dpr = window.devicePixelRatio || 1;
        const cellWidthCss = this.getRenderedCellWidthCss();
        const cellHeightCss = this.getRenderedCellHeightCss();
        const [colStart, colEnd] = this.getVisibleColumnRange();
        const [rowStart, rowEnd] = this.getVisibleRowRange();
        this.overlayPainter.drawOverlay({
            dpr,
            cellWidthCss,
            cellHeightCss,
            colStart,
            colEnd,
            rowStart,
            rowEnd,
            scrollLeft: this.getScrollLeft(),
            scrollTop: this.getScrollTop(),
        });
    }

    renderOverlays() {
        this.renderMotifOverlay();
        this.renderSelectionOverlay();
    }

    renderSurface() {
        this.surfaceRenderer?.render();
    }

    syncSurfaceSize() {
        const horizontalScrollbarThickness = this.getHorizontalScrollbarThickness();
        const trackStackHeight = this.trackBodySlot.hidden ? 0 : this.trackBodySlot.offsetHeight;
        const availableHeight = Math.max(
            1,
            (this.bodyRow.clientHeight || this.root.clientHeight || 0) - trackStackHeight,
        );
        const shellWidth = Math.max(1, this.contentColumn.clientWidth || this.horizontalScroller.clientWidth || this.root.clientWidth || 0);
        const viewportWidth = Math.max(1, shellWidth - this.getVerticalScrollbarThickness());

        this.alignmentShell.style.width = `${shellWidth}px`;
        this.alignmentShell.style.height = `${availableHeight}px`;
        this.verticalScroller.style.width = `${shellWidth}px`;
        this.verticalScroller.style.height = `${availableHeight}px`;
        this.trackBodySlot.style.width = `${viewportWidth}px`;
        this.trackBodySlot.style.paddingBottom = `${horizontalScrollbarThickness}px`;
        this.headerSlot.style.height = `${availableHeight}px`;
        this.contentStack.style.paddingBottom = "0px";
        this.applyContentSize();

        this.canvas.style.left = "0";
        this.canvas.style.top = "0";
        this.motifOverlay.style.left = "0";
        this.motifOverlay.style.top = "0";
        this.overlay.style.left = "0";
        this.overlay.style.top = "0";
        this.canvas.style.width = `${viewportWidth}px`;
        this.canvas.style.height = `${availableHeight}px`;
        this.motifOverlay.style.width = `${viewportWidth}px`;
        this.motifOverlay.style.height = `${availableHeight}px`;
        this.overlay.style.width = `${viewportWidth}px`;
        this.overlay.style.height = `${availableHeight}px`;

        const width = Math.max(1, Math.floor(viewportWidth * window.devicePixelRatio));
        const height = Math.max(1, Math.floor(availableHeight * window.devicePixelRatio));
        this.surfaceRenderer?.syncSize(width, height, viewportWidth, availableHeight);
        if (this.motifOverlay.width !== width || this.motifOverlay.height !== height) {
            this.motifOverlay.width = width;
            this.motifOverlay.height = height;
            this.overlay.width = width;
            this.overlay.height = height;
        }
        this.renderOverlays();
    }

    setAlignmentSize(totalCols, totalRows, columnVisibility = null) {
        this.totalCols = columnVisibility?.visibleCount ?? totalCols;
        this.totalRows = totalRows;
        this.overlayPainter.setColumnVisibility(columnVisibility);
        this.contentWidth = this.totalCols * this.getRenderedCellWidthCss();
        this.contentHeight = totalRows * this.getRenderedCellHeightCss();
        this.applyContentSize();
    }

    scrollBy({ left = 0, top = 0 } = {}) {
        if (left !== 0) {
            this.horizontalScroller.scrollBy({ left });
        }
        if (top !== 0) {
            this.verticalScroller.scrollBy({ top });
        }
    }

    scrollTo(left, top) {
        this.horizontalScroller.scrollLeft = left;
        this.verticalScroller.scrollTop = top;
        this.interactionProxy.scrollLeft = left;
        this.interactionProxy.scrollTop = top;
    }
}
