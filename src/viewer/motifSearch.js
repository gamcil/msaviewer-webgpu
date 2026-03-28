import { materializeWindowFromTiles } from "../alignment/tiledStorage.js";

const ASCII_DECODER = new TextDecoder("ascii");

export function compileMotifQuery(rawQuery) {
    const query = (rawQuery || "").trim().toUpperCase();
    if (!query) return null;

    const escapeLiteral = (ch) => ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const escapeClass = (value) => value.replace(/[\\\]^]/g, "\\$&");

    let source = "";
    let len = 0;
    let i = 0;
    while (i < query.length) {
        const ch = query[i];
        if (ch === "[") {
            const j = query.indexOf("]", i + 1);
            if (j > i + 1) {
                const cls = query.slice(i + 1, j).replace(/\s+/g, "");
                if (cls.length > 0) {
                    source += `[${escapeClass(cls)}]`;
                    len += 1;
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
            len += repeat;
            i = j;
            continue;
        }
        source += escapeLiteral(ch);
        len += 1;
        i += 1;
    }

    if (!source || len <= 0) return null;
    return {
        query,
        source,
        len,
        regex: new RegExp(`(?=(${source}))`, "g"),
    };
}

function projectRowVisibleBytes(rowBytes, visibleToRaw) {
    if (!visibleToRaw) {
        return rowBytes;
    }
    const projected = new Uint8Array(visibleToRaw.length);
    for (let i = 0; i < visibleToRaw.length; i += 1) {
        projected[i] = rowBytes[visibleToRaw[i]];
    }
    return projected;
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
    const hitsByRow = new Array(alignmentStore.totalRows);
    let matchCount = 0;

    for (let row = 0; row < alignmentStore.totalRows; row += 1) {
        if (shouldContinue && !shouldContinue()) {
            return null;
        }
        const rowBytes = await materializeWindowFromTiles(
            alignmentStore,
            row,
            1,
            0,
            alignmentStore.totalCols,
            decodedTileCache,
        );
        const visibleRowBytes = projectRowVisibleBytes(rowBytes, visibleToRaw);
        const sequence = ASCII_DECODER.decode(visibleRowBytes).toUpperCase();
        const hits = [];
        compiledQuery.regex.lastIndex = 0;
        let match = null;
        while ((match = compiledQuery.regex.exec(sequence)) !== null) {
            hits.push({ start: match.index, len: compiledQuery.len });
            matchCount += 1;
            if (compiledQuery.regex.lastIndex === match.index) {
                compiledQuery.regex.lastIndex += 1;
            }
        }
        hitsByRow[row] = hits;
    }

    return {
        query: compiledQuery.query,
        visibilitySignature,
        hitsByRow,
        matchCount,
    };
}
