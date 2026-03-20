/*
Base class for sequence score tracks
*/

export class BaseTrackView {
    constructor({ root, height, id, label }) {
        this.root = root;
        this.id = id;
        this.height = height;
        this.label = label;

        this.viewport = null;
        this.data = null;
        
        this.root.classList.add("msa-track-row");

        this.labelEl = document.createElement("div");
        this.labelEl.className = "msa-track-label";
        this.labelEl.textContent = label;

        this.bodyEl = document.createElement("div");
        this.bodyEl.className = "msa-track-body";
        
        this.canvas = document.createElement("canvas");
        this.canvas.className = "msa-track-canvas";
        
        this.bodyEl.appendChild(this.canvas);
        this.root.appendChild(this.labelEl);
        this.root.appendChild(this.bodyEl);

        this.context = this.canvas.getContext("2d");
    }

    setViewport(viewport) {
        this.viewport = viewport;
        this.render();
    }

    setData(data) {
        this.data = data;
        this.render();
    }
    
    ensureCanvasSize() {
        const dpr = window.devicePixelRatio || 1;
        const cssWidth = this.bodyEl.getBoundingClientRect().width;
        this.root.style.height = `${this.height}px`;
        this.bodyEl.style.height = `${this.height}px`;
        this.bodyEl.style.width = "100%";
        this.canvas.style.width = `${cssWidth}px`;
        this.canvas.style.height = `${this.height}px`;

        const width = Math.max(1, Math.round(cssWidth * dpr));
        const height = Math.max(1, Math.floor(this.height * dpr));

        if (this.canvas.width !== width || this.canvas.height !== height) {
            this.canvas.width = width;
            this.canvas.height = height;
        }
    }
    
    clear() {
        this.ensureCanvasSize();
        this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }

    render() {
        // overwrite this in inherited classes
        this.clear();
    }
    
    destroy() {
        this.root.replaceChildren();
    }
}
