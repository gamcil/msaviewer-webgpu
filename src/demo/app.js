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

function formatRepresentationLabel(representation, alphabetRegistry) {
    const alphabetLabel = alphabetRegistry.get(representation.alphabetId)?.label ?? representation.alphabetId;
    return `${representation.label} (${alphabetLabel})`;
}

function setStatus(statusEl, message) {
    statusEl.textContent = message;
}

function syncSelectionButton(clearButton, selectionCount) {
    if (selectionCount > 0) {
        clearButton.innerHTML = `Clear ${selectionCount}<br>selection${selectionCount === 1 ? "" : "s"}`;
        clearButton.disabled = false;
        return;
    }
    clearButton.innerHTML = "Clear<br>selection";
    clearButton.disabled = true;
}

function populateRepresentationOptions(representationSelect, representations, alphabetRegistry) {
    representationSelect.replaceChildren();
    for (const representation of representations) {
        const option = document.createElement("option");
        option.value = representation.id;
        option.textContent = formatRepresentationLabel(representation, alphabetRegistry);
        representationSelect.appendChild(option);
    }
    representationSelect.disabled = representations.length === 0;
    representationSelect.value = representations[0]?.id ?? "";
}

async function main() {
    const root = document.getElementById("viewer");
    const fileInput = document.getElementById("file-input");
    const clearButton = document.getElementById("clear-selection-button");
    const motifSearchButton = document.getElementById("motif-search-button");
    const uploadButton = document.getElementById("upload-button");
    const loadFilesButton = document.getElementById("load-files-button");
    const schemeSelect = document.getElementById("scheme-select");
    const representationSelect = document.getElementById("representation-select");
    const selectionModeSelect = document.getElementById("selection-mode-select");
    const hideInsertionsCheckbox = document.getElementById("hide-insertions-checkbox");
    const gapThresholdInput = document.getElementById("gap-threshold-input");
    const pendingFilesPanel = document.getElementById("pending-files-panel");
    const pendingFileList = document.getElementById("pending-file-list");
    const status = document.getElementById("status");
    const alphabetOptions = defaultAlphabetRegistry.list();
    let pendingFiles = [];

    // Set up the MSAViewer
    // init() loads all necessary WebGPU components
    const viewer = new MSAViewer({
        root,
        layout: {
            header: true,
            minimap: true,
            tracks: true,
        },
    });
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

    const syncLoadedControls = () => {
        const hasActiveRepresentation = representationSelect.disabled !== true && representationSelect.value !== "";
        motifSearchButton.disabled = !hasActiveRepresentation;
    };

    const syncControls = () => {
        refreshSchemeSelect();
        syncMaskControls();
        syncSelectionModeControl();
        syncLoadedControls();
    };

    const syncMaskControls = () => {
        const masking = viewer.getColumnMasking();
        hideInsertionsCheckbox.checked = masking.hideInsertionColumns === true;
        gapThresholdInput.value = masking.gapThreshold == null ? "" : String(masking.gapThreshold);
    };

    const syncSelectionModeControl = () => {
        selectionModeSelect.value = viewer.getSelectionMode();
    };

    const applyMaskControls = () => {
        const gapThresholdValue = gapThresholdInput.value.trim();
        const parsedGapThreshold = gapThresholdValue === "" ? null : Number(gapThresholdValue);
        viewer.setColumnMasking({
            hideInsertionColumns: hideInsertionsCheckbox.checked,
            gapThreshold: Number.isFinite(parsedGapThreshold) ? parsedGapThreshold : null,
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
        setStatus(status, "Load an alignment to begin.");
    });
    schemeSelect.addEventListener("change", async (event) => {
        await viewer.setScheme(event.target.value);
    });
    hideInsertionsCheckbox.addEventListener("change", () => {
        applyMaskControls();
    });
    gapThresholdInput.addEventListener("change", () => {
        applyMaskControls();
    });
    representationSelect.addEventListener("change", async (event) => {
        if (!event.target.value) return;
        try {
            await viewer.setActiveRepresentation(event.target.value);
            syncControls();
            setStatus(status, `Switched to ${event.target.selectedOptions[0].textContent}`);
        } catch (error) {
            setStatus(status, error.message);
            console.error(error);
        }
    });
    selectionModeSelect.addEventListener("change", (event) => {
        viewer.setSelectionMode(event.target.value);
        setStatus(status, `Selection mode: ${event.target.selectedOptions[0].textContent}`);
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
        setStatus(status, `Selected ${files.length} file${files.length === 1 ? "" : "s"}. Confirm alphabets, then load.`);
        fileInput.value = "";
    });

    loadFilesButton.addEventListener("click", async () => {
        if (pendingFiles.length === 0) return;
        try {
            setStatus(status, `Loading ${pendingFiles.length} alignment file${pendingFiles.length === 1 ? "" : "s"}...`);
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
            populateRepresentationOptions(representationSelect, representations, defaultAlphabetRegistry);
            syncControls();

            pendingFiles = [];
            renderPendingFiles();

            const { totalRows, totalCols } = representations[0].store;
            setStatus(status, `Loaded ${representations.length} representations. Active: ${representations[0].label} (${totalRows} sequences x ${totalCols} columns)`);
        } catch (error) {
            setStatus(status, error.message);
            console.error(error);
        }
    });
    
    viewer.onSelectionChange((selection) => {
        const selectionCount = selection?.componentCount ?? 0;
        syncSelectionButton(clearButton, selectionCount);
    });

    clearButton.onclick = () => {
        viewer.clearSelection();
    };

    motifSearchButton.addEventListener("click", async () => {
        const currentQuery = viewer.motifController?.query ?? "";
        const nextQuery = window.prompt("Motif query", currentQuery);
        if (nextQuery === null) return;
        const trimmedQuery = nextQuery.trim();
        try {
            if (!trimmedQuery) {
                await viewer.clearMotifQuery();
                setStatus(status, "Motif search cleared.");
                return;
            }
            await viewer.setMotifQuery(trimmedQuery);
            setStatus(status, `Motif search: ${trimmedQuery} (${viewer.getMotifMatchCount()} matches)`);
        } catch (error) {
            setStatus(status, error.message);
            console.error(error);
        }
    });

    syncSelectionButton(clearButton, 0);
    syncControls();
}

main().catch((error) => {
    console.error(error);
    const status = document.getElementById("status");
    if (status) {
        status.textContent = error.message;
    }
});
