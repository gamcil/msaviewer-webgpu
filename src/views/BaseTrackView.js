/*
Base class for sequence score tracks
*/

export class BaseTrackView {
    constructor({
        root,
        height,
        id,
        label,
        sublabel = null,
        metric = null,
        valueRange = null,
        tooltip = null,
    }) {
        this.root = root;
        this.id = id;
        this.height = height;
        this.label = label;
        this.sublabel = sublabel;
        this.metric = metric ?? id;
        this.tooltip = tooltip;
        this.valueRange = valueRange ? {
            min: valueRange.min ?? 0,
            max: valueRange.max ?? 1,
        } : null;

        this.viewport = null;
        this.data = null;
        this.trackState = null;
        this.theme = null;
        
        this.root.classList.add("msa-track-row");

        this.labelEl = document.createElement("div");
        this.labelEl.className = "msa-track-label";

        this.labelTextEl = document.createElement("div");
        this.labelTextEl.className = "msa-track-label-text";
        this.labelTextEl.textContent = label;
        this.labelEl.appendChild(this.labelTextEl);

        this.sublabelEl = document.createElement("div");
        this.sublabelEl.className = "msa-track-sublabel";
        this.labelEl.appendChild(this.sublabelEl);
        this.setSublabel(sublabel);

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
    }

    setData(data) {
        this.data = data;
    }

    setTrackState(trackState) {
        this.trackState = trackState;
    }

    setTheme(theme) {
        this.theme = theme;
    }

    setSublabel(sublabel) {
        this.sublabel = sublabel;
        const text = sublabel == null ? "" : String(sublabel);
        const hasSublabel = text.trim().length > 0;
        this.sublabelEl.textContent = hasSublabel ? text : "";
        if (hasSublabel) {
            this.sublabelEl.hidden = false;
            this.sublabelEl.removeAttribute("hidden");
        } else {
            this.sublabelEl.hidden = true;
        }
    }

    getMetricData(trackState = this.trackState) {
        return trackState?.metrics?.[this.metric] ?? null;
    }

    formatTooltipValue(value) {
        if (!Number.isFinite(value)) {
            return null;
        }
        if (Number.isInteger(value)) {
            return String(value);
        }
        if (Math.abs(value) >= 10) {
            return value.toFixed(1);
        }
        return value.toFixed(3).replace(/\.?0+$/, "");
    }

    getTooltipData(rawColumn, context = {}) {
        const value = this.data?.[rawColumn];
        if (this.tooltip) {
            return this.tooltip({
                rawColumn,
                value,
                track: this,
                trackState: this.trackState,
                ...context,
            });
        }
        if (!Number.isFinite(value)) {
            return null;
        }
        return {
            title: this.label,
            subtitle: this.sublabel,
            lines: [
                `Column: ${rawColumn + 1}`,
                `Value: ${this.formatTooltipValue(value)}`,
            ],
        };
    }

    normalizeValue(value) {
        if (!Number.isFinite(value)) {
            return 0;
        }
        if (!this.valueRange) {
            return value;
        }
        const min = this.valueRange.min ?? 0;
        const max = this.valueRange.max ?? 1;
        if (max <= min) {
            return 0;
        }
        const t = (value - min) / (max - min);
        return Math.max(0, Math.min(1, t));
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
