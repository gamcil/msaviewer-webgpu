export const AUTO_LAYOUT_CSS = `
:host {
    display: block;
    color-scheme: light dark;
    font-family: var(--msa-ui-font-family);
    font-size: var(--msa-ui-font-size);
    box-sizing: border-box;
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
    --msa-minimap-height: 120px;
    --msa-ruler-height: 28px;
    --msa-header-width: 180px;
    --msa-track-label-width: 100px;
    --msa-track-row-gap: 8px;
    --msa-ui-font-family: "IBM Plex Sans", sans-serif;
    --msa-ui-font-size: 13px;
    --msa-grid-line: rgba(0, 0, 0, 0.05);
    --msa-scroller-bg: #fff;
    --msa-header-bg: #f0f0f0;
    --msa-header-border: rgba(30, 30, 30, 0.1);
}

:host([data-theme="dark"]) {
    color-scheme: dark;
    --msa-grid-line: rgba(255, 255, 255, 0.03);
    --msa-scroller-bg: #111;
    --msa-header-bg: #161616;
    --msa-header-border: rgba(255, 255, 255, 0.08);
}

:host([data-theme="light"]) {
    color-scheme: light;
}

:host([data-loaded="false"]) {
    --msa-header-width: 0px;
}

*, *::before, *::after {
    box-sizing: border-box;
}

[hidden] {
    display: none !important;
}

.msa-auto-shell {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: auto minmax(0, 1fr) auto;
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
}

.viewer-body,
.msa-minimap-body {
    min-width: 0;
}

.viewer-body {
    min-height: 0;
}

.msa-minimap-body {
    grid-row: 1;
    height: var(--msa-minimap-height);
    padding: 8px;
    margin-left: var(--msa-minimap-offset-left, 0px);
    width: calc(100% - var(--msa-minimap-offset-left, 0px));
    background: var(--msa-header-bg);
}

.viewer-body {
    grid-row: 2;
    display: grid;
    position: relative;
    overflow: hidden;
    background: var(--msa-header-bg);
}

.msa-minimap {
    position: relative;
    width: 100%;
    height: 100%;
    border: 1px solid grey;
}

.msa-alignment-corner {
    background: var(--msa-header-bg);
}

.msa-alignment-top-row,
.msa-alignment-body-row {
    display: grid;
    min-width: 0;
    min-height: 0;
}

.msa-alignment-left-column,
.msa-alignment-content-column {
    min-width: 0;
    min-height: 0;
}

.msa-alignment-left-column {
    display: flex;
    flex-direction: column;
    background: var(--msa-header-bg);
}

.msa-alignment-horizontal-scroller,
.msa-alignment-viewport,
.msa-alignment-interaction-proxy {
    color-scheme: inherit;
}

.msa-alignment-content-column {
    overflow: hidden;
    background: var(--msa-header-bg);
}

.msa-alignment-horizontal-scroller {
    overflow-x: auto;
    overflow-y: hidden;
    width: 100%;
    height: 100%;
    background: var(--msa-header-bg);
}

.msa-alignment-interaction-proxy {
    position: absolute;
    inset: 0;
    overflow-x: auto;
    overflow-y: auto;
    background: transparent;
    z-index: 2;
    scrollbar-width: none;
}

.msa-alignment-interaction-proxy::-webkit-scrollbar {
    display: none;
    width: 0;
    height: 0;
}

.msa-alignment-vertical-scroller {
    position: relative;
    width: 100%;
    overflow-x: hidden;
    overflow-y: scroll;
    background: transparent;
    scrollbar-gutter: stable;
}

.msa-alignment-content-stack {
    position: relative;
    min-width: 100%;
}

.msa-alignment-viewport {
    position: sticky;
    left: 0;
    top: 0;
    z-index: 1;
    background: var(--msa-scroller-bg);
}

.msa-ruler-body {
    min-height: var(--msa-ruler-height);
    border-bottom: 1px solid var(--msa-header-border);
    background: transparent;
}

.msa-headers,
.msa-track-label-stack,
.msa-track-body-stack {
    background: var(--msa-header-bg);
}

.msa-headers {
    width: var(--msa-header-view-width, var(--msa-header-width));
    max-width: var(--msa-header-view-width, var(--msa-header-width));
    overflow: hidden;
    flex: 0 0 auto;
    border-right: 1px solid var(--msa-header-border);
    --msa-header-font-family: "IBM Plex Mono", "IBM Plex Sans", monospace;
    --msa-header-font-size: 14px;
}

.msa-headers-track {
    position: relative;
    width: max-content;
    min-width: 100%;
}

.msa-header-row {
    display: flex;
    align-items: center;
    height: var(--row-height);
    padding: 0 8px;
    font-size: var(--msa-header-font-size);
    line-height: 1;
    box-sizing: border-box;
    width: max-content;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--msa-header-font-family);
}

.msa-track-label-stack {
    display: flex;
    flex-direction: column;
    overflow: hidden;
    flex: 0 0 auto;
}

.msa-track-body-stack {
    position: sticky;
    left: 0;
    display: flex;
    flex-direction: column;
    min-width: 0;
    border-top: 1px solid var(--msa-header-border);
}

.viewer-body.is-unloaded,
.viewer-body.is-unloaded .msa-alignment-content-column,
.viewer-body.is-unloaded .msa-alignment-horizontal-scroller,
.viewer-body.is-unloaded .msa-alignment-viewport {
    background:
        linear-gradient(90deg, var(--msa-grid-line) 1px, transparent 1px),
        linear-gradient(var(--msa-grid-line) 1px, transparent 1px),
        var(--msa-scroller-bg);
    background-size: 16px 16px;
}

.msa-alignment-spacer {
    width: 1px;
    height: 1px;
}

.msa-alignment-canvas,
.msa-alignment-motif-canvas,
.msa-alignment-overlay-canvas {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    display: block;
    pointer-events: none;
}

.msa-track-row {
    padding: var(--msa-track-row-gap) 0;
    min-width: 0;
    box-sizing: border-box;
}

.msa-track-label-row {
    display: flex;
    height: calc(var(--msa-track-view-height) + (var(--msa-track-row-gap) * 2));
}

.msa-track-body-row {
    display: block;
    height: calc(var(--msa-track-view-height) + (var(--msa-track-row-gap) * 2));
}

.msa-track-label {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    justify-content: flex-end;
    text-align: right;
    padding: 0 8px;
    min-height: var(--msa-track-view-height);
    min-width: var(--msa-track-label-width);
    margin-left: auto;
}

.msa-track-label-text {
    line-height: 1.1;
}

.msa-track-sublabel {
    margin-top: 2px;
    font-size: 0.8em;
    line-height: 1.1;
    opacity: 0.72;
}

.msa-track-body {
    min-width: 0;
    width: 100%;
    height: var(--msa-track-view-height);
}

.msa-track-canvas {
    display: block;
}
`;
