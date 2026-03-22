export class AlphabetRegistry {
    constructor() {
        this.alphabets = new Map();
    }
    register(alphabet) {
        if (!alphabet?.id) {
            throw new Error("Alphabet definitions must include an id.");
        }
        this.alphabets.set(alphabet.id, alphabet);
        return alphabet;
    }
    get(id) {
        return this.alphabets.get(id) ?? null;
    }
    has(id) {
        return this.alphabets.has(id);
    }
    list() {
        return Array.from(this.alphabets.values());
    }
}
