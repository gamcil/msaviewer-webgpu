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
        this.hoveredColumn = null;
    }

    bind() {
        if (!this.alignmentView) return;

        this.alignmentView.scroller.onmousemove = (event) => {
            if (this.getIsScrolling?.()) return;
            const [col] = this.getCoordsFromEvent(event);
            this.setHoveredColumn(col);
        };

        this.alignmentView.scroller.onpointerleave = () => {
            this.clearHover();
        };

        this.alignmentView.scroller.onclick = (event) => {
            const [col] = this.getCoordsFromEvent(event);
            this.toggleColumn(col);
        };
    }

    destroy() {
        if (!this.alignmentView) return;
        this.alignmentView.scroller.onmousemove = null;
        this.alignmentView.scroller.onpointerleave = null;
        this.alignmentView.scroller.onclick = null;
    }

    syncOverlay(selectedColumns = this.state.getSnapshot().selection.columns) {
        if (!this.alignmentView) return;
        this.alignmentView.setOverlayState({
            hoveredColumn: this.hoveredColumn,
            selectedColumns,
        });
    }

    setHoveredColumn(col) {
        if (this.hoveredColumn === col) return;
        this.hoveredColumn = col;
        this.syncOverlay();
    }

    clearHover() {
        if (this.hoveredColumn === null) return;
        this.hoveredColumn = null;
        this.syncOverlay();
    }

    toggleColumn(col) {
        this.state.toggleSelectedColumn(col);
    }

    getSelectedColumns() {
        return new Set(this.state.getSnapshot().selection.columns);
    }

    setSelectedColumns(columns) {
        this.state.setSelectedColumns(new Set(columns));
    }

    clearSelectedColumns() {
        this.state.setSelectedColumns(new Set());
    }

    onSelectionChange(callback) {
        let prev = null;
        return this.state.subscribe((snapshot) => {
            const next = snapshot.selection.columns;
            if (next === prev) return;
            prev = next;
            callback(new Set(next));
        });
    }
}
