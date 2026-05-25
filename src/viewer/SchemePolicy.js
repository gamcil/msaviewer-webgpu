import { getDefaultSchemeKeyForAlphabet, isSchemeSupportedForAlphabet } from "../schemes/registry.js";

export class SchemePolicy {
    constructor({
        getActiveAlphabet,
        getSchemes,
    }) {
        this.getActiveAlphabet = getActiveAlphabet;
        this.getSchemes = getSchemes;
    }

    isSupported(schemeKey, alphabet = this.getActiveAlphabet()) {
        return isSchemeSupportedForAlphabet(schemeKey, alphabet, this.getSchemes());
    }

    getFallback(alphabet = this.getActiveAlphabet()) {
        return getDefaultSchemeKeyForAlphabet(alphabet, this.getSchemes());
    }

    getCompatibleScheme(schemeKey, alphabet = this.getActiveAlphabet()) {
        if (this.isSupported(schemeKey, alphabet)) {
            return schemeKey;
        }
        return this.getFallback(alphabet);
    }

    requiresColumnProfile(schemeKey) {
        const scheme = this.getSchemes()[schemeKey];
        return Boolean(scheme && scheme.profileKind !== "none");
    }

    requiresColumnMetrics(schemeKey) {
        const scheme = this.getSchemes()[schemeKey];
        return scheme?.requiresColumnMetrics === true;
    }
}
