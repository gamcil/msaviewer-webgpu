export class MinimapInteractionController {
    constructor({
        element,
        getViewportRect,
        getLocalCoordinates,
        getViewportSize,
        onViewportRequest,
    }) {
        this.element = element;
        this.getViewportRect = getViewportRect;
        this.getLocalCoordinates = getLocalCoordinates;
        this.getViewportSize = getViewportSize;
        this.onViewportRequest = onViewportRequest;
        this.isDragging = false;
        this.dragPointerId = 0;
        this.dragOffsetX = 0;
        this.dragOffsetY = 0;
        this.pendingDrag = null;
        this.dragFrame = 0;

        this.handlePointerDown = this.handlePointerDown.bind(this);
        this.handlePointerMove = this.handlePointerMove.bind(this);
        this.handlePointerEnd = this.handlePointerEnd.bind(this);
        this.clearDragState = this.clearDragState.bind(this);

        this.element.onpointerdown = this.handlePointerDown;
        this.element.onpointerup = this.handlePointerEnd;
        this.element.onpointercancel = this.handlePointerEnd;
        this.element.onlostpointercapture = this.clearDragState;
    }

    handlePointerDown(event) {
        const viewportRect = this.getViewportRect?.();
        if (!viewportRect) return;
        const { x: pointerX, y: pointerY } = this.getLocalCoordinates(event.clientX, event.clientY);
        const { width: minimapWidth, height: minimapHeight } = this.getViewportSize();
        const hitBuffer = 20;
        const insideRect =
            pointerX >= viewportRect.x - hitBuffer &&
            pointerX <= viewportRect.x + viewportRect.width + hitBuffer &&
            pointerY >= viewportRect.y - hitBuffer &&
            pointerY <= viewportRect.y + viewportRect.height + hitBuffer;
        if (!insideRect) {
            const centerXRatio = minimapWidth > 0 ? pointerX / minimapWidth : 0;
            const centerYRatio = minimapHeight > 0 ? pointerY / minimapHeight : 0;
            this.onViewportRequest?.({ type: "jump", centerXRatio, centerYRatio });
            this.dragOffsetX = viewportRect.width / 2;
            this.dragOffsetY = viewportRect.height / 2;
        } else {
            this.dragOffsetX = pointerX - viewportRect.x;
            this.dragOffsetY = pointerY - viewportRect.y;
        }
        this.isDragging = true;
        this.dragPointerId = event.pointerId;
        this.element.onpointermove = this.handlePointerMove;
        this.element.setPointerCapture(event.pointerId);
    }

    handlePointerMove(event) {
        if (!this.isDragging || event.pointerId !== this.dragPointerId) {
            return;
        }
        this.pendingDrag = {
            clientX: event.clientX,
            clientY: event.clientY,
        };
        if (this.dragFrame) return;
        this.dragFrame = requestAnimationFrame(() => {
            this.dragFrame = 0;
            const pending = this.pendingDrag;
            this.pendingDrag = null;
            if (pending) {
                this.emitDrag(pending.clientX, pending.clientY);
            }
        });
    }

    emitDrag(clientX, clientY) {
        const viewportRect = this.getViewportRect?.();
        if (!viewportRect || !this.isDragging) {
            return;
        }
        const { x: pointerX, y: pointerY } = this.getLocalCoordinates(clientX, clientY);
        const { width: minimapWidth, height: minimapHeight } = this.getViewportSize();
        const { width: rectWidth, height: rectHeight } = viewportRect;
        const rectLeft = Math.max(0, Math.min(pointerX - this.dragOffsetX, minimapWidth - rectWidth));
        const rectTop = Math.max(0, Math.min(pointerY - this.dragOffsetY, minimapHeight - rectHeight));
        const leftRatio = minimapWidth > rectWidth ? rectLeft / (minimapWidth - rectWidth) : 0;
        const topRatio = minimapHeight > rectHeight ? rectTop / (minimapHeight - rectHeight) : 0;
        this.onViewportRequest?.({ type: "drag", leftRatio, topRatio });
    }

    handlePointerEnd(event) {
        if (event.pointerId !== this.dragPointerId) return;
        this.clearDragState();
        this.element.onpointermove = null;
        this.element.releasePointerCapture(event.pointerId);
    }

    clearDragState() {
        this.isDragging = false;
        this.dragPointerId = 0;
        this.pendingDrag = null;
        if (this.dragFrame) {
            cancelAnimationFrame(this.dragFrame);
            this.dragFrame = 0;
        }
    }

    destroy() {
        this.element.onpointerdown = null;
        this.element.onpointermove = null;
        this.element.onpointerup = null;
        this.element.onpointercancel = null;
        this.element.onlostpointercapture = null;
        this.clearDragState();
    }
}
