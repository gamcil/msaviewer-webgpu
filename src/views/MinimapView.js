/*
Minimap
*/
export class MinimapView {
    constructor({ root }) {
        this.root = root;
        this.viewportRect = null;
        this.imageData = null;
        this.imageWidth = 0;
        this.imageHeight = 0;
        this.resizeObserver = null;
        
        this.offscreen = document.createElement("canvas");
        this.offscreenContext = this.offscreen.getContext("2d", { alpha: false });

        this.track = document.createElement("div");
        this.track.className = "msa-minimap";
        this.track.style.width = "100%";
        this.track.style.height = "100%";
        this.track.style.position = "relative";
        
        this.minimap = document.createElement("canvas");
        this.minimap.className = "msa-minimap-canvas";
        this.minimap.style.width = "100%";
        this.minimap.style.height = "100%";
        this.minimap.style.display = "block";

        this.minimapOverlay = document.createElement("canvas");
        this.minimapOverlay.className = "msa-minimap-overlay";
        this.minimapOverlay.style.position = "absolute";
        this.minimapOverlay.style.inset = "0";
        this.minimapOverlay.style.width = "100%";
        this.minimapOverlay.style.height = "100%";
        this.minimapOverlay.style.display = "block";

        this.track.appendChild(this.minimap);
        this.track.appendChild(this.minimapOverlay);
        this.root.appendChild(this.track);

        this.minimapContext = this.minimap.getContext("2d", { alpha: false });
        this.overlayContext = this.minimapOverlay.getContext("2d");

        if (typeof ResizeObserver !== "undefined") {
            this.resizeObserver = new ResizeObserver(() => {
                this.redraw();
            });
            this.resizeObserver.observe(this.track);
        }
        
        this.applyStyles()
    }

    applyStyles() {
        Object.assign(this.root.style, {
            backgroundColor: "var(--header-bg)",
        });
    }
    
    getWidth() {
        const dpr = window.devicePixelRatio || 1;
        return Math.max(1, Math.round(this.track.clientWidth * dpr));
    }
    
    getHeight() {
        const dpr = window.devicePixelRatio || 1;
        return Math.max(1, Math.round(this.track.clientHeight * dpr));
    }
     
    setImageData(pixels, width, height) {
        this.imageWidth = width;
        this.imageHeight = height;
        this.offscreen.width = this.imageWidth;
        this.offscreen.height = this.imageHeight;
        this.imageData = new ImageData(pixels, width, height);
        this.redraw();
    }
    
    setViewportRect({ x, y, width, height }) {
        this.viewportRect = { x, y, width, height };
        this.drawOverlay();
    }
    
    clear() {
        this.imageData = null;
        this.imageWidth = 0;
        this.imageHeight = 0;
        this.viewportRect = null;
        this.minimap.width = 0;
        this.minimap.height = 0;
        this.minimapOverlay.width = 0;
        this.minimapOverlay.height = 0;
    }

    redraw() {
        this.drawBase();
        this.drawOverlay();
    }

    drawBase() {
        if (!this.minimapContext || !this.imageData) {
            return;
        }
        const width = this.getWidth();
        const height = this.getHeight();
        if (width <= 0 || height <= 0) {
            return;
        }
        if (this.minimap.width !== width || this.minimap.height !== height) {
            this.minimap.width = width;
            this.minimap.height = height;
        }
        this.minimapContext.clearRect(0, 0, width, height);
        this.minimapContext.imageSmoothingEnabled = true;
        this.offscreenContext.putImageData(this.imageData, 0, 0);
        this.minimapContext.drawImage(this.offscreen, 0, 0, width, height);
    }

    drawOverlay() {
        if (!this.overlayContext) {
            return;
        }
        const width = this.getWidth();
        const height = this.getHeight();
        if (width <= 0 || height <= 0) {
            return;
        }
        if (this.minimapOverlay.width !== width || this.minimapOverlay.height !== height) {
            this.minimapOverlay.width = width;
            this.minimapOverlay.height = height;
        }
        this.overlayContext.clearRect(0, 0, width, height);
        if (!this.viewportRect) {
            return;
        }
        const { x, y, width: rectWidth, height: rectHeight } = this.viewportRect;
        this.overlayContext.strokeStyle = "rgb(0, 122, 178)";
        this.overlayContext.lineWidth = Math.max(1, Math.round((window.devicePixelRatio || 1)));
        this.overlayContext.fillStyle = "rgba(89, 211, 255, 0.5)";
        this.overlayContext.fillRect(x, y, rectWidth, rectHeight);
        this.overlayContext.strokeRect(x + 0.5, y + 0.5, Math.max(0, rectWidth - 1), Math.max(0, rectHeight - 1));
    }
}
