import { SCHEMES } from "../../../schemes/registry.js";
import { resolveSymbolColor } from "../../../schemes/symbolColorResolver.js";

const DARK_DEFAULT_BACKGROUND = "#141417";
const LIGHT_DEFAULT_BACKGROUND = "#ffffff";

const BIT_HYDROPHOBIC_60 = 1 << 0;
const BIT_KR_60 = 1 << 1;
const BIT_KRQ_80_ANY = 1 << 2;
const BIT_QE_50 = 1 << 3;
const BIT_ED_50 = 1 << 4;
const BIT_EQD_80_ANY = 1 << 5;
const BIT_DEN_80_ANY = 1 << 6;
const BIT_N_50 = 1 << 7;
const BIT_QTKR_80_ANY = 1 << 8;
const BIT_TS_50 = 1 << 9;
const BIT_ST_80_ANY = 1 << 10;
const BIT_C_80 = 1 << 11;
const BIT_G_PRESENT = 1 << 12;
const BIT_P_PRESENT = 1 << 13;
const BIT_AROMATIC_80_ANY = 1 << 14;

export function normalizeResidue(raw) {
    if (raw >= 97 && raw <= 122) {
        return raw - 32;
    }
    return raw;
}

export function isGapResidue(raw) {
    return raw === 0 || raw === 45 || raw === 46 || raw === 32;
}

export function rawToGlyph(raw) {
    return isGapResidue(raw) ? "-" : String.fromCharCode(raw);
}

export function defaultSchemeColor(darkMode) {
    return darkMode ? DARK_DEFAULT_BACKGROUND : LIGHT_DEFAULT_BACKGROUND;
}

function qualityIndexForAlphabet(raw, alphabet) {
    const residue = normalizeResidue(raw);
    if (alphabet.id === "aa") {
        const mapping = {
            65: 0, 82: 1, 78: 2, 68: 3, 67: 4, 81: 5, 69: 6, 71: 7, 72: 8, 73: 9,
            76: 10, 75: 11, 77: 12, 70: 13, 80: 14, 83: 15, 84: 16, 87: 17, 89: 18, 86: 19,
            66: 20, 74: 21, 90: 22, 88: 23,
        };
        return mapping[residue] ?? 24;
    }
    if (alphabet.id === "3di") {
        const mapping = {
            65: 0, 67: 1, 68: 2, 69: 3, 70: 4, 71: 5, 72: 6, 73: 7, 75: 8, 76: 9,
            77: 10, 78: 11, 80: 12, 81: 13, 82: 14, 83: 15, 84: 16, 86: 17, 87: 18, 89: 19,
            88: 20,
        };
        return mapping[residue] ?? 20;
    }
    return 0;
}

export function resolveCellSchemeColor({ rawResidue, rawCol, schemeKey, schemeAlphabet, schemeProfileData, darkMode }) {
    const fallback = defaultSchemeColor(darkMode);
    if (isGapResidue(rawResidue)) {
        return fallback;
    }
    const scheme = SCHEMES[schemeKey];
    if (!scheme) return fallback;
    if (scheme.type === "residueProperty") {
        return resolveSymbolColor({
            glyph: rawToGlyph(normalizeResidue(rawResidue)),
            alphabet: schemeAlphabet,
            scheme: schemeKey,
        }) ?? fallback;
    }

    const mask = schemeProfileData?.[rawCol] ?? 0;
    const residue = normalizeResidue(rawResidue);

    if (schemeKey === "pid") {
        const consensusResidue = mask & 0xFF;
        const bucket = (mask >> 8) & 0x3;
        if (consensusResidue === 0) return fallback;
        if (residue === consensusResidue && bucket === 3) return darkMode ? "#e5e5ff" : "#0000ff";
        if (residue === consensusResidue && bucket === 2) return darkMode ? "#a6a6ff" : "#6666ff";
        if (residue === consensusResidue && bucket === 1) return darkMode ? "#6666ff" : "#ccccff";
        return fallback;
    }

    if (schemeKey === "similarity") {
        const consensusResidue = mask & 0xFF;
        if (!consensusResidue || isGapResidue(consensusResidue)) return fallback;
        const resIdx = qualityIndexForAlphabet(rawResidue, schemeAlphabet);
        const consensusIdx = qualityIndexForAlphabet(consensusResidue, schemeAlphabet);
        if (resIdx === consensusIdx) return "#6666ff";
        const score = schemeAlphabet.qualityMatrix?.[(resIdx * schemeAlphabet.renderConfig.qualityMatrixSize) + consensusIdx] ?? -1;
        return score >= 0 ? "#ccccff" : fallback;
    }

    if (schemeKey === "clustalx") {
        const isHydrophobic = residue === 65 || residue === 67 || residue === 70 || residue === 72 || residue === 73 || residue === 76 || residue === 77 || residue === 80 || residue === 86 || residue === 87;
        if (isHydrophobic && (mask & BIT_HYDROPHOBIC_60)) return "#80b3e6";
        if ((residue === 75 || residue === 82) && ((mask & BIT_KR_60) || (mask & BIT_KRQ_80_ANY))) return "#e63333";
        if ((residue === 81 || residue === 69) && ((mask & BIT_QE_50) || (mask & BIT_EQD_80_ANY))) return "#00cc00";
        if ((residue === 68 || residue === 69) && ((mask & BIT_ED_50) || (mask & BIT_EQD_80_ANY))) return "#e61ae6";
        if (residue === 78 && ((mask & BIT_N_50) || (mask & BIT_DEN_80_ANY))) return "#00cc00";
        if ((residue === 81 || residue === 84) && ((mask & BIT_QTKR_80_ANY) || (mask & BIT_TS_50))) return "#00cc00";
        if ((residue === 83 || residue === 84) && ((mask & BIT_TS_50) || (mask & BIT_ST_80_ANY))) return "#00cc00";
        if (residue === 67 && (mask & BIT_C_80)) return "#f2bf33";
        if (residue === 71 && (mask & BIT_G_PRESENT)) return "#f28c33";
        if (residue === 80 && (mask & BIT_P_PRESENT)) return "#f28c33";
        if ((residue === 72 || residue === 89) && (mask & BIT_AROMATIC_80_ANY)) return "#1acccc";
        return fallback;
    }

    return fallback;
}
