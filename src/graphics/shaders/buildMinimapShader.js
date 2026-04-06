import minimapShaderTemplate from "./minimap.compute.wgsl";
import { buildSchemeColorWgsl } from "./buildSchemeColorWgsl.js";

export function buildMinimapShaderCode(alphabet) {
    const renderConfig = alphabet.renderConfig;
    if (!renderConfig) {
        throw new Error(`Alphabet ${alphabet.id} is missing renderConfig.`);
    }

    return minimapShaderTemplate
        .replace("__SCHEME_COLOR_WGSL__", buildSchemeColorWgsl(alphabet));
}
