# msa-webgpu
WebGPU-capable multiple sequence alignment viewer for large alignments.

The package exports `MSAViewer` plus the built-in alphabet registry and alphabet definitions.

Very much WIP.

## Installation

```bash
npm install msa-webgpu
```

## Online demo
https://gamcil.github.io/msaviewer-webgpu/

## Local demo

```bash
npm install
npm run dev
```

or

```bash
npm run build:demo
npx vite preview --config vite.demo.config.js
```

## Minimal usage

```html
<div id="viewer" class="viewer-shell"></div>

<script type="module">
  import { MSAViewer } from "msa-webgpu";

  const root = document.getElementById("viewer");
  const fastaText = `>seq1
ACDEFGHIK
>seq2
ACD-FGHIK`;

  const viewer = new MSAViewer({
    root,
    config: {
      rendering: { scheme: "pid" },
    },
  });
  const { active } = await viewer.loadData({
    source: fastaText,
    alphabetId: "aa",
    format: "fasta",
    id: "example",
    label: "Example",
  });
  console.log(`Loaded ${active.totalRows} sequences x ${active.totalCols} columns`);
</script>
```

`loadData()` also accepts an array when loading multiple representations. The first item becomes active unless `activeId` is provided.

When supported, imported alignment tile payloads are stored in the browser's origin-private file system (OPFS). The decoded viewport cache and alignment metadata remain in memory; replacing the data or destroying the viewer removes the temporary local copy. At viewer startup, sessions abandoned by a crash are automatically cleaned once they are 24 hours old, without removing live sessions in another tab when the browser supports origin locks. Clearing the site's browser data removes them immediately. Browsers without OPFS use the in-memory fallback.

```js
await viewer.loadData([
  { source: sequenceFasta, id: "sequence", label: "Sequence", alphabetId: "aa" },
  { source: structureFasta, id: "structure", label: "Structure", alphabetId: "3di" },
]);
```

## Viewer API

```js
const viewer = new MSAViewer({ root, config });

await viewer.loadData(input, { activeId });
await viewer.setConfig(config);
await viewer.setActiveRepresentation(id);
await viewer.registerColorScheme(key, options);
await viewer.setTrackEnabled(track, enabled);
await viewer.setMotifQuery(query);
viewer.zoomIn();
viewer.zoomOut();
viewer.setZoom(1.5);

viewer.getConfig();
viewer.getZoom();
viewer.getBackend();
viewer.getRepresentations();
viewer.getActiveRepresentation();
viewer.getSchemes();
viewer.getTracks();
viewer.getSelection();
viewer.getColumnVisibility();
await viewer.getColumnMetrics({ rawColumnRange: { start: 0, end: 100 } });
await viewer.getConsensus({ rawColumnRange: { start: 0, end: 100 } });
viewer.setRowStyles(rowStyles);
viewer.clearRowStyles();
viewer.setSelection({ mode, ranges });
viewer.clearSelection();
await viewer.exportSelectionAsFasta();

viewer.addEventListener("selectionchange", handler);
viewer.addEventListener("visibilitychange", handler);
viewer.addEventListener("cellhover", handler);
viewer.addEventListener("sequenceclick", handler);
viewer.addEventListener("zoomchange", handler);
viewer.destroy();
```

Hold Ctrl (or Cmd on macOS) while scrolling over the alignment to zoom around the pointer. `zoomIn()` and `zoomOut()` zoom around the viewport centre using 25%, 50%, 75%, 90%, 100%, 125%, 150%, and larger preset levels.

## Computed Alignment Data

`getColumnMetrics()` and `getConsensus()` expose independent snapshots of the viewer's computed alignment data for embedding applications. Both accept an optional `representationId` and an exclusive-end `rawColumnRange`; metrics can also be limited to named fields. The returned alphabet descriptor defines the symbol order used by consensus indices and residue frequencies.

## Custom Color Schemes

Register column-driven schemes before selecting them in the viewer config. Custom schemes compile the input values into one packed color per column, so the original values are not retained. If data is already loaded, the `values` length must match the active alignment column count.

```js
import { MSAViewer } from "msa-webgpu";

const viewer = new MSAViewer({ root });
const values = [0.1, 0.4, -1, 1.0];

await viewer.registerColorScheme("myScores", {
  label: "My Scores",
  values,
  min: 0,
  max: 1,
  colormap: "viridis",
  missingValue: -1,
});

await viewer.setConfig({
  rendering: { scheme: "myScores" },
});
```

Use a two-stop `colormap` for a two-color gradient. Built-in colormap names include `viridis`, `magma`, `inferno`, and `plasma`; `colormap` also accepts an array of color stops.

## Row Header Styles

Apply lightweight row header styling for application-level sequence state, such as rows linked to an external structure viewer. This does not affect alignment selection or exported selections.

```js
viewer.setRowStyles([
  {
    rowIndex: 4,
    headerBackground: "#1976d2",
    headerColor: "#ffffff",
  },
]);

viewer.clearRowStyles();
```

## Cell Hover

Listen for hovered alignment cell changes to drive application-owned tooltips. Columns are reported in both visible-column and raw-alignment coordinates. `sequenceResidueIndex` is the 0-based non-gap residue index in that alignment row, and `sequenceResidueNumber` is the 1-based equivalent; both are `null` for gaps.

```js
viewer.addEventListener("cellhover", (event) => {
  const {
    rowIndex,
    rawColumn,
    visibleColumn,
    sequenceResidueNumber,
    record,
    symbol,
  } = event.detail;
  if (rowIndex == null) {
    // Pointer left the alignment body.
    return;
  }
});
```

## Column Visibility

Column masking is exposed as a snapshot so external views can stay aligned with the viewer's filtered columns.

```js
const visibility = viewer.getColumnVisibility();

viewer.addEventListener("visibilitychange", (event) => {
  const { visible, rawToVisible, visibleToRaw, visibleCount } = event.detail.columnVisibility;
});
```

## Declarative Tracks

Tracks are configured with a source plus one or more lanes. Each lane contains render layers such as bars, lines, glyphs, or logos. Layers inherit the track source unless they define their own. Lane height is derived from the tallest layer in that lane.

Numeric bar, line, and glyph layers can use color ramps with the same colormap model as custom color schemes. `missingValue` leaves that mark on the layer's default style.

```js
await viewer.setConfig({
  tracks: [{
    id: "summary",
    label: "Summary",
    source: { type: "consensus", representation: "active" },
    coloring: { scheme: "clustalx" },
    lanes: [
      {
        layers: [{
          type: "logo",
          height: 52,
          includeGaps: false,
          style: { minLogoCellWidth: 12, logoHeightMode: "information" },
        }],
      },
      {
        layers: [
          {
            type: "line",
            height: 32,
            source: { type: "metric", metric: "quality" },
            style: { strokeStyle: "#007ab2", lineWidth: 2, showPoints: false },
            colorRamp: {
              min: 0,
              max: 1,
              colormap: "viridis",
              target: "points",
            },
          },
          {
            type: "glyph",
            source: { type: "metric", metric: "quality" },
            style: { fontSize: 12, minCellWidth: 14, fillStyle: "#202226" },
            colorRamps: {
              glyph: {
                min: 0,
                max: 1,
                colormap: ["#202226", "#d95f02"],
                missingValue: -1,
              },
            },
            getGlyph: ({ value }) => value > 0.8 ? { glyph: "H" } : null,
          },
        ],
      },
    ],
  }],
  trackDisplay: {
    order: ["summary", "consensus", "quality", "conservation", "occupancy"],
  },
});
```
