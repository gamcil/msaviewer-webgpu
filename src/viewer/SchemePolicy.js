import {
    SCHEMES,
    getDefaultSchemeKeyForAlphabet,
    isSchemeSupportedForAlphabet,
} from "../schemes/registry.js";

export class SchemePolicy {
    constructor({
        getActiveAlphabet,
    }) {
        this.getActiveAlphabet = getActiveAlphabet;
    }

    isSupported(schemeKey, alphabet = this.getActiveAlphabet()) {
        return isSchemeSupportedForAlphabet(schemeKey, alphabet);
    }

    getFallback(alphabet = this.getActiveAlphabet()) {
        return getDefaultSchemeKeyForAlphabet(alphabet);
    }

    getCompatibleScheme(schemeKey, alphabet = this.getActiveAlphabet()) {
        if (this.isSupported(schemeKey, alphabet)) {
            return schemeKey;
        }
        return this.getFallback(alphabet);
    }

    requiresColumnProfile(schemeKey) {
        return SCHEMES[schemeKey]?.type === "columnStatistic";
    }
}
