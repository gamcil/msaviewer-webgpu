export function isAsciiWhitespace(charCode) {
    return charCode === 9 || (charCode >= 10 && charCode <= 13) || charCode === 32;
}

export function firstNonWhitespaceIndex(line) {
    let index = 0;
    while (index < line.length && isAsciiWhitespace(line.charCodeAt(index))) {
        index += 1;
    }
    return index;
}

export function stripSequenceWhitespace(line) {
    for (let index = 0; index < line.length; index += 1) {
        if (isAsciiWhitespace(line.charCodeAt(index))) {
            return line.replace(/\s+/g, "");
        }
    }
    return line;
}

export async function* iterateLines(input, formatName = "alignment") {
    if (typeof input === "string") {
        const lines = input.replace(/\r/g, "").split("\n");
        for (const line of lines) {
            yield line;
        }
        return;
    }
    let stream = null;
    if (input instanceof ReadableStream) {
        stream = input;
    } else if (typeof Blob !== "undefined" && input instanceof Blob) {
        stream = input.stream();
    } else if (input && typeof input.stream === "function") {
        stream = input.stream();
    }
    if (!stream) {
        throw new Error(`Unsupported ${formatName}`);
    }
    const reader = stream.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = "";
    while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value.replace(/\r/g, "").replace(/\0/g, "");
        let newlineIndex = buffer.indexOf("\n");
        while (newlineIndex !== -1) {
            yield buffer.slice(0, newlineIndex);
            buffer = buffer.slice(newlineIndex + 1);
            newlineIndex = buffer.indexOf("\n");
        }
    }
    if (buffer.length > 0) {
        yield buffer;
    }
}
