const SYMBOL_COLOR_TABLES = {
    aa: {
        hydrophobicity: {
            A: "#ad0052", R: "#0000ff", N: "#0c00f3", D: "#0c00f3", C: "#c2003d",
            Q: "#0c00f3", E: "#0c00f3", G: "#6a0095", H: "#1500ea", I: "#ff0000",
            L: "#ea0015", K: "#0000ff", M: "#b0004f", F: "#cb0034", P: "#4600b9",
            S: "#5e00a1", T: "#61009e", W: "#5b00a4", Y: "#4f00b0", V: "#f60009",
            B: "#0c00f3", X: "#680097", Z: "#0c00f3",
        },
        zappo: {
            A: "#ffafaf", R: "#6464ff", N: "#00ff00", D: "#ff0000", C: "#ffff00",
            Q: "#00ff00", E: "#ff0000", G: "#ff00ff", H: "#6464ff", I: "#ffafaf",
            L: "#ffafaf", K: "#6464ff", M: "#ffafaf", F: "#ffc800", P: "#ff00ff",
            S: "#00ff00", T: "#00ff00", W: "#ffc800", Y: "#ffc800", V: "#ffafaf",
        },
        taylor: {
            A: "#ccff00", R: "#0000ff", N: "#cc00ff", D: "#ff0000", C: "#ffff00",
            Q: "#ff00cc", E: "#ff0066", G: "#ff9900", H: "#0066ff", I: "#66ff00",
            L: "#33ff00", K: "#6600ff", M: "#00ff00", F: "#00ff66", P: "#ffcc00",
            S: "#ff3300", T: "#ff6600", W: "#00ccff", Y: "#00ffcc", V: "#99ff00",
        },
        gecosBlossom: {
            A: "#8bc4b4", R: "#fc9502", N: "#b5c206", D: "#5fa505", C: "#0893fe",
            Q: "#bf8527", E: "#dbb501", G: "#00d384", H: "#ff5701", I: "#9ab9f3",
            L: "#cda5dc", K: "#fea527", M: "#f5a1b8", F: "#f74fa8", P: "#10d632",
            S: "#7e9d59", T: "#00a29c", W: "#fe08fb", Y: "#ff4e7a", V: "#87c0e4",
        },
        gecosSunset: {
            A: "#fea0fd", R: "#85746a", N: "#abc8f5", D: "#2e7bbf", C: "#fc0cfe",
            Q: "#8c6e81", E: "#677893", G: "#2799ff", H: "#dbc58e", I: "#fa21a1",
            L: "#e01e82", K: "#debecd", M: "#d13e7b", F: "#ff385d", P: "#5766f9",
            S: "#e7b4fd", T: "#a658b7", W: "#ff3701", Y: "#cb5339", V: "#fe51b8",
        },
        gecosOcean: {
            A: "#6be370", R: "#52c7fd", N: "#28e8cc", D: "#2fbe76", C: "#4981f8",
            Q: "#4dafc1", E: "#3aa996", G: "#01c930", H: "#2997ff", I: "#67fcb4",
            L: "#55ef97", K: "#5fbed5", M: "#57f0bd", F: "#55d4fa", P: "#26ee5d",
            S: "#2ce49c", T: "#23d97e", W: "#49aaff", Y: "#53c0ff", V: "#64fa9f",
        },
        helixPropensity: {
            A: "#e8e894", R: "#7575e7", N: "#b0b0d1", D: "#e3e367", C: "#a1a1dc",
            Q: "#9696e0", E: "#ffff00", G: "#c0c0c3", H: "#bdbdc6", I: "#7777e5",
            L: "#47ff00", K: "#8787e5", M: "#2323ff", F: "#5656ef", P: "#d1d1b3",
            S: "#cdcdb7", T: "#c9c9bb", W: "#8c8ce1", Y: "#aeaed3", V: "#5555f1",
        },
        strandPropensity: {
            A: "#868686", R: "#d8d8d8", N: "#ababab", D: "#aaaaaa", C: "#e6e6e6",
            Q: "#c0c0c0", E: "#959595", G: "#868686", H: "#d2d2d2", I: "#fefefe",
            L: "#fafafa", K: "#a7a7a7", M: "#e7e7e7", F: "#d8d8d8", P: "#6b6b6b",
            S: "#898989", T: "#a1a1a1", W: "#b7b7b7", Y: "#d6d6d6", V: "#d6d6d6",
        },
        turnPropensity: {
            A: "#474747", R: "#cfcfcf", N: "#c5c5c5", D: "#a7a7a7", C: "#a7a7a7",
            Q: "#cacaca", E: "#a4a4a4", G: "#ffffff", H: "#aeaeae", I: "#5c5c5c",
            L: "#515151", K: "#d1d1d1", M: "#6c6c6c", F: "#636363", P: "#f1f1f1",
            S: "#ebebeb", T: "#cacaca", W: "#494949", Y: "#666666", V: "#494949",
        },
        buriedIndex: {
            A: "#0083e6", R: "#b52424", N: "#7a4888", D: "#4865aa", C: "#00ce89",
            Q: "#7b4788", E: "#4765ab", G: "#435eb1", H: "#ac2a6d", I: "#00e278",
            L: "#00ff5f", K: "#cc113c", M: "#00d684", F: "#28a67a", P: "#61549f",
            S: "#5160af", T: "#30769b", W: "#1db96e", Y: "#505faf", V: "#00de7b",
        },
    },
    "3di": {
        "3di": {
            A: "#df9a8c", C: "#fb72c5", D: "#b4a3d8", E: "#ff5701", F: "#d99e81",
            G: "#7491c5", H: "#94abe1", I: "#609d7b", K: "#d7a304", L: "#fe4c8b",
            M: "#12a565", N: "#d570fd", P: "#cb99c4", Q: "#da8e99", R: "#9487d0",
            S: "#e843fe", T: "#42a299", V: "#fb7edc", W: "#d1a368", X: "#c0c0c0",
            Y: "#17a8fd",
        },
    },
};

export function resolveSymbolColor({ glyph, alphabet, scheme }) {
    if (!glyph || !alphabet) return null;
    if (!scheme) return null;
    const table = SYMBOL_COLOR_TABLES[alphabet.id]?.[scheme];
    if (!table) return null;
    return table[glyph] ?? null;
}
