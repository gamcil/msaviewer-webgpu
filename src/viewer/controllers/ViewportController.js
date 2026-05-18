export class ViewportController {
    constructor({
        state,
        alignmentView,
        headerView,
        rulerView,
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
        this.rulerView = rulerView;
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
        this.scrollFrameHandle = 0;
        this.scrollEndTimeoutHandle = 0;
        this.scrolling = false;
        this.lastObservedWidth = -1;
        this.lastObservedHeight = -1;
    }

    getViewportWidth() {
        return this.alignmentView?.getViewportWidthCss?.() ?? this.alignmentView?.scroller?.clientWidth ?? 0;
    }

    getViewportHeight() {
        return this.alignmentView?.getViewportHeightCss?.() ?? this.alignmentView?.scroller?.clientHeight ?? 0;
    }

    getScrollLeft() {
        return this.alignmentView?.getScrollLeft?.() ?? this.alignmentView?.scroller?.scrollLeft ?? 0;
    }

    getScrollTop() {
        return this.alignmentView?.getScrollTop?.() ?? this.alignmentView?.scroller?.scrollTop ?? 0;
    }

    bind() {
        if (!this.alignmentView) return;
        const verticalScrollElement = this.alignmentView.getVerticalScrollElement?.() ?? this.alignmentView.scroller;
        const horizontalScrollElement = this.alignmentView.getHorizontalScrollElement?.() ?? this.alignmentView.scroller;

        this.onScroll = () => this.scheduleScrollFrame();

        this.onScrollEnd = () => {
            if (this.scrollEndTimeoutHandle) {
                window.clearTimeout(this.scrollEndTimeoutHandle);
                this.scrollEndTimeoutHandle = 0;
            }
            this.setScrolling(false);
        };

        this.onResize = () => this.refreshLayout();

        if (typeof this.alignmentView.onScroll === "function") {
            this.unsubscribeScroll = this.alignmentView.onScroll(this.onScroll);
        } else {
            verticalScrollElement?.addEventListener("scroll", this.onScroll);
            if (horizontalScrollElement && horizontalScrollElement !== verticalScrollElement) {
                horizontalScrollElement.addEventListener("scroll", this.onScroll);
            }
        }
        verticalScrollElement?.addEventListener("scrollend", this.onScrollEnd);
        if (horizontalScrollElement && horizontalScrollElement !== verticalScrollElement) {
            horizontalScrollElement.addEventListener("scrollend", this.onScrollEnd);
        }
        window.addEventListener("resize", this.onResize);
        if (typeof ResizeObserver !== "undefined") {
            this.resizeObserver = new ResizeObserver(() => {
                const width = this.getViewportWidth();
                const height = this.getViewportHeight();
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
            const viewportWidth = this.getViewportWidth();
            const viewportHeight = this.getViewportHeight();
            const { cellWidth, cellHeight } = this.state.getCellSize();
            const visibleCount = this.getColumnVisibility?.()?.visibleCount ?? alignmentStore.totalCols;
            const contentWidth = visibleCount * cellWidth;
            const contentHeight = alignmentStore.totalRows * cellHeight;
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

    setScrolling(scrolling) {
        if (this.scrolling === scrolling) return;
        this.scrolling = scrolling;
        this.onSetScrolling?.(scrolling);
    }

    scheduleScrollFrame() {
        this.setScrolling(true);
        if (this.scrollFrameHandle) return;
        this.scrollFrameHandle = window.requestAnimationFrame(() => {
            this.scrollFrameHandle = 0;
            this.onHoverReset?.();
            this.state.setViewportScroll(this.getScrollLeft(), this.getScrollTop());
            if (this.getAlignmentStore()) {
                void this.uploadVisibleWindow?.();
            }
            this.requestRender?.();
            this.alignmentView.renderOverlays?.();
            this.headerView?.syncScroll?.(this.getScrollTop());
            this.syncMinimapViewportRect();
            this.syncRulerViewport();
            this.syncTracksViewport();

            if (this.scrollEndTimeoutHandle) {
                window.clearTimeout(this.scrollEndTimeoutHandle);
            }
            this.scrollEndTimeoutHandle = window.setTimeout(() => {
                this.scrollEndTimeoutHandle = 0;
                this.setScrolling(false);
            }, 120);
        });
    }

    refreshLayout() {
        if (!this.alignmentView) return;
        const alignmentStore = this.getAlignmentStore();
        if (alignmentStore) {
            this.alignmentView.setAlignmentSize(
                alignmentStore.totalCols,
                alignmentStore.totalRows,
                this.getColumnVisibility?.() ?? null
            );
        }
        this.alignmentView.syncSurfaceSize();
        this.headerView?.setRowHeight?.(this.alignmentView.getRenderedCellHeightCss());
        this.headerView?.setViewportHeight(this.getViewportHeight());
        this.headerView?.syncScroll?.(this.getScrollTop());
        this.state.setCanvasSize(this.alignmentView.canvas.width, this.alignmentView.canvas.height);
        if (alignmentStore) {
            void this.uploadVisibleWindow?.();
        }
        this.requestRender?.();
        this.syncMinimapViewportRect();
        this.syncRulerViewport();
        this.syncTracksViewport();
    }

    destroy() {
        const verticalScrollElement = this.alignmentView?.getVerticalScrollElement?.() ?? this.alignmentView?.scroller ?? null;
        const horizontalScrollElement = this.alignmentView?.getHorizontalScrollElement?.() ?? this.alignmentView?.scroller ?? null;
        if (this.unsubscribeScroll) {
            this.unsubscribeScroll();
            this.unsubscribeScroll = null;
        } else if (verticalScrollElement && this.onScroll) {
            verticalScrollElement.removeEventListener("scroll", this.onScroll);
            if (horizontalScrollElement && horizontalScrollElement !== verticalScrollElement) {
                horizontalScrollElement.removeEventListener("scroll", this.onScroll);
            }
        }
        if (verticalScrollElement && this.onScrollEnd) {
            verticalScrollElement.removeEventListener("scrollend", this.onScrollEnd);
        }
        if (horizontalScrollElement && horizontalScrollElement !== verticalScrollElement && this.onScrollEnd) {
            horizontalScrollElement.removeEventListener("scrollend", this.onScrollEnd);
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
        if (this.scrollFrameHandle) {
            window.cancelAnimationFrame(this.scrollFrameHandle);
            this.scrollFrameHandle = 0;
        }
        if (this.scrollEndTimeoutHandle) {
            window.clearTimeout(this.scrollEndTimeoutHandle);
            this.scrollEndTimeoutHandle = 0;
        }
        if (this.minimapView?.onViewportRequest) {
            this.minimapView.onViewportRequest = null;
        }
    }

    buildHorizontalViewport({ overscanCols = 0 } = {}) {
        const alignmentStore = this.getAlignmentStore();
        if (!alignmentStore || !this.alignmentView) return null;
        const columnVisibility = this.getColumnVisibility?.() ?? null;
        const scrollLeft = this.getScrollLeft();
        const viewportWidth = this.getViewportWidth();
        const cellWidth = this.alignmentView.getRenderedCellWidthCss();
        const totalCols = columnVisibility?.visibleCount ?? alignmentStore.totalCols;
        const colStart = Math.max(0, Math.floor(scrollLeft / cellWidth) - overscanCols);
        const colEnd = Math.min(
            totalCols,
            Math.ceil((scrollLeft + viewportWidth) / cellWidth) + overscanCols
        );
        return {
            scrollLeft,
            viewportWidth,
            cellWidth,
            totalCols,
            colStart,
            colEnd,
            columnVisibility,
            visibleRawColumns: columnVisibility?.visibleToRaw?.subarray(colStart, colEnd) ?? null,
        };
    }

    getVisibleWindowBounds() {
        const alignmentStore = this.getAlignmentStore();
        const scrollLeft = this.getScrollLeft();
        const scrollTop = this.getScrollTop();
        const viewportWidth = this.getViewportWidth();
        const viewportHeight = this.getViewportHeight();
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
        const horizontalViewport = this.buildHorizontalViewport({ overscanCols: 2 });
        if (!horizontalViewport) return;
        for (const trackStackView of trackStackViews) {
            trackStackView.setViewport(horizontalViewport);
        }
    }

    syncRulerViewport() {
        if (!this.rulerView) return;
        const horizontalViewport = this.buildHorizontalViewport();
        if (!horizontalViewport) return;
        this.rulerView.setViewport(horizontalViewport);
    }

    syncMinimapViewportRect() {
        const alignmentStore = this.getAlignmentStore();
        if (!alignmentStore || !this.minimapController) return;
        this.minimapController.syncViewportRect({
            alignmentStore,
            scrollLeft: this.getScrollLeft(),
            scrollTop: this.getScrollTop(),
            viewportWidth: this.getViewportWidth(),
            viewportHeight: this.getViewportHeight(),
            ...this.state.getCellSize(),
            visibleColCount: this.getColumnVisibility?.()?.visibleCount ?? null,
        });
    }
}
