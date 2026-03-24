export class ViewportController {
    constructor({
        state,
        alignmentView,
        headerView,
        minimapView,
        getTrackStackViews,
        minimapController,
        getAlignmentStore,
        getColumnVisibility,
        getOverscanRows,
        getOverscanCols,
        uploadVisibleWindow,
        requestRender,
        onHoverReset,
        onSetScrolling,
    }) {
        this.state = state;
        this.alignmentView = alignmentView;
        this.headerView = headerView;
        this.minimapView = minimapView;
        this.getTrackStackViews = getTrackStackViews;
        this.minimapController = minimapController;
        this.getAlignmentStore = getAlignmentStore;
        this.getColumnVisibility = getColumnVisibility;
        this.getOverscanRows = getOverscanRows;
        this.getOverscanCols = getOverscanCols;
        this.uploadVisibleWindow = uploadVisibleWindow;
        this.requestRender = requestRender;
        this.onHoverReset = onHoverReset;
        this.onSetScrolling = onSetScrolling;
        this.resizeObserver = null;
        this.resizeFrameHandle = 0;
        this.lastObservedWidth = -1;
        this.lastObservedHeight = -1;
    }

    bind() {
        if (!this.alignmentView) return;

        this.onScroll = () => {
            this.onSetScrolling?.(true);
            this.onHoverReset?.();
            this.state.setViewportScroll(
                this.alignmentView.scroller.scrollLeft,
                this.alignmentView.scroller.scrollTop
            );
            if (this.getAlignmentStore()) {
                void this.uploadVisibleWindow?.();
            }
            this.requestRender?.();
            this.syncMinimapViewportRect();
            this.syncTracksViewport();
        };

        this.onScrollEnd = () => {
            this.onSetScrolling?.(false);
        };

        this.onResize = () => this.refreshLayout();

        this.alignmentView.scroller.addEventListener("scroll", this.onScroll);
        this.alignmentView.scroller.addEventListener("scrollend", this.onScrollEnd);
        window.addEventListener("resize", this.onResize);
        if (typeof ResizeObserver !== "undefined") {
            this.resizeObserver = new ResizeObserver(() => {
                const width = this.alignmentView?.scroller?.clientWidth ?? 0;
                const height = this.alignmentView?.scroller?.clientHeight ?? 0;
                if (width === this.lastObservedWidth && height === this.lastObservedHeight) {
                    return;
                }
                this.lastObservedWidth = width;
                this.lastObservedHeight = height;
                this.scheduleRefreshLayout();
            });
            this.resizeObserver.observe(this.alignmentView.root);
        }

        if (!this.minimapView) return;

        this.minimapView.onViewportRequest = (request) => {
            if (!request.type) return;
            const alignmentStore = this.getAlignmentStore();
            if (!alignmentStore) return;
            const viewportWidth = this.alignmentView.scroller.clientWidth;
            const viewportHeight = this.alignmentView.scroller.clientHeight;
            const snapshot = this.state.getSnapshot();
            const visibleCount = this.getColumnVisibility?.()?.visibleCount ?? alignmentStore.totalCols;
            const contentWidth = visibleCount * snapshot.viewport.cellWidth;
            const contentHeight = alignmentStore.totalRows * snapshot.viewport.cellHeight;
            const maxScrollLeft = Math.max(0, contentWidth - viewportWidth);
            const maxScrollTop = Math.max(0, contentHeight - viewportHeight);
            if (request.type === "drag") {
                const { leftRatio, topRatio } = request;
                this.alignmentView.scrollTo(leftRatio * maxScrollLeft, topRatio * maxScrollTop);
                return;
            }
            if (request.type === "jump") {
                const { centerXRatio, centerYRatio } = request;
                const scrollLeft = centerXRatio * contentWidth - viewportWidth / 2;
                const scrollTop = centerYRatio * contentHeight - viewportHeight / 2;
                this.alignmentView.scrollTo(
                    Math.max(0, Math.min(scrollLeft, maxScrollLeft)),
                    Math.max(0, Math.min(scrollTop, maxScrollTop)),
                );
            }
        };
    }

    scheduleRefreshLayout() {
        if (this.resizeFrameHandle) return;
        this.resizeFrameHandle = window.requestAnimationFrame(() => {
            this.resizeFrameHandle = 0;
            this.refreshLayout();
        });
    }

    refreshLayout() {
        if (!this.alignmentView) return;
        this.alignmentView.ensureCanvasSize();
        this.headerView?.setViewportHeight(this.alignmentView.scroller.clientHeight);
        this.state.setCanvasSize(this.alignmentView.canvas.width, this.alignmentView.canvas.height);
        if (this.getAlignmentStore()) {
            void this.uploadVisibleWindow?.();
        }
        this.requestRender?.();
        this.syncMinimapViewportRect();
        this.syncTracksViewport();
    }

    destroy() {
        if (this.alignmentView && this.onScroll) {
            this.alignmentView.scroller.removeEventListener("scroll", this.onScroll);
        }
        if (this.alignmentView && this.onScrollEnd) {
            this.alignmentView.scroller.removeEventListener("scrollend", this.onScrollEnd);
        }
        if (this.onResize) {
            window.removeEventListener("resize", this.onResize);
        }
        if (this.resizeObserver) {
            this.resizeObserver.disconnect();
            this.resizeObserver = null;
        }
        if (this.resizeFrameHandle) {
            window.cancelAnimationFrame(this.resizeFrameHandle);
            this.resizeFrameHandle = 0;
        }
        if (this.minimapView?.onViewportRequest) {
            this.minimapView.onViewportRequest = null;
        }
    }

    syncHeaderScroll(scrollTop) {
        this.headerView?.syncScroll(scrollTop);
    }

    getVisibleWindowBounds() {
        const alignmentStore = this.getAlignmentStore();
        const scrollLeft = this.alignmentView.scroller.scrollLeft;
        const scrollTop = this.alignmentView.scroller.scrollTop;
        const viewportWidth = this.alignmentView.scroller.clientWidth;
        const viewportHeight = this.alignmentView.scroller.clientHeight;
        const cellWidth = this.alignmentView.getRenderedCellWidthCss();
        const cellHeight = this.alignmentView.getRenderedCellHeightCss();
        const totalVisibleCols = this.getColumnVisibility?.()?.visibleCount ?? alignmentStore.totalCols;
        const rowStart = Math.max(0, Math.floor(scrollTop / cellHeight) - this.getOverscanRows());
        const rowEnd = Math.min(
            alignmentStore.totalRows,
            Math.ceil((scrollTop + viewportHeight) / cellHeight) + this.getOverscanRows()
        );
        const colStart = Math.max(0, Math.floor(scrollLeft / cellWidth) - this.getOverscanCols());
        const colEnd = Math.min(
            totalVisibleCols,
            Math.ceil((scrollLeft + viewportWidth) / cellWidth) + this.getOverscanCols()
        );
        return { rowStart, rowEnd, colStart, colEnd };
    }

    syncTracksViewport() {
        const trackStackViews = this.getTrackStackViews?.() ?? [];
        if (trackStackViews.length === 0) return;
        const alignmentStore = this.getAlignmentStore();
        if (!alignmentStore) return;
        const columnVisibility = this.getColumnVisibility?.() ?? null;
        const scrollLeft = this.alignmentView.scroller.scrollLeft;
        const viewportWidth = this.alignmentView.scroller.clientWidth;
        const cellWidth = this.alignmentView.getRenderedCellWidthCss();
        const totalCols = columnVisibility?.visibleCount ?? alignmentStore.totalCols;
        const colStart = Math.floor(scrollLeft / cellWidth);
        const colEnd = Math.min(totalCols, Math.ceil((scrollLeft + viewportWidth) / cellWidth));
        const visibleRawColumns = columnVisibility?.visibleToRaw?.subarray(colStart, colEnd) ?? null;
        for (const trackStackView of trackStackViews) {
            trackStackView.setViewport({
                scrollLeft,
                viewportWidth,
                cellWidth,
                totalCols,
                colStart,
                colEnd,
                columnVisibility,
                visibleRawColumns,
            });
        }
    }

    syncMinimapViewportRect() {
        const alignmentStore = this.getAlignmentStore();
        if (!alignmentStore || !this.minimapController) return;
        this.minimapController.syncViewportRect({
            alignmentStore,
            scrollLeft: this.alignmentView.scroller.scrollLeft,
            scrollTop: this.alignmentView.scroller.scrollTop,
            viewportWidth: this.alignmentView.scroller.clientWidth,
            viewportHeight: this.alignmentView.scroller.clientHeight,
            cellWidth: this.state.getSnapshot().viewport.cellWidth,
            cellHeight: this.state.getSnapshot().viewport.cellHeight,
            visibleColCount: this.getColumnVisibility?.()?.visibleCount ?? null,
        });
    }
}
