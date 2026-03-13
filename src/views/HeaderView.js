/*
Draw the row headers, which are the labels on the left side of the MSA viewer.
This view renders row headers, synchronizing their vertical scroll position with the main MSA view.
*/
export class HeaderView {
    constructor({ root, rowHeight }) {
        this.root = root;
        this.rowHeight = rowHeight;

        this.track = document.createElement("div");
        this.track.className = "msa-headers-track";
        this.root.appendChild(this.track);
        this.root.style.setProperty("--row-height", `${this.rowHeight}px`);
    }
    setRowHeight(rowHeight) { 
        if (this.rowHeight === rowHeight) return;
        this.rowHeight = rowHeight;
        this.root.style.setProperty("--row-height", `${this.rowHeight}px`);
    }
    renderRecords(records) {
        this.track.replaceChildren();
        for (const record of records) {
            const headerCell = document.createElement("div");
            headerCell.className = "msa-header-row";
            headerCell.textContent = record.name;
            this.track.appendChild(headerCell);
        }
        this.track.style.height = `${Math.max(1, records.length * this.rowHeight)}px`;
    }
    syncScroll(scrollTop) {
        this.track.style.transform = `translateY(${-scrollTop}px)`;
    }
    clear() {
        this.track.replaceChildren();
        this.track.style.height = "0px";
    }
}