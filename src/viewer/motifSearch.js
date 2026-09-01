import { getTileIndex, loadDecodedTile } from "../alignment/tiledStorage.js";

const ASCII_BYTE_COUNT = 256;
const WILDCARD_TOKEN = new Uint8Array(ASCII_BYTE_COUNT).fill(1);

function normalizeAscii(byte) {
    return byte >= 97 && byte <= 122 ? byte - 32 : byte;
}

function createLiteralToken(char) {
    const token = new Uint8Array(ASCII_BYTE_COUNT);
    const byte = char.charCodeAt(0);
    if (byte < ASCII_BYTE_COUNT) {
        token[byte] = 1;
    }
    return token;
}

function createClassToken(value, escapeClass) {
    const token = new Uint8Array(ASCII_BYTE_COUNT);
    const regex = new RegExp(`^[${escapeClass(value)}]$`);
    for (let byte = 0; byte < ASCII_BYTE_COUNT; byte += 1) {
        token[byte] = regex.test(String.fromCharCode(byte)) ? 1 : 0;
    }
    return token;
}

function createByteMatcher(tokens) {
    const wordCount = Math.ceil(tokens.length / 32);
    const acceptedByByte = Array.from(
        { length: ASCII_BYTE_COUNT },
        () => new Uint32Array(wordCount),
    );
    for (let position = 0; position < tokens.length; position += 1) {
        const word = Math.floor(position / 32);
        const bit = 1 << (position % 32);
        for (let byte = 0; byte < ASCII_BYTE_COUNT; byte += 1) {
            if (tokens[position][byte]) {
                acceptedByByte[byte][word] |= bit;
            }
        }
    }
    return {
        length: tokens.length,
        wordCount,
        acceptedByByte,
        matchWord: Math.floor((tokens.length - 1) / 32),
        matchBit: 1 << ((tokens.length - 1) % 32),
    };
}

function advanceByteMatcher(matcher, states, stateOffset, byte) {
    const accepted = matcher.acceptedByByte[byte];
    let carry = 1;
    for (let word = 0; word < matcher.wordCount; word += 1) {
        const previous = states[stateOffset + word];
        states[stateOffset + word] = (((previous << 1) | carry) & accepted[word]) >>> 0;
        carry = previous >>> 31;
    }
    return (states[stateOffset + matcher.matchWord] & matcher.matchBit) !== 0;
}

export function compileMotifQuery(rawQuery) {
    const query = (rawQuery || "").trim().toUpperCase();
    if (!query) return null;

    const escapeLiteral = (ch) => ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const escapeClass = (value) => value.replace(/[\\\]^]/g, "\\$&");

    let source = "";
    const tokens = [];
    let i = 0;
    while (i < query.length) {
        const ch = query[i];
        if (ch === "[") {
            const j = query.indexOf("]", i + 1);
            if (j > i + 1) {
                const cls = query.slice(i + 1, j).replace(/\s+/g, "");
                if (cls.length > 0) {
                    source += `[${escapeClass(cls)}]`;
                    tokens.push(createClassToken(cls, escapeClass));
                    i = j + 1;
                    continue;
                }
            }
        }
        if (ch === "X") {
            let j = i + 1;
            while (j < query.length && /[0-9]/.test(query[j])) j += 1;
            const repeat = j > i + 1 ? Math.max(1, parseInt(query.slice(i + 1, j), 10) || 1) : 1;
            source += ".".repeat(repeat);
            for (let count = 0; count < repeat; count += 1) {
                tokens.push(WILDCARD_TOKEN);
            }
            i = j;
            continue;
        }
        source += escapeLiteral(ch);
        tokens.push(createLiteralToken(ch));
        i += 1;
    }

    if (!source || tokens.length === 0) return null;
    return {
        query,
        source,
        len: tokens.length,
        regex: new RegExp(`(?=(${source}))`, "g"),
        matcher: createByteMatcher(tokens),
    };
}

function getVisibleTileEnd(visibleToRaw, visibleIndex, tileMeta) {
    if (!visibleToRaw) {
        return tileMeta.colStart + tileMeta.colCount;
    }
    const tileColEnd = tileMeta.colStart + tileMeta.colCount;
    let nextVisibleIndex = visibleIndex;
    while (nextVisibleIndex < visibleToRaw.length && visibleToRaw[nextVisibleIndex] < tileColEnd) {
        nextVisibleIndex += 1;
    }
    return nextVisibleIndex;
}

export async function searchVisibleMotifHits({
    alignmentStore,
    columnVisibility,
    compiledQuery,
    decodedTileCache,
    shouldContinue = null,
}) {
    if (!alignmentStore || !compiledQuery) {
        return {
            query: "",
            visibilitySignature: columnVisibility?.signature ?? "unmasked",
            hitsByRow: [],
            matchCount: 0,
        };
    }

    const visibilitySignature = columnVisibility?.signature ?? "unmasked";
    const visibleToRaw = columnVisibility?.visibleToRaw ?? null;
    const hitsByRow = Array.from({ length: alignmentStore.totalRows }, () => []);
    const { matcher } = compiledQuery;
    let matchCount = 0;

    for (let rowTile = 0; rowTile < alignmentStore.rowTileCount; rowTile += 1) {
        if (shouldContinue && !shouldContinue()) {
            return null;
        }
        const firstTile = alignmentStore.tiles[getTileIndex(alignmentStore, rowTile, 0)];
        const states = new Uint32Array(firstTile.rowCount * matcher.wordCount);
        let visibleIndex = 0;

        for (let colTile = 0; colTile < alignmentStore.colTileCount; colTile += 1) {
            if (shouldContinue && !shouldContinue()) {
                return null;
            }
            const tileIndex = getTileIndex(alignmentStore, rowTile, colTile);
            const tileMeta = alignmentStore.tiles[tileIndex];
            const tileData = await loadDecodedTile(alignmentStore, tileIndex, decodedTileCache);
            const tileVisibleEnd = getVisibleTileEnd(visibleToRaw, visibleIndex, tileMeta);
            const visibleCount = visibleToRaw
                ? tileVisibleEnd - visibleIndex
                : tileMeta.colCount;

            for (let localRow = 0; localRow < tileMeta.rowCount; localRow += 1) {
                const rowIndex = tileMeta.rowStart + localRow;
                const stateOffset = localRow * matcher.wordCount;
                const rowOffset = localRow * alignmentStore.tileCols;
                for (let offset = 0; offset < visibleCount; offset += 1) {
                    const visibleCol = visibleIndex + offset;
                    const localCol = visibleToRaw
                        ? visibleToRaw[visibleCol] - tileMeta.colStart
                        : offset;
                    const byte = normalizeAscii(tileData[rowOffset + localCol]);
                    if (advanceByteMatcher(matcher, states, stateOffset, byte)) {
                        hitsByRow[rowIndex].push({
                            start: visibleCol - matcher.length + 1,
                            len: matcher.length,
                        });
                        matchCount += 1;
                    }
                }
            }
            visibleIndex = tileVisibleEnd;
        }
    }

    return {
        query: compiledQuery.query,
        visibilitySignature,
        hitsByRow,
        matchCount,
    };
}
