import { MSAViewer } from "../viewer/MSAViewer.js";
import { parseFastaAlignment } from "../alignment/fasta.js";
import { parseA3MAlignment } from "../alignment/a3m.js";
import { getSupportedSchemeKeysForAlphabet } from "../schemes/registry.js";
import { defaultAlphabetRegistry } from "../alphabets/index.js";

function inferAlphabetId(fileName) {
    const lower = fileName.toLowerCase();
    if (lower.includes("3di")) return "3di";
    if (lower.includes("nt") || lower.includes("dna") || lower.includes("rna")) return "nt";
    return "aa";
}

function toRepresentationId(fileName, fallbackIndex) {
    const stem = fileName.replace(/\.[^.]+$/, "");
    const slug = stem.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    return slug || `representation-${fallbackIndex + 1}`;
}

function buildSchemeOptionCatalog(selectEl) {
    return Array.from(selectEl.querySelectorAll("optgroup")).map((group) => ({
        label: group.label,
        options: Array.from(group.querySelectorAll("option")).map((option) => ({
            value: option.value,
            label: option.textContent,
        })),
    }));
}

function syncSchemeOptions({ schemeSelect, schemeCatalog, alphabet, selectedSchemeKey }) {
    const supportedSchemeKeys = new Set(getSupportedSchemeKeysForAlphabet(alphabet));
    schemeSelect.replaceChildren();

    for (const group of schemeCatalog) {
        const supportedOptions = group.options.filter((option) => supportedSchemeKeys.has(option.value));
        if (supportedOptions.length === 0) continue;

        const optgroup = document.createElement("optgroup");
        optgroup.label = group.label;
        for (const optionDef of supportedOptions) {
            const option = document.createElement("option");
            option.value = optionDef.value;
            option.textContent = optionDef.label;
            optgroup.appendChild(option);
        }
        schemeSelect.appendChild(optgroup);
    }

    schemeSelect.disabled = supportedSchemeKeys.size === 0;
    if (!schemeSelect.disabled && supportedSchemeKeys.has(selectedSchemeKey)) {
        schemeSelect.value = selectedSchemeKey;
    }
}

async function main() {
    const root = document.getElementById("viewer");
    const fileInput = document.getElementById("file-input");
    const clearButton = document.getElementById("clear-selection-button");
    const uploadButton = document.getElementById("upload-button");
    const loadFilesButton = document.getElementById("load-files-button");
    const schemeSelect = document.getElementById("scheme-select");
    const representationSelect = document.getElementById("representation-select");
    const pendingFilesPanel = document.getElementById("pending-files-panel");
    const pendingFileList = document.getElementById("pending-file-list");
    const status = document.getElementById("status");
    const alphabetOptions = defaultAlphabetRegistry.list();
    let pendingFiles = [];

    // Set up the MSAViewer
    // init() loads all necessary WebGPU components
    const viewer = new MSAViewer({ root });
    await viewer.init(); 
    const schemeCatalog = buildSchemeOptionCatalog(schemeSelect);

    const refreshSchemeSelect = () => {
        const alphabet = viewer.getActiveAlphabet();
        const selectedSchemeKey = viewer.state.getSnapshot().scheme.key;
        syncSchemeOptions({
            schemeSelect,
            schemeCatalog,
            alphabet,
            selectedSchemeKey,
        });
    };

    const renderPendingFiles = () => {
        pendingFileList.replaceChildren();
        if (pendingFiles.length === 0) {
            pendingFilesPanel.hidden = true;
            loadFilesButton.disabled = true;
            return;
        }

        pendingFilesPanel.hidden = false;
        loadFilesButton.disabled = false;
        for (const pendingFile of pendingFiles) {
            const row = document.createElement("div");
            row.className = "pending-file-row";

            const name = document.createElement("div");
            name.className = "pending-file-name";
            name.textContent = pendingFile.file.name;
            row.appendChild(name);

            const select = document.createElement("select");
            select.className = "control-select";
            select.dataset.fileId = pendingFile.id;
            for (const alphabet of alphabetOptions) {
                const option = document.createElement("option");
                option.value = alphabet.id;
                option.textContent = alphabet.label;
                if (alphabet.id === pendingFile.alphabetId) {
                    option.selected = true;
                }
                select.appendChild(option);
            }
            select.addEventListener("change", (event) => {
                pendingFile.alphabetId = event.target.value;
            });
            row.appendChild(select);

            pendingFileList.appendChild(row);
        }
    };
    
    // page UI
    uploadButton.addEventListener("click", () => fileInput.click());
    document.addEventListener("click", (event) => {
        if (pendingFilesPanel.hidden) return;
        if (pendingFilesPanel.contains(event.target) || uploadButton.contains(event.target)) return;
        pendingFiles = [];
        renderPendingFiles();
        status.textContent = "Load an alignment to begin.";
    });
    schemeSelect.addEventListener("change", async (event) => {
        await viewer.setScheme(event.target.value);
    });
    representationSelect.addEventListener("change", async (event) => {
        if (!event.target.value) return;
        try {
            await viewer.setActiveRepresentation(event.target.value);
            refreshSchemeSelect();
            status.textContent = `Switched to ${event.target.selectedOptions[0].textContent}`;
        } catch (error) {
            status.textContent = error.message;
            console.error(error);
        }
    });
    fileInput.addEventListener("change", async (event) => {
        const files = Array.from(event.target.files ?? []);
        if (files.length === 0) return;
        pendingFiles = files.map((file, index) => ({
            id: toRepresentationId(file.name, index),
            file,
            alphabetId: inferAlphabetId(file.name),
        }));
        renderPendingFiles();
        status.textContent = `Selected ${files.length} file${files.length === 1 ? "" : "s"}. Confirm alphabets, then load.`;
        fileInput.value = "";
    });

    loadFilesButton.addEventListener("click", async () => {
        if (pendingFiles.length === 0) return;
        try {
            status.textContent = `Loading ${pendingFiles.length} alignment file${pendingFiles.length === 1 ? "" : "s"}...`;
            const representations = await Promise.all(pendingFiles.map(async (pendingFile) => {
                const format = pendingFile.file.name.toLowerCase().endsWith(".a3m") ? "a3m" : "fasta";
                const store = format === "a3m"
                    ? await parseA3MAlignment(pendingFile.file)
                    : await parseFastaAlignment(pendingFile.file);
                return {
                    id: pendingFile.id,
                    label: pendingFile.file.name,
                    store,
                    alphabetId: pendingFile.alphabetId,
                };
            }));

            await viewer.loadRepresentations(representations, { activeId: representations[0].id });
            refreshSchemeSelect();

            representationSelect.replaceChildren();
            for (const representation of representations) {
                const option = document.createElement("option");
                option.value = representation.id;
                option.textContent = representation.label;
                representationSelect.appendChild(option);
            }
            representationSelect.disabled = false;
            representationSelect.value = representations[0].id;

            pendingFiles = [];
            renderPendingFiles();

            const { totalRows, totalCols } = representations[0].store;
            status.textContent = `Loaded ${representations.length} representations. Active: ${representations[0].label} (${totalRows} sequences x ${totalCols} columns)`;
        } catch (error) {
            status.textContent = error.message;
            console.error(error);
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
