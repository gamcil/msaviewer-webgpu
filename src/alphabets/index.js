import { AlphabetRegistry } from "./AlphabetRegistry.js";
import { aminoAcidAlphabet } from "./aminoAcid.js";
import { nucleotideAlphabet } from "./nucleotide.js";
import { threeDIAlphabet } from "./threeDI.js";

export { AlphabetRegistry } from "./AlphabetRegistry.js";
export { aminoAcidAlphabet } from "./aminoAcid.js";
export { nucleotideAlphabet } from "./nucleotide.js";
export { threeDIAlphabet } from "./threeDI.js";

export const defaultAlphabetRegistry = new AlphabetRegistry();
defaultAlphabetRegistry.register(aminoAcidAlphabet);
defaultAlphabetRegistry.register(nucleotideAlphabet);
defaultAlphabetRegistry.register(threeDIAlphabet);
