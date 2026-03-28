export function getHoveredTrack(tracks, clientY) {
    for (const track of tracks) {
        const rect = track.root.getBoundingClientRect();
        if (clientY >= rect.top && clientY <= rect.bottom) {
            return track;
        }
    }
    return null;
}

export function getVisibleColumnFromPointerEvent(event, overlayBounds, viewport) {
    if (!viewport || !overlayBounds) {
        return null;
    }
    const contentX = event.clientX - overlayBounds.left + viewport.scrollLeft;
    const visibleColumn = Math.floor(contentX / viewport.cellWidth);
    if (visibleColumn < 0 || visibleColumn >= viewport.totalCols) {
        return null;
    }
    return visibleColumn;
}

export function getRawColumnFromVisibleColumn(visibleColumn, columnVisibility) {
    if (visibleColumn == null) {
        return null;
    }
    return columnVisibility?.visibleToRaw?.[visibleColumn] ?? visibleColumn;
}

export function formatTooltipHtml(data) {
    const title = data.title ? `<div style="font-weight:600;">${data.title}</div>` : "";
    const subtitle = data.subtitle ? `<div style="font-size:11px; opacity:0.75; margin-top:2px;">${data.subtitle}</div>` : "";
    const lines = (data.lines ?? []).map((line) =>
        `<div style="margin-top:2px;">${line}</div>`
    ).join("");
    return `${title}${subtitle}${lines ? `<div style="margin-top:6px;">${lines}</div>` : ""}`;
}

export function getTooltipScreenPosition(event, tooltipWidth, tooltipHeight, offset = 12) {
    const maxLeft = Math.max(0, window.innerWidth - tooltipWidth);
    const maxTop = Math.max(0, window.innerHeight - tooltipHeight);
    let left = event.clientX + offset;
    let top = event.clientY + offset;

    if (left > maxLeft) {
        left = event.clientX - tooltipWidth - offset;
    }
    if (top > maxTop) {
        top = event.clientY - tooltipHeight - offset;
    }

    return {
        left: Math.max(0, Math.min(maxLeft, left)),
        top: Math.max(0, Math.min(maxTop, top)),
    };
}
