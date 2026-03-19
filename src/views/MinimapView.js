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
        
        // draggable blue rectangle in overlay state
        this.isDragging = false;
        this.dragPointerId = 0;
        this.dragOffsetX = 0;
        this.dragOffsetY = 0;
        this.onViewportRequest = null;
        
        this.minimapOverlay.onpointerdown = this.handlePointerDown;
        this.minimapOverlay.onpointerup = this.handlePointerEnd;
        this.minimapOverlay.onpointercancel = this.handlePointerEnd;
        this.minimapOverlay.onlostpointercapture = this.clearDragState;
        
        this.track.appendChild(this.minimap);
        this.track.appendChild(this.minimapOverlay);
        this.root.appendChild(this.track);

        this.minimapContext = this.minimap.getContext("2d");
        this.overlayContext = this.minimapOverlay.getContext("2d");

        if (typeof ResizeObserver !== "undefined") {
            this.resizeObserver = new ResizeObserver(() => {
                this.redraw();
            });
            this.resizeObserver.observe(this.track);
        }
    }
    
    handlePointerDown = (event) => {
        if (!this.viewportRect) return;
        const { x: pointerX, y: pointerY } = this.getMinimapLocalCoordinates(event.clientX, event.clientY);
        const minimapWidth = this.getWidth();
        const minimapHeight = this.getHeight();
        const hitBuffer = 20;
        const insideRect = 
            pointerX >= this.viewportRect.x - hitBuffer &&
            pointerX <= this.viewportRect.x + this.viewportRect.width + hitBuffer &&
            pointerY >= this.viewportRect.y - hitBuffer &&
            pointerY <= this.viewportRect.y + this.viewportRect.height + hitBuffer;
        if (!insideRect) {
            const centerXRatio = minimapWidth > 0 ? pointerX / minimapWidth : 0;                
            const centerYRatio = minimapHeight > 0 ? pointerY / minimapHeight : 0;
            this.onViewportRequest?.({ type: "jump", centerXRatio, centerYRatio });
            this.dragOffsetX = this.viewportRect.width / 2;
            this.dragOffsetY = this.viewportRect.height / 2;
        } else {
            this.dragOffsetX = pointerX - this.viewportRect.x;
            this.dragOffsetY = pointerY - this.viewportRect.y;
        }
        this.isDragging = true;
        this.dragPointerId = event.pointerId;
        this.minimapOverlay.onpointermove = this.handlePointerMove;
        this.minimapOverlay.setPointerCapture(event.pointerId);       
    }
    
    handlePointerMove = (event) => {
        if (!this.viewportRect || !this.isDragging || event.pointerId !== this.dragPointerId) {
            return;
        }
        const { x: pointerX, y: pointerY } = this.getMinimapLocalCoordinates(event.clientX, event.clientY);
        const minimapWidth = this.getWidth();
        const minimapHeight = this.getHeight();
        const { width: rectWidth, height: rectHeight } = this.viewportRect;
        const rectLeft = Math.max(0, Math.min(pointerX - this.dragOffsetX, minimapWidth - rectWidth));
        const rectTop  = Math.max(0, Math.min(pointerY - this.dragOffsetY, minimapHeight - rectHeight));
        const leftRatio = minimapWidth > rectWidth ? rectLeft / (minimapWidth - rectWidth) : 0;
        const topRatio = minimapHeight > rectHeight ? rectTop / (minimapHeight - rectHeight) : 0;
        this.emitDragRequest(leftRatio, topRatio);
    }
    
    handlePointerEnd = (event) => {
        if (event.pointerId !== this.dragPointerId) return;
        this.clearDragState();
        this.minimapOverlay.onpointermove = null;
        this.minimapOverlay.releasePointerCapture(event.pointerId);
    }
    
    emitDragRequest(leftRatio, topRatio) {
        this.onViewportRequest?.({ type: "drag", leftRatio, topRatio });       
    }
    
    clearDragState() {
        this.isDragging = false;
        this.dragPointerId = 0;
    }
    
    getMinimapLocalCoordinates(x, y) {
        const bounds = this.minimapOverlay.getBoundingClientRect();
        const pointerX = (x - bounds.left) * (this.getWidth() / bounds.width);
        const pointerY = (y - bounds.top) * (this.getHeight() / bounds.height);
        return { x: pointerX, y: pointerY };
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
