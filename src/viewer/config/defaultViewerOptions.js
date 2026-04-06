export const DEFAULT_VIEWER_OPTIONS = {
    alphabet: "aa",
    data: {
        representations: [],
        activeRepresentationId: null,
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
            fullWidth: false,
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
    theme: {
        mode: "auto",
        typography: {
            uiFontFamily: "\"IBM Plex Sans\", sans-serif",
            uiFontSize: 13,
            headerFontFamily: "\"IBM Plex Mono\", \"IBM Plex Sans\", monospace",
            headerFontSize: 14,
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
    interactions: {
        onSequenceClick: null,
    },
    rendering: {
        backend: "auto",
        scheme: "clustalx",
        schemeSourceRepresentationId: null,
    },
};
