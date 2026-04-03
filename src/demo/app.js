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
        defaults: "active-only",
        variants: [],
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
        backend: "auto",
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

function populateSchemeOptions(schemeSelect, schemes, selectedSchemeKey, selectedRepresentationId = null) {
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
        for (const variant of scheme.variants) {
            const option = document.createElement("option");
            option.value = scheme.key;
            option.dataset.representationId = variant.representationId ?? "";
            option.textContent = variant.displayLabel ?? scheme.label;
            optgroup.appendChild(option);
        }
    }
    schemeSelect.disabled = schemes.length === 0;
    if (!schemeSelect.disabled) {
        const selectedOption = [...schemeSelect.options].find((option) =>
            option.value === selectedSchemeKey
            && (option.dataset.representationId || null) === selectedRepresentationId
        );
        if (selectedOption) {
            schemeSelect.selectedIndex = selectedOption.index;
        }
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

function syncSelectionButtons(clearButton, exportButton, selectionCount) {
    if (selectionCount > 0) {
        clearButton.innerHTML = `Clear ${selectionCount}<br>selection${selectionCount === 1 ? "" : "s"}`;
        clearButton.disabled = false;
        exportButton.disabled = false;
        return;
    }
    clearButton.innerHTML = "Clear<br>selection";
    clearButton.disabled = true;
    exportButton.disabled = true;
}

function downloadTextFile(text, fileName, mimeType = "text/plain;charset=utf-8") {
    const blob = new Blob([text], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(url);
}

function syncUI({ viewer, representationSelect, schemeSelect, backendSelect, selectionModeSelect, hideInsertionsCheckbox, gapThresholdInput, motifSearchButton }) {
    const representations = viewer.getRepresentations();
    const activeRepresentationId = viewer.getActiveRepresentation()?.id ?? representations[0]?.id ?? "";
    populateRepresentationOptions(representationSelect, representations);
    representationSelect.value = activeRepresentationId;
    populateSchemeOptions(
        schemeSelect,
        viewer.getAvailableSchemeOptions(),
        viewer.state.getSnapshot().scheme.key,
        viewer.getSchemeSourceRepresentation()?.id ?? null
    );
    const masking = viewer.getColumnMasking();
    hideInsertionsCheckbox.checked = masking.hideInsertionColumns === true;
    gapThresholdInput.value = masking.gapThreshold == null ? "" : String(masking.gapThreshold);
    backendSelect.value = viewer.getOptions().rendering.backend;
    selectionModeSelect.value = viewer.getSelectionMode();
    motifSearchButton.disabled = !(representationSelect.disabled !== true && representationSelect.value !== "");
}

async function main() {
    const root = document.getElementById("viewer");
    const fileInput = document.getElementById("file-input");
    const clearButton = document.getElementById("clear-selection-button");
    const exportFastaButton = document.getElementById("export-fasta-button");
    const motifSearchButton = document.getElementById("motif-search-button");
    const uploadButton = document.getElementById("upload-button");
    const loadFilesButton = document.getElementById("load-files-button");
    const schemeSelect = document.getElementById("scheme-select");
    const backendSelect = document.getElementById("backend-select");
    const representationSelect = document.getElementById("representation-select");
    const selectionModeSelect = document.getElementById("selection-mode-select");
    const hideInsertionsCheckbox = document.getElementById("hide-insertions-checkbox");
    const gapThresholdInput = document.getElementById("gap-threshold-input");
    const trackMenuButton = document.getElementById("track-menu-button");
    const trackMenuPanel = document.getElementById("track-menu-panel");
    const trackToggleList = document.getElementById("track-toggle-list");
    const trackDisplayModeLabel = document.getElementById("track-display-mode-label");
    const resetTrackDefaultsButton = document.getElementById("reset-track-defaults-button");
    const pendingFilesPanel = document.getElementById("pending-files-panel");
    const pendingFileList = document.getElementById("pending-file-list");
    const status = document.getElementById("status");
    const ui = {
        representationSelect,
        schemeSelect,
        backendSelect,
        selectionModeSelect,
        hideInsertionsCheckbox,
        gapThresholdInput,
        motifSearchButton,
    };
    const alphabetOptions = defaultAlphabetRegistry.list();
    let pendingFiles = [];
    const viewer = new MSAViewer({ root, ...DEMO_VIEWER_OPTIONS });
    await viewer.init();
    viewer.addEventListener("sequenceclick", (event) => {
        setStatus(status, `Clicked sequence ${event.detail.record.name} in ${event.detail.representationId} at row ${event.detail.rowIndex}.`);
    });

    const positionTrackMenuPanel = () => {
        if (!trackMenuButton || !trackMenuPanel || trackMenuPanel.hidden) return;
        trackMenuPanel.style.left = "0";
        trackMenuPanel.style.right = "auto";
        const panelRect = trackMenuPanel.getBoundingClientRect();
        if (panelRect.right > window.innerWidth - 12) {
            trackMenuPanel.style.left = "auto";
            trackMenuPanel.style.right = "0";
        }
    };

    const renderTrackToggles = () => {
        if (!trackToggleList) return;
        trackToggleList.replaceChildren();
        const displayMode = viewer.getTrackDisplayMode();
        for (const track of viewer.getAvailableTrackOptions()) {
            const name = document.createElement("div");
            name.className = "track-popover-name";
            name.textContent = track.label;
            trackToggleList.appendChild(name);
            const hasSingleVariant = track.variants.length === 1;

            for (const variant of track.variants) {
                const label = document.createElement("label");
                label.className = "track-popover-variant";
                const input = document.createElement("input");
                input.type = "checkbox";
                input.checked = variant.enabled === true;
                input.addEventListener("change", async () => {
                    await viewer.setTrackVariantEnabled({
                        trackId: variant.trackId,
                        representation: variant.representation,
                    }, input.checked);
                    renderTrackToggles();
                    const trackLabel = variant.label ? `${track.label} (${variant.label})` : track.label;
                    setStatus(status, `${input.checked ? "Enabled" : "Disabled"} track: ${trackLabel}`);
                });

                label.append(input);
                if (!hasSingleVariant) {
                    const text = document.createElement("span");
                    text.textContent = variant.label ?? track.label;
                    label.append(text);
                }
                trackToggleList.appendChild(label);
            }
            const fillerCount = Math.max(0, 4 - track.variants.length);
            for (let index = 0; index < fillerCount; index += 1) {
                const filler = document.createElement("div");
                filler.className = "track-popover-empty";
                filler.setAttribute("aria-hidden", "true");
                trackToggleList.appendChild(filler);
            }
        }
        if (trackDisplayModeLabel) {
            trackDisplayModeLabel.textContent = displayMode === "active-only"
                ? "Active only"
                : displayMode === "all-supported"
                    ? "All supported"
                    : "Custom";
        }
        if (resetTrackDefaultsButton) {
            const showReset = displayMode === "none";
            resetTrackDefaultsButton.setAttribute("aria-hidden", showReset ? "false" : "true");
        }
        if (trackMenuButton) {
            const availableTracks = viewer.getAvailableTrackOptions();
            const enabledCount = availableTracks
                .flatMap((track) => track.variants)
                .filter((variant) => variant.enabled === true).length;
            trackMenuButton.disabled = availableTracks.length === 0;
            trackMenuButton.textContent = enabledCount > 0 ? `Tracks (${enabledCount})` : "Tracks";
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
    trackMenuButton?.addEventListener("click", () => {
        trackMenuPanel.hidden = !trackMenuPanel.hidden;
        positionTrackMenuPanel();
    });
    document.addEventListener("click", (event) => {
        if (!trackMenuPanel || trackMenuPanel.hidden) return;
        if (trackMenuPanel.contains(event.target) || trackMenuButton?.contains(event.target)) return;
        trackMenuPanel.hidden = true;
    });
    window.addEventListener("resize", () => {
        positionTrackMenuPanel();
    });
    schemeSelect.addEventListener("change", async (event) => {
        const selectedOption = event.target.selectedOptions[0] ?? null;
        await viewer.setOptions({
            rendering: {
                scheme: event.target.value,
                schemeSourceRepresentationId: selectedOption?.dataset.representationId || null,
            },
        });
    });
    backendSelect.addEventListener("change", async (event) => {
        const requestedBackend = event.target.value;
        try {
            await viewer.setOptions({
                rendering: {
                    backend: requestedBackend,
                },
            });
            syncUI({ viewer, ...ui });
            renderTrackToggles();
            const actualBackend = requestedBackend === "auto"
                ? ` (${viewer.renderBackend})`
                : "";
            setStatus(status, `Rendering backend: ${requestedBackend}${actualBackend}`);
        } catch (error) {
            syncUI({ viewer, ...ui });
            setStatus(status, error.message);
            console.error(error);
        }
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
            renderTrackToggles();
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
            renderTrackToggles();

            pendingFiles = [];
            renderPendingFiles();

            const { totalRows, totalCols } = representations[0].store;
            setStatus(status, `Loaded ${representations.length} representations. Active: ${representations[0].label} (${totalRows} sequences x ${totalCols} columns)`);
        } catch (error) {
            setStatus(status, error.message);
            console.error(error);
        }
    });

    resetTrackDefaultsButton?.addEventListener("click", async () => {
        await viewer.setTrackDisplayMode("active-only", { clearVariants: true });
        renderTrackToggles();
        if (trackMenuPanel) {
            trackMenuPanel.hidden = true;
        }
        setStatus(status, "Track defaults reset to active-only.");
    });

    viewer.onSelectionChange((selection) => {
        const selectionCount = selection?.componentCount ?? 0;
        syncSelectionButtons(clearButton, exportFastaButton, selectionCount);
    });

    clearButton.onclick = () => {
        viewer.clearSelection();
    };

    exportFastaButton.addEventListener("click", async () => {
        try {
            const fasta = await viewer.exportSelectionAsFasta();
            if (!fasta) {
                setStatus(status, "No selection to export.");
                return;
            }
            const activeRepresentation = viewer.getActiveRepresentation();
            const fileStem = activeRepresentation?.id ?? "selection";
            downloadTextFile(fasta, `${fileStem}-selection.fasta`, "text/fasta;charset=utf-8");
            setStatus(status, `Exported FASTA for current selection from ${activeRepresentation?.label ?? fileStem}.`);
        } catch (error) {
            setStatus(status, error.message);
            console.error(error);
        }
    });

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

    syncSelectionButtons(clearButton, exportFastaButton, viewer.getSelection()?.componentCount ?? 0);
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
