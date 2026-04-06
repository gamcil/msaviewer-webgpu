export class SelectionController {
    constructor({
        state,
        alignmentView,
        getCoordsFromEvent,
        getIsScrolling,
    }) {
        this.state = state;
        this.alignmentView = alignmentView;
        this.getCoordsFromEvent = getCoordsFromEvent;
        this.getIsScrolling = getIsScrolling;
        this.hoveredCell = null;
        this.previewRange = null;
        this.dragAnchor = null;
        this.dragBounds = null;
        this.dragMode = null;
        this.isDragging = false;
        this.windowDragListenersAttached = false;
    }

    bind() {
        if (!this.alignmentView) return;
        const interactionTarget = this.alignmentView.getInteractionTarget?.() ?? this.alignmentView.scroller;

        this.onMouseMove = (event) => {
            if (this.isDragging || this.getIsScrolling?.()) return;
            const coords = this.getCoordsFromEvent(event);
            if (!coords) {
                this.clearHover();
                return;
            }
            const [col, row] = coords;
            this.setHoveredCell(col, row);
        };

        this.onMouseLeave = () => {
            if (!this.isDragging) {
                this.clearHover();
            }
        };

        this.onMouseDown = (event) => {
            if (event.button !== 0 || this.getIsScrolling?.()) return;
            const coords = this.getCoordsFromEvent(event);
            if (!coords) return;
            this.startDrag(event);
        };

        this.onWindowMouseMove = (event) => {
            if (!this.isDragging) return;
            this.updatePreviewFromPointer(event);
        };

        this.onWindowMouseUp = (event) => {
            if (!this.isDragging || event.button !== 0) return;
            const committedRange = this.updatePreviewFromPointer(event);
            if (committedRange) this.state.appendSelectionRanges([committedRange]);
            this.resetDrag();
        };

        interactionTarget.addEventListener("mousemove", this.onMouseMove);
        interactionTarget.addEventListener("mouseleave", this.onMouseLeave);
        interactionTarget.addEventListener("mousedown", this.onMouseDown);
    }

    destroy() {
        if (!this.alignmentView) return;
        const interactionTarget = this.alignmentView.getInteractionTarget?.() ?? this.alignmentView.scroller;
        interactionTarget.removeEventListener("mousemove", this.onMouseMove);
        interactionTarget.removeEventListener("mouseleave", this.onMouseLeave);
        interactionTarget.removeEventListener("mousedown", this.onMouseDown);
        this.detachWindowDragListeners();
    }

    attachWindowDragListeners() {
        if (this.windowDragListenersAttached) return;
        window.addEventListener("mousemove", this.onWindowMouseMove);
        window.addEventListener("mouseup", this.onWindowMouseUp);
        this.windowDragListenersAttached = true;
    }

    detachWindowDragListeners() {
        if (!this.windowDragListenersAttached) return;
        window.removeEventListener("mousemove", this.onWindowMouseMove);
        window.removeEventListener("mouseup", this.onWindowMouseUp);
        this.windowDragListenersAttached = false;
    }

    startDrag(event) {
        const coords = this.getCoordsFromEvent(event);
        if (!coords) return;
        const [col, row] = coords;
        const { totalCols, totalRows } = this.state.getAlignmentBounds();
        this.dragAnchor = { col, row };
        this.dragBounds = { totalCols, totalRows };
        this.dragMode = this.state.getSelectionMode();
        this.isDragging = true;
        this.attachWindowDragListeners();
        this.setPreviewRange(this.createSelectionRange(col, row, col, row));
    }

    updatePreviewFromPointer(event) {
        const coords = this.getCoordsFromEvent(event);
        if (!coords) {
            return this.previewRange;
        }
        const [col, row] = coords;
        this.setPreviewRange(this.createSelectionRange(
            this.dragAnchor.col,
            this.dragAnchor.row,
            col,
            row,
        ));
        return this.previewRange;
    }

    resetDrag() {
        this.detachWindowDragListeners();
        this.setPreviewRange(null);
        this.dragAnchor = null;
        this.dragBounds = null;
        this.dragMode = null;
        this.isDragging = false;
    }

    setPreviewRange(previewRange) {
        this.previewRange = previewRange;
        this.syncOverlay();
    }

    createSelectionRange(anchorCol, anchorRow, currentCol, currentRow) {
        const { totalCols, totalRows } = this.dragBounds ?? this.state.getAlignmentBounds();
        const mode = this.dragMode ?? this.state.getSelectionMode();
        if (mode === "row") {
            const rowStart = Math.max(0, Math.min(anchorRow, currentRow));
            const rowEnd = Math.min(totalRows, Math.max(anchorRow, currentRow) + 1);
            return { colStart: 0, colEnd: totalCols, rowStart, rowEnd };
        }
        if (mode === "cell") {
            const colStart = Math.max(0, Math.min(anchorCol, currentCol));
            const colEnd = Math.min(totalCols, Math.max(anchorCol, currentCol) + 1);
            const rowStart = Math.max(0, Math.min(anchorRow, currentRow));
            const rowEnd = Math.min(totalRows, Math.max(anchorRow, currentRow) + 1);
            return { colStart, colEnd, rowStart, rowEnd };
        }
        const colStart = Math.max(0, Math.min(anchorCol, currentCol));
        const colEnd = Math.min(totalCols, Math.max(anchorCol, currentCol) + 1);
        return { colStart, colEnd, rowStart: 0, rowEnd: totalRows };
    }

    syncOverlay(selection = this.state.getSelectionSnapshot()) {
        if (!this.alignmentView) return;
        this.alignmentView.setOverlayState({
            hoveredCell: this.hoveredCell,
            selectionMode: selection.mode,
            selectionRanges: selection.ranges,
            previewRange: this.previewRange,
        });
    }

    setHoveredCell(col, row) {
        if (this.hoveredCell?.col === col && this.hoveredCell?.row === row) return;
        this.hoveredCell = { col, row };
        this.syncOverlay();
    }

    clearHover() {
        if (this.hoveredCell === null) return;
        this.hoveredCell = null;
        this.syncOverlay();
    }

    getSelection() {
        return this.state.getSelectionSnapshot();
    }

    setSelection({ mode, ranges } = {}) {
        if (mode != null) {
            this.state.setSelectionMode(mode);
        }
        if (ranges != null) {
            this.state.setSelectionRanges(ranges);
        }
    }

    clearSelection() {
        this.state.clearSelection();
    }

    setSelectionMode(mode) {
        this.state.setSelectionMode(mode);
        this.resetDrag();
    }

    onSelectionChange(callback) {
        return this.state.subscribeSelection(callback);
    }
}
