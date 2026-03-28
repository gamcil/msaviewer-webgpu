import { formatTooltipHtml, getTooltipScreenPosition } from "../models/trackTooltipModel.js";

export class TrackTooltipPresenter {
    constructor({ tooltipEl }) {
        this.tooltipEl = tooltipEl;
        this.applyBaseStyles();
    }

    applyBaseStyles() {
        this.tooltipEl.style.position = "fixed";
        this.tooltipEl.style.pointerEvents = "none";
        this.tooltipEl.style.display = "none";
        this.tooltipEl.style.minWidth = "120px";
        this.tooltipEl.style.maxWidth = "240px";
        this.tooltipEl.style.padding = "8px 10px";
        this.tooltipEl.style.borderRadius = "6px";
        this.tooltipEl.style.border = "1px solid rgba(0, 0, 0, 0.12)";
        this.tooltipEl.style.boxShadow = "0 6px 20px rgba(0, 0, 0, 0.18)";
        this.tooltipEl.style.fontSize = "12px";
        this.tooltipEl.style.lineHeight = "1.35";
        this.tooltipEl.style.whiteSpace = "nowrap";
    }

    applyTheme(theme) {
        const darkMode = !!theme?.darkMode;
        this.tooltipEl.style.background = darkMode ? "rgba(24, 24, 28, 0.96)" : "rgba(255, 255, 255, 0.98)";
        this.tooltipEl.style.color = darkMode ? "#f3f3f5" : "#202226";
        this.tooltipEl.style.borderColor = darkMode ? "rgba(255, 255, 255, 0.12)" : "rgba(0, 0, 0, 0.12)";
    }

    show(data, event) {
        this.tooltipEl.innerHTML = formatTooltipHtml(data);
        this.tooltipEl.style.display = "block";

        const tooltipWidth = this.tooltipEl.offsetWidth;
        const tooltipHeight = this.tooltipEl.offsetHeight;
        const { left, top } = getTooltipScreenPosition(event, tooltipWidth, tooltipHeight);
        this.tooltipEl.style.left = `${left}px`;
        this.tooltipEl.style.top = `${top}px`;
    }

    hide() {
        this.tooltipEl.style.display = "none";
    }
}
