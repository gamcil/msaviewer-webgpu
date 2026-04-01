import { MSAViewer } from "../viewer/MSAViewer.js";
import { defaultAlphabetRegistry } from "../alphabets/index.js";

const DEMO_VIEWER_OPTIONS = {
    data: {
        representations: [],
        activeRepresentationId: null,
    },
    theme: {
        mode: "auto",
        typography: {
            uiFontFamily: "\"IBM Plex Sans\", sans-serif",
            uiFontSize: 13,
            alignmentFontFamily: "\"IBM Plex Mono\", monospace",
            headerFontFamily: "\"IBM Plex Mono\", \"IBM Plex Sans\", monospace",
            headerFontSize: 14,
        },
    },
    layout: {
        header: {
            visible: true,
            width: 180,
        },
        ruler: {
            visible: true,
            height: 28,
            tickInterval: 10,
        },
        minimap: {
            visible: true,
            height: 120,
        },
        tracks: {
            visible: true,
            labelWidth: 100,
        },
        cell: {
            width: 16,
            height: 16,
        },
    },
    tracks: {
        enabled: ["consensus", "quality", "conservation", "occupancy"],
        order: null,
        definitions: {},
    },
    behavior: {
        selectionMode: "column",
        masking: {
            hideInsertionColumns: false,
            gapThreshold: null,
        },
    },
    rendering: {
        backend: "webgpu",
        scheme: "clustalx",
    },
};

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

function populateSchemeOptions(schemeSelect, schemes, selectedSchemeKey) {
    schemeSelect.replaceChildren();
    let currentGroup = null;
    let optgroup = null;
    for (const scheme of schemes) {
        if (scheme.group !== currentGroup) {
            currentGroup = scheme.group;
            optgroup = document.createElement("optgroup");
            optgroup.label = currentGroup;
            schemeSelect.appendChild(optgroup);
        }
        const option = document.createElement("option");
        option.value = scheme.key;
        option.textContent = scheme.label;
        optgroup.appendChild(option);
    }
    schemeSelect.disabled = schemes.length === 0;
    if (!schemeSelect.disabled) {
        schemeSelect.value = selectedSchemeKey;
    }
}

function populateRepresentationOptions(representationSelect, representations) {
    representationSelect.replaceChildren();
    for (const representation of representations) {
        const option = document.createElement("option");
        option.value = representation.id;
        option.textContent = representation.displayLabel;
        representationSelect.appendChild(option);
    }
    representationSelect.disabled = representations.length === 0;
    representationSelect.value = representations[0]?.id ?? "";
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

function syncUI({ viewer, representationSelect, schemeSelect, selectionModeSelect, hideInsertionsCheckbox, gapThresholdInput, motifSearchButton }) {
    const representations = viewer.getRepresentations();
    const activeRepresentationId = viewer.getActiveRepresentation()?.id ?? representations[0]?.id ?? "";
    populateRepresentationOptions(representationSelect, representations);
    representationSelect.value = activeRepresentationId;
    populateSchemeOptions(
        schemeSelect,
        viewer.getCompatibleSchemes(activeRepresentationId),
        viewer.state.getSnapshot().scheme.key
    );
    const masking = viewer.getColumnMasking();
    hideInsertionsCheckbox.checked = masking.hideInsertionColumns === true;
    gapThresholdInput.value = masking.gapThreshold == null ? "" : String(masking.gapThreshold);
    selectionModeSelect.value = viewer.getSelectionMode();
    motifSearchButton.disabled = !(representationSelect.disabled !== true && representationSelect.value !== "");
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
    const trackToggleList = document.getElementById("track-toggle-list");
    const pendingFilesPanel = document.getElementById("pending-files-panel");
    const pendingFileList = document.getElementById("pending-file-list");
    const status = document.getElementById("status");
    const ui = {
        representationSelect,
        schemeSelect,
        selectionModeSelect,
        hideInsertionsCheckbox,
        gapThresholdInput,
        motifSearchButton,
    };
    const alphabetOptions = defaultAlphabetRegistry.list();
    let pendingFiles = [];

    const viewer = new MSAViewer({ root, ...DEMO_VIEWER_OPTIONS, });
    await viewer.init();

    const renderTrackToggles = () => {
        if (!trackToggleList) return;
        const enabledTrackIds = new Set(viewer.getEnabledTrackIds());
        trackToggleList.replaceChildren();
        for (const track of viewer.getAvailableTracks()) {
            const label = document.createElement("label");
            label.className = "toolbar-check";

            const input = document.createElement("input");
            input.type = "checkbox";
            input.checked = enabledTrackIds.has(track.id);
            input.addEventListener("change", async () => {
                await viewer.toggleTrack(track.id, input.checked);
                setStatus(status, `${input.checked ? "Enabled" : "Disabled"} track: ${track.label}`);
            });

            const text = document.createElement("span");
            text.textContent = track.label;

            label.append(input, text);
            trackToggleList.appendChild(label);
        }
    };

    const applyMasking = () => {
        const gapThresholdValue = gapThresholdInput.value.trim();
        const parsedGapThreshold = gapThresholdValue === "" ? null : Number(gapThresholdValue);
        void viewer.setOptions({
            behavior: {
                masking: {
                    hideInsertionColumns: hideInsertionsCheckbox.checked,
                    gapThreshold: Number.isFinite(parsedGapThreshold) ? parsedGapThreshold : null,
                },
            },
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
        loadFilesButton.disabled = pendingFiles.length === 0;
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
        await viewer.setOptions({
            rendering: {
                scheme: event.target.value,
            },
        });
    });
    hideInsertionsCheckbox.addEventListener("change", () => {
        applyMasking();
    });
    gapThresholdInput.addEventListener("change", () => {
        applyMasking();
    });
    representationSelect.addEventListener("change", async (event) => {
        if (!event.target.value) return;
        try {
            await viewer.setOptions({
                data: {
                    activeRepresentationId: event.target.value,
                },
            });
            syncUI({ viewer, ...ui });
            setStatus(status, `Switched to ${event.target.selectedOptions[0].textContent}`);
        } catch (error) {
            setStatus(status, error.message);
            console.error(error);
        }
    });
    selectionModeSelect.addEventListener("change", (event) => {
        void viewer.setOptions({
            behavior: {
                selectionMode: event.target.value,
            },
        });
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
            const representations = await viewer.loadFiles(
                pendingFiles.map((pendingFile) => ({
                    file: pendingFile.file,
                    id: pendingFile.id,
                    label: pendingFile.file.name,
                    alphabetId: pendingFile.alphabetId,
                })),
                {
                    activate: "first",
                    replace: true,
                }
            );

            syncUI({ viewer, ...ui });

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
    syncUI({ viewer, ...ui });
    renderTrackToggles();
    pendingFilesPanel.hidden = true;
    loadFilesButton.disabled = true;
}

main().catch((error) => {
    console.error(error);
    const status = document.getElementById("status");
    if (status) {
        status.textContent = error.message;
    }
});
