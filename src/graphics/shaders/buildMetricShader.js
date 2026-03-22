import metricShaderTemplate from "./metrics.compute.wgsl?raw";

function buildQualityFunction(alphabet) {
    const metricConfig = alphabet.metricConfig;

    if (!alphabet.supports?.quality) {
        return `
fn calculate_quality(final_counts: array<u32, ${metricConfig.bucketStride}>) -> f32 {
    _ = final_counts;
    return 0.0;
}`;
    }

    return `
fn calculate_quality(final_counts: array<u32, ${metricConfig.bucketStride}>) -> f32 {
    var non_gap_count = 0u;
    for (var i = 0u; i < ${metricConfig.coreSize}u; i = i + 1u) {
        non_gap_count += final_counts[i];
    }
    if (non_gap_count < 2u || uniforms.msa_height == 0u) {
        return 0.0;
    }
    let occupancy = f32(non_gap_count) / f32(uniforms.msa_height);

    var quality = 0.0;
    var total_pairs = 0.0;

    for (var i = 0u; i < ${metricConfig.coreSize}u; i = i + 1u) {
        let count_i = f32(final_counts[i]);
        if (count_i == 0.0) { continue; }

        for (var j = 0u; j < ${metricConfig.coreSize}u; j = j + 1u) {
            let count_j = f32(final_counts[j]);
            if (count_j == 0.0) { continue; }

            let pair_count = count_i * count_j;
            let pair_score = f32(quality_matrix[i * ${metricConfig.qualityMatrixSize}u + j]);
            let self_i = f32(quality_matrix[i * ${metricConfig.qualityMatrixSize}u + i]);
            let self_j = f32(quality_matrix[j * ${metricConfig.qualityMatrixSize}u + j]);
            let denom = max(self_i, self_j);
            let ratio = select(0.0, pair_score / denom, denom > 0.0);
            quality += pair_count * ratio;
            total_pairs += pair_count;
        }
    }
    if (total_pairs == 0.0) { return 0.0; }
    return max(0.0, (quality / total_pairs) * occupancy);
}`;
}

export function buildMetricShaderCode(alphabet) {
    const metricConfig = alphabet.metricConfig;
    if (!metricConfig) {
        throw new Error(`Alphabet ${alphabet.id} is missing metricConfig.`);
    }

    return metricShaderTemplate
        .replaceAll("__BUCKET_STRIDE__", String(metricConfig.bucketStride))
        .replaceAll("__CORE_SIZE__", String(metricConfig.coreSize))
        .replaceAll("__GAP_BUCKET_INDEX__", String(metricConfig.gapBucketIndex))
        .replace("__RESIDUE_TO_INDEX_CASES__", metricConfig.residueToIndexCasesWgsl.trim())
        .replace("__QUALITY_FUNCTION__", buildQualityFunction(alphabet));
}
