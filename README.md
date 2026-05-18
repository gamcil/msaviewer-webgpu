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
await viewer.setTrackEnabled(track, enabled);
await viewer.setMotifQuery(query);

viewer.getConfig();
viewer.getBackend();
viewer.getRepresentations();
viewer.getActiveRepresentation();
viewer.getSchemes();
viewer.getTracks();
viewer.getSelection();
viewer.setSelection({ mode, ranges });
viewer.clearSelection();
await viewer.exportSelectionAsFasta();

viewer.addEventListener("selectionchange", handler);
viewer.addEventListener("sequenceclick", handler);
viewer.destroy();
```

## Declarative Tracks

Tracks are configured with a source plus one or more lanes. Each lane contains render layers such as bars, lines, glyphs, or logos. Layers inherit the track source unless they define their own. Lane height is derived from the tallest layer in that lane.

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
          },
          {
            type: "glyph",
            source: { type: "metric", metric: "quality" },
            style: { fontSize: 12, minCellWidth: 14, fillStyle: "#202226" },
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
