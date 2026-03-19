import { MSAViewer } from "../viewer/MSAViewer.js";

async function main() {
    const root = document.getElementById("viewer");
    const fileInput = document.getElementById("file-input");
    const clearButton = document.getElementById("clear-selection-button");
    const uploadButton = document.getElementById("upload-button");
    const schemeSelect = document.getElementById("scheme-select");
    const status = document.getElementById("status");

    // Set up the MSAViewer
    // init() loads all necessary WebGPU components
    const viewer = new MSAViewer({ root });
    await viewer.init(); 
    
    // page UI
    uploadButton.addEventListener("click", () => fileInput.click());
    schemeSelect.addEventListener("change", async (event) => {
        await viewer.setScheme(event.target.value);
    });
    fileInput.addEventListener("change", async (event) => {
        const [file] = event.target.files;
        if (!file) return;
        try {
            status.textContent = `Loading ${file.name}...`;
            const format = file.name.toLowerCase().endsWith(".a3m") ? "a3m" : "fasta";
            const { totalRows, totalCols } = await viewer.loadFastaAlignment(file, format);
            status.textContent = `Loaded ${file.name}: ${totalRows} sequences x ${totalCols} columns`;
        } catch (error) {
            status.textContent = error.message;
            console.error(error);
        } finally {
            fileInput.value = "";
        }
    });
    
    const unsubscribe = viewer.onSelectionChange((selectedColumns) => {
        if (selectedColumns.size > 0) {
            clearButton.textContent = `Clear ${selectedColumns.size} selected columns`;
            clearButton.disabled = false;
        } else {
            clearButton.textContent = `Clear selected columns`;
            clearButton.disabled = true;
        }
    });

    clearButton.onclick = () => {
        viewer.clearSelectedColumns();
    }
}

main().catch((error) => {
    console.error(error);
    const status = document.getElementById("status");
    if (status) {
        status.textContent = error.message;
    }
});
