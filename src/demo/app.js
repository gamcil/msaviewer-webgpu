import { MSAViewer } from "../viewer/MSAViewer.js";

async function main() {
    const root = document.getElementById("viewer");
    const fileInput = document.getElementById("file-input");
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
            const text = await file.text();
            const { totalRows, totalCols } = await viewer.loadFastaAlignment(text);
            status.textContent = `Loaded ${file.name}: ${totalRows} sequences x ${totalCols} columns`;
        } catch (error) {
            status.textContent = error.message;
            console.error(error);
        } finally {
            fileInput.value = "";
        }
    });
}

main().catch((error) => {
    console.error(error);
    const status = document.getElementById("status");
    if (status) {
        status.textContent = error.message;
    }
});
