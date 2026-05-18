function addLine(root, text, styles = null) {
    const line = document.createElement("div");
    line.textContent = text;
    if (styles) {
        Object.assign(line.style, styles);
    }
    root.appendChild(line);
}

function getTooltipPosition(point, tooltipWidth, tooltipHeight, offset = 12) {
    const maxLeft = Math.max(0, window.innerWidth - tooltipWidth);
    const maxTop = Math.max(0, window.innerHeight - tooltipHeight);
    let left = point.clientX + offset;
    let top = point.clientY + offset;

    if (left > maxLeft) left = point.clientX - tooltipWidth - offset;
    if (top > maxTop) top = point.clientY - tooltipHeight - offset;

    return {
        left: Math.max(0, Math.min(maxLeft, left)),
        top: Math.max(0, Math.min(maxTop, top)),
    };
}

export class TrackTooltipPresenter {
    constructor({ tooltipEl }) {
        this.tooltipEl = tooltipEl;
        this.applyBaseStyles();
    }

    applyBaseStyles() {
        this.tooltipEl.style.position = "fixed";
        this.tooltipEl.style.zIndex = "2147483647";
        this.tooltipEl.style.pointerEvents = "none";
        this.tooltipEl.style.display = "none";
        this.tooltipEl.style.minWidth = "120px";
        this.tooltipEl.style.maxWidth = "240px";
        this.tooltipEl.style.padding = "8px 10px";
        this.tooltipEl.style.borderRadius = "6px";
        this.tooltipEl.style.border = "1px solid rgba(0, 0, 0, 0.12)";
        this.tooltipEl.style.boxShadow = "0 6px 20px rgba(0, 0, 0, 0.18)";
        this.tooltipEl.style.fontFamily = "\"IBM Plex Sans\", sans-serif";
        this.tooltipEl.style.fontSize = "12px";
        this.tooltipEl.style.lineHeight = "1.35";
        this.tooltipEl.style.whiteSpace = "nowrap";
    }

    applyTheme(theme) {
        const darkMode = !!theme?.darkMode;
        this.tooltipEl.style.background = darkMode ? "rgba(24, 24, 28, 0.96)" : "rgba(255, 255, 255, 0.98)";
        this.tooltipEl.style.color = darkMode ? "#f3f3f5" : "#202226";
        this.tooltipEl.style.borderColor = darkMode ? "rgba(255, 255, 255, 0.12)" : "rgba(0, 0, 0, 0.12)";
        this.tooltipEl.style.fontFamily = theme?.uiFontFamily ?? "\"IBM Plex Sans\", sans-serif";
    }

    render(data) {
        this.tooltipEl.replaceChildren();
        if (data.title) {
            addLine(this.tooltipEl, data.title, { fontWeight: "600" });
        }
        if (data.subtitle) {
            addLine(this.tooltipEl, data.subtitle, {
                fontSize: "11px",
                opacity: "0.75",
                marginTop: "2px",
            });
        }
        const lines = data.lines ?? [];
        if (lines.length > 0) {
            const body = document.createElement("div");
            body.style.marginTop = "6px";
            for (const line of lines) {
                addLine(body, line, { marginTop: "2px" });
            }
            this.tooltipEl.appendChild(body);
        }
    }

    show(data, point) {
        this.render(data);
        this.tooltipEl.style.display = "block";

        const tooltipWidth = this.tooltipEl.offsetWidth;
        const tooltipHeight = this.tooltipEl.offsetHeight;
        const { left, top } = getTooltipPosition(point, tooltipWidth, tooltipHeight);
        this.tooltipEl.style.left = `${left}px`;
        this.tooltipEl.style.top = `${top}px`;
    }

    hide() {
        this.tooltipEl.style.display = "none";
    }
}
