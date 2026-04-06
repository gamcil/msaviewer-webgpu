import { readFile } from "node:fs/promises";

export function wgslPlugin() {
    return {
        name: "wgsl-as-string",
        async load(id) {
            if (!id.endsWith(".wgsl")) {
                return null;
            }
            const source = await readFile(id, "utf8");
            return {
                code: `export default ${JSON.stringify(source)};`,
                map: null,
            };
        },
    };
}
