/*
Draw the row headers, which are the labels on the left side of the MSA viewer.
This view renders row headers, synchronizing their vertical scroll position with the main MSA view.
*/
export class HeaderView {
    constructor({ root, rowHeight }) {
        this.root = root;
        this.rowHeight = rowHeight;

        this.scrollport = document.createElement("div");
        this.scrollport.className = "msa-headers-scrollport";

        this.track = document.createElement("div");
        this.track.className = "msa-headers-track";
        this.scrollport.appendChild(this.track);
        this.root.appendChild(this.scrollport);
        this.root.style.setProperty("--row-height", `${this.rowHeight}px`);
        this.applyStyles();
    }
    applyStyles() {
        Object.assign(this.root.style, {
            position: "relative",
            height: "100%",
            maxWidth: "300px",
            minWidth: "0",
            overflow: "hidden",
            backgroundColor: "var(--header-bg)",
            borderRight: "1px solid var(--header-border)",
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
        for (const record of records) {
            const headerCell = document.createElement("div");
            headerCell.className = "msa-header-row";
            headerCell.textContent = record.name;
            Object.assign(headerCell.style, {
                display: "flex",
                alignItems: "center",
                height: "var(--row-height)",
                padding: "0 8px",
                fontSize: "14px",
                lineHeight: "1",
                boxSizing: "border-box",
                width: "max-content",
                maxWidth: "300px",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                fontFamily: "\"IBM Plex Mono\", \"IBM Plex Sans\", monospace",
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
}
