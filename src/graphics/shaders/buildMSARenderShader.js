import renderShaderTemplate from "./msa.render.wgsl";
import { buildSchemeColorWgsl } from "./buildSchemeColorWgsl.js";

export function buildMSARenderShaderCode(alphabet) {
    const renderConfig = alphabet.renderConfig;
    if (!renderConfig) {
        throw new Error(`Alphabet ${alphabet.id} is missing renderConfig.`);
    }

    return renderShaderTemplate
        .replace("__SCHEME_COLOR_WGSL__", buildSchemeColorWgsl(alphabet));
}
