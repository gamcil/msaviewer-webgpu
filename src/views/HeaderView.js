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

        this.scrollport = document.createElement("div");
        this.scrollport.className = "msa-headers-scrollport";

        this.track = document.createElement("div");
        this.track.className = "msa-headers-track";
        this.scrollport.appendChild(this.track);
        this.root.appendChild(this.scrollport);
        this.root.style.setProperty("--row-height", `${this.rowHeight}px`);
        this.applyStyles();
        this.bindEvents();
        this.setOnRowClick(this.onRowClick);
    }
    applyStyles() {
        Object.assign(this.root.style, {
            position: "relative",
            height: "100%",
            width: `${this.width}px`,
            maxWidth: `${this.width}px`,
            minWidth: "0",
            overflow: "hidden",
            backgroundColor: "var(--msa-header-bg)",
            borderRight: "1px solid var(--msa-header-border)",
        });
        Object.assign(this.scrollport.style, {
            position: "relative",
            height: "100%",
            overflowX: "hidden",
            overflowY: "auto",
            scrollbarWidth: "none",
            msOverflowStyle: "none",
        });
        Object.assign(this.track.style, {
            position: "relative",
            width: "max-content",
            minWidth: "100%",
        });
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
    setOnRowClick(onRowClick) {
        this.onRowClick = typeof onRowClick === "function" ? onRowClick : null;
        this.track.style.cursor = this.onRowClick ? "pointer" : "";
    }
    setRowHeight(rowHeight) { 
        if (this.rowHeight === rowHeight) return;
        this.rowHeight = rowHeight;
        this.root.style.setProperty("--row-height", `${this.rowHeight}px`);
    }
    setViewportHeight(height) {
        const nextHeight = `${Math.max(1, height)}px`;
        if (this.scrollport.style.height === nextHeight) return;
        this.scrollport.style.height = nextHeight;
    }
    renderRecords(records) {
        this.track.replaceChildren();
        for (const [rowIndex, record] of records.entries()) {
            const headerCell = document.createElement("div");
            headerCell.className = "msa-header-row";
            headerCell.dataset.rowIndex = String(rowIndex);
            headerCell.textContent = record.name;
            Object.assign(headerCell.style, {
                display: "flex",
                alignItems: "center",
                height: "var(--row-height)",
                padding: "0 8px",
                fontSize: `${this.fontSize}px`,
                lineHeight: "1",
                boxSizing: "border-box",
                width: "max-content",
                maxWidth: `${this.width}px`,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                fontFamily: this.fontFamily,
            });
            this.track.appendChild(headerCell);
        }
        this.track.style.height = `${Math.max(1, records.length * this.rowHeight)}px`;
    }
    syncScroll(scrollTop) {
        this.scrollport.scrollTop = scrollTop;
    }
    clear() {
        this.track.replaceChildren();
        this.track.style.height = "0px";
        this.scrollport.scrollTop = 0;
    }
    destroy() {
        if (this.onClick) {
            this.track.removeEventListener("click", this.onClick);
        }
        this.clear();
    }
}
