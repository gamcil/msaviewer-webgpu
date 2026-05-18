/*
View for the alignment itself
*/

import { AlignmentOverlayPainter } from "./helpers/AlignmentOverlayPainter.js";

const ALIGNMENT_VIEW_TEMPLATE = `
<div data-view="topRow" class="msa-alignment-top-row">
    <div data-view="corner" class="msa-alignment-corner"></div>
    <div data-view="rulerSlot" class="msa-ruler-body"></div>
</div>
<div data-view="bodyRow" class="msa-alignment-body-row">
    <div data-view="leftColumn" class="msa-alignment-left-column">
        <div data-view="headerSlot" class="msa-headers"></div>
        <div data-view="trackLabelSlot" class="msa-track-label-stack"></div>
    </div>
    <div data-view="contentColumn" class="msa-alignment-content-column">
        <div data-view="horizontalScroller" class="msa-alignment-horizontal-scroller">
            <div data-view="contentStack" class="msa-alignment-content-stack">
                <div data-view="alignmentShell" class="msa-alignment-viewport">
                    <div data-view="verticalScroller" class="msa-alignment-vertical-scroller">
                        <div data-view="spacer" class="msa-alignment-spacer"></div>
                    </div>
                    <canvas data-view="motifOverlay" class="msa-alignment-motif-canvas"></canvas>
                    <canvas data-view="overlay" class="msa-alignment-overlay-canvas"></canvas>
                    <div data-view="interactionProxy" class="msa-alignment-interaction-proxy">
                        <div data-view="proxySpacer" class="msa-alignment-spacer"></div>
                    </div>
                </div>
                <div data-view="trackBodySlot" class="msa-track-body-stack"></div>
            </div>
        </div>
    </div>
</div>
`;

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

        this.root.replaceChildren();
        this.root.insertAdjacentHTML("beforeend", ALIGNMENT_VIEW_TEMPLATE);
        for (const el of this.root.querySelectorAll("[data-view]")) {
            this[el.dataset.view] = el;
        }
        this.canvas = this.surfaceRenderer.canvas;
        this.alignmentShell.insertBefore(this.canvas, this.motifOverlay);
        this.motifContext = this.motifOverlay.getContext("2d");
        this.overlayContext = this.overlay.getContext("2d");
        this.scroller = this.verticalScroller;

        this.overlayPainter = new AlignmentOverlayPainter({
            root: this.alignmentShell,
            motifOverlay: this.motifOverlay,
            motifContext: this.motifContext,
            overlay: this.overlay,
            overlayContext: this.overlayContext,
        });

        this.scrollListeners = new Set();
        this.bindScrollSync();
        this.syncViewportChrome();
        this.setLoadedState(true);
    }

    onScroll(callback) {
        this.scrollListeners.add(callback);
        return () => this.scrollListeners.delete(callback);
    }

    notifyScroll() {
        for (const callback of this.scrollListeners) {
            callback();
        }
    }

    setScrollLeft(element, value) {
        if (Math.abs(element.scrollLeft - value) > 0.5) {
            element.scrollLeft = value;
        }
    }

    setScrollTop(element, value) {
        if (Math.abs(element.scrollTop - value) > 0.5) {
            element.scrollTop = value;
        }
    }

    bindScrollSync() {
        this.onProxyScroll = () => {
            this.setScrollLeft(this.horizontalScroller, this.interactionProxy.scrollLeft);
            this.setScrollTop(this.verticalScroller, this.interactionProxy.scrollTop);
            this.notifyScroll();
        };
        this.onHorizontalScroll = () => {
            this.setScrollLeft(this.interactionProxy, this.horizontalScroller.scrollLeft);
            this.notifyScroll();
        };
        this.onVerticalScroll = () => {
            this.setScrollTop(this.interactionProxy, this.verticalScroller.scrollTop);
            this.notifyScroll();
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

    getVScrollbarWidth() {
        return Math.max(0, this.verticalScroller.offsetWidth - this.verticalScroller.clientWidth);
    }

    getViewportWidthCss() {
        const shellWidth = this.alignmentShell.clientWidth || this.horizontalScroller.clientWidth || this.contentColumn.clientWidth || 0;
        return Math.max(1, shellWidth - this.getVScrollbarWidth());
    }

    getViewportHeightCss() {
        return Math.max(1, this.verticalScroller.clientHeight || this.alignmentShell.clientHeight || 0);
    }

    getViewportBounds() {
        const bounds = this.alignmentShell.getBoundingClientRect();
        return {
            left: bounds.left,
            top: bounds.top,
            width: Math.max(1, (this.alignmentShell.clientWidth || bounds.width) - this.getVScrollbarWidth()),
            height: Math.max(1, this.verticalScroller.clientHeight || bounds.height),
        };
    }

    getInteractionTarget() {
        return this.interactionProxy;
    }

    getHScrollbarHeight() {
        return Math.max(0, this.horizontalScroller.offsetHeight - this.horizontalScroller.clientHeight);
    }

    applyContentSize() {
        this.contentStack.style.width = `${Math.max(1, this.contentWidth, this.horizontalScroller.clientWidth || 0)}px`;
        const spacerWidth = `${Math.max(1, this.contentWidth)}px`;
        const spacerHeight = `${this.contentHeight}px`;
        for (const spacer of [this.spacer, this.proxySpacer]) {
            spacer.style.width = spacerWidth;
            spacer.style.height = spacerHeight;
        }
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
        const hScrollbarHeight = this.getHScrollbarHeight();
        const trackStackHeight = this.trackBodySlot.hidden ? 0 : this.trackBodySlot.offsetHeight;
        const availableHeight = Math.max(
            1,
            (this.bodyRow.clientHeight || this.root.clientHeight || 0) - trackStackHeight,
        );
        const shellWidth = Math.max(1, this.contentColumn.clientWidth || this.horizontalScroller.clientWidth || this.root.clientWidth || 0);
        const viewportWidth = Math.max(1, shellWidth - this.getVScrollbarWidth());

        this.alignmentShell.style.width = `${shellWidth}px`;
        this.alignmentShell.style.height = `${availableHeight}px`;
        this.verticalScroller.style.width = `${shellWidth}px`;
        this.verticalScroller.style.height = `${availableHeight}px`;
        this.trackBodySlot.style.width = `${viewportWidth}px`;
        this.trackBodySlot.style.paddingBottom = `${hScrollbarHeight}px`;
        this.headerSlot.style.height = `${availableHeight}px`;
        this.contentStack.style.paddingBottom = "0px";
        this.applyContentSize();

        const canvasWidth = `${viewportWidth}px`;
        const canvasHeight = `${availableHeight}px`;
        for (const canvas of [this.canvas, this.motifOverlay, this.overlay]) {
            canvas.style.left = "0";
            canvas.style.top = "0";
            canvas.style.width = canvasWidth;
            canvas.style.height = canvasHeight;
        }

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
        this.notifyScroll();
    }
}
