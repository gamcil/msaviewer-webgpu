# msa-webgpu
WebGPU MSA Viewer for big alignments.

Very much WIP.

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
  import { MSAViewer } from "./src/index.js";

  const root = document.getElementById("viewer");
  const viewer = new MSAViewer({ root });
  await viewer.init();

  const fastaText = `>seq1
ACDEFGHIK
>seq2
ACD-FGHIK`;

  const { totalRows, totalCols } = await viewer.loadFastaAlignment(fastaText);
  console.log(`Loaded ${totalRows} sequences x ${totalCols} columns`);
</script>
```
