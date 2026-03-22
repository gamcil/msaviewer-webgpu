import renderShaderTemplate from "./msa.render.wgsl?raw";

export function buildMSARenderShaderCode(alphabet) {
    const renderConfig = alphabet.renderConfig;
    if (!renderConfig) {
        throw new Error(`Alphabet ${alphabet.id} is missing renderConfig.`);
    }

    return renderShaderTemplate
        .replace("__QUALITY_INDEX_CASES__", renderConfig.qualityIndexCasesWgsl.trim())
        .replaceAll("__QUALITY_DEFAULT_INDEX__", String(renderConfig.qualityDefaultIndex))
        .replaceAll("__QUALITY_MATRIX_SIZE__", String(renderConfig.qualityMatrixSize));
}
