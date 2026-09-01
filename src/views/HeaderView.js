/*
Draw the row headers, which are the labels on the left side of the MSA viewer.
This view renders row headers, synchronizing their vertical scroll position with the main MSA view.
*/
export class HeaderView {
    constructor({
        root,
        rowHeight,
        width = 180,
        fontFamily = "\"IBM Plex Mono\", \"IBM Plex Sans\", monospace",
        fontSize = 14,
        onRowClick = null,
    }) {
        this.root = root;
        this.rowHeight = rowHeight;
        this.width = width;
        this.fontFamily = fontFamily;
        this.fontSize = fontSize;
        this.onRowClick = typeof onRowClick === "function" ? onRowClick : null;
        this.rowStyles = new Map();
        this.records = [];
        this.scrollTop = 0;
        this.viewportHeight = 0;
        this.renderedRowStart = -1;
        this.renderedRowEnd = -1;
        this.overscanRows = 8;

        this.track = document.createElement("div");
        this.track.className = "msa-headers-track";
        this.rowWindow = document.createElement("div");
        this.rowWindow.style.position = "absolute";
        this.rowWindow.style.inset = "0 auto auto 0";
        this.rowWindow.style.width = "100%";
        this.track.appendChild(this.rowWindow);
        this.root.appendChild(this.track);
        this.root.style.setProperty("--row-height", `${this.rowHeight}px`);
        this.applyStyles();
        this.bindEvents();
        this.track.style.cursor = this.onRowClick ? "pointer" : "";
    }
    applyStyles() {
        this.root.style.setProperty("--msa-header-view-width", `${this.width}px`);
        this.root.style.setProperty("--msa-header-font-family", this.fontFamily);
        this.root.style.setProperty("--msa-header-font-size", `${this.fontSize}px`);
    }
    bindEvents() {
        this.onClick = (event) => {
            const rowEl = event.target instanceof Element
                ? event.target.closest(".msa-header-row")
                : null;
            if (!rowEl) return;
            const rowIndex = Number.parseInt(rowEl.dataset.rowIndex ?? "", 10);
            if (!Number.isInteger(rowIndex)) return;
            this.onRowClick?.(rowIndex, event);
        };
        this.track.addEventListener("click", this.onClick);
    }
    setRowHeight(rowHeight) { 
        if (this.rowHeight === rowHeight) return;
        this.rowHeight = rowHeight;
        this.root.style.setProperty("--row-height", `${this.rowHeight}px`);
        this.track.style.height = `${Math.max(1, this.records.length * this.rowHeight)}px`;
        this.renderedRowStart = -1;
        this.renderedRowEnd = -1;
        this.renderVisibleRows();
    }
    setFontSize(fontSize) {
        if (this.fontSize === fontSize) return;
        this.fontSize = fontSize;
        this.root.style.setProperty("--msa-header-font-size", `${this.fontSize}px`);
    }
    setViewportHeight(height) {
        this.viewportHeight = Math.max(1, height);
        const nextHeight = `${this.viewportHeight}px`;
        this.root.style.height = nextHeight;
        this.renderVisibleRows();
    }
    setRowStyles(rowStyles = []) {
        this.rowStyles = new Map(rowStyles.map((style) => [style.rowIndex, style]));
        this.applyRowStyles();
    }
    clearRowStyles() {
        this.rowStyles.clear();
        this.applyRowStyles();
    }
    applyRowStyles() {
        for (const rowEl of this.rowWindow.children) {
            const rowIndex = Number.parseInt(rowEl.dataset.rowIndex ?? "", 10);
            const style = this.rowStyles.get(rowIndex);
            rowEl.style.backgroundColor = style?.headerBackground ?? "";
            rowEl.style.color = style?.headerColor ?? "";
        }
    }

    renderVisibleRows() {
        if (this.records.length === 0) {
            this.rowWindow.replaceChildren();
            this.renderedRowStart = 0;
            this.renderedRowEnd = 0;
            return;
        }
        const viewportHeight = Math.max(this.rowHeight, this.viewportHeight || this.root.clientHeight || 0);
        const visibleStart = Math.floor(this.scrollTop / this.rowHeight);
        const visibleEnd = Math.ceil((this.scrollTop + viewportHeight) / this.rowHeight);
        if (
            visibleStart >= this.renderedRowStart
            && visibleEnd <= this.renderedRowEnd
        ) {
            return;
        }
        const rowStart = Math.max(0, visibleStart - this.overscanRows);
        const rowEnd = Math.min(this.records.length, visibleEnd + this.overscanRows);
        if (rowStart === this.renderedRowStart && rowEnd === this.renderedRowEnd) return;

        this.rowWindow.replaceChildren();
        this.rowWindow.style.transform = `translateY(${rowStart * this.rowHeight}px)`;
        for (let rowIndex = rowStart; rowIndex < rowEnd; rowIndex += 1) {
            const record = this.records[rowIndex];
            const headerCell = document.createElement("div");
            headerCell.className = "msa-header-row";
            headerCell.dataset.rowIndex = String(rowIndex);
            headerCell.textContent = record.name;
            this.rowWindow.appendChild(headerCell);
        }
        this.renderedRowStart = rowStart;
        this.renderedRowEnd = rowEnd;
        this.applyRowStyles();
    }

    renderRecords(records = []) {
        this.records = records;
        const trackHeight = Math.max(1, this.records.length * this.rowHeight);
        this.track.style.height = `${trackHeight}px`;
        this.renderedRowStart = -1;
        this.renderedRowEnd = -1;
        this.renderVisibleRows();
    }
    syncScroll(scrollTop) {
        this.scrollTop = scrollTop;
        this.track.style.transform = `translateY(${-scrollTop}px)`;
        this.renderVisibleRows();
    }
    clear() {
        this.records = [];
        this.scrollTop = 0;
        this.rowWindow.replaceChildren();
        this.track.style.height = "0px";
        this.track.style.transform = "translateY(0px)";
        this.renderedRowStart = 0;
        this.renderedRowEnd = 0;
    }
    destroy() {
        if (this.onClick) {
            this.track.removeEventListener("click", this.onClick);
        }
        this.clear();
    }
}
