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

        this.track = document.createElement("div");
        this.track.className = "msa-headers-track";
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
        if (this.track.childElementCount > 0) {
            this.track.style.height = `${Math.max(1, this.track.childElementCount * this.rowHeight)}px`;
        }
    }
    setViewportHeight(height) {
        const nextHeight = `${Math.max(1, height)}px`;
        if (this.root.style.height === nextHeight) return;
        this.root.style.height = nextHeight;
    }
    renderRecords(records) {
        this.track.replaceChildren();
        for (const [rowIndex, record] of records.entries()) {
            const headerCell = document.createElement("div");
            headerCell.className = "msa-header-row";
            headerCell.dataset.rowIndex = String(rowIndex);
            headerCell.textContent = record.name;
            this.track.appendChild(headerCell);
        }
        const trackHeight = Math.max(1, records.length * this.rowHeight);
        this.track.style.height = `${trackHeight}px`;
    }
    syncScroll(scrollTop) {
        this.track.style.transform = `translateY(${-scrollTop}px)`;
    }
    clear() {
        this.track.replaceChildren();
        this.track.style.height = "0px";
        this.track.style.transform = "translateY(0px)";
    }
    destroy() {
        if (this.onClick) {
            this.track.removeEventListener("click", this.onClick);
        }
        this.clear();
    }
}
