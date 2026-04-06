import metricShaderTemplate from "./metrics.compute.wgsl";

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

function buildConservationFunction(alphabet) {
    const metricConfig = alphabet.metricConfig;

    if (alphabet.id !== "aa") {
        return `
fn calculate_conservation(final_counts: array<u32, ${metricConfig.bucketStride}>, non_gap_count: u32) -> vec2<f32> {
    _ = final_counts;
    _ = non_gap_count;
    return vec2<f32>(0.0, 0.0);
}`;
    }

    return `
const AMAS_PROP_HYDROPHOBIC: u32 = 1u << 0u;
const AMAS_PROP_POLAR: u32 = 1u << 1u;
const AMAS_PROP_SMALL: u32 = 1u << 2u;
const AMAS_PROP_PROLINE: u32 = 1u << 3u;
const AMAS_PROP_TINY: u32 = 1u << 4u;
const AMAS_PROP_ALIPHATIC: u32 = 1u << 5u;
const AMAS_PROP_AROMATIC: u32 = 1u << 6u;
const AMAS_PROP_POSITIVE: u32 = 1u << 7u;
const AMAS_PROP_NEGATIVE: u32 = 1u << 8u;
const AMAS_PROP_CHARGED: u32 = 1u << 9u;
const AMAS_PROPERTY_MASK_ALL: u32 =
    AMAS_PROP_HYDROPHOBIC |
    AMAS_PROP_POLAR |
    AMAS_PROP_SMALL |
    AMAS_PROP_PROLINE |
    AMAS_PROP_TINY |
    AMAS_PROP_ALIPHATIC |
    AMAS_PROP_AROMATIC |
    AMAS_PROP_POSITIVE |
    AMAS_PROP_NEGATIVE |
    AMAS_PROP_CHARGED;
const AMAS_NEGATIVE_SHIFT: u32 = 10u;
const AMAS_IDENTITY_BIT: u32 = 1u << 20u;
const AMAS_ALL_PROPERTIES_BIT: u32 = 1u << 21u;

fn amas_property_bits(aa: u32) -> u32 {
    switch aa {
        case 0u: { return AMAS_PROP_HYDROPHOBIC | AMAS_PROP_SMALL | AMAS_PROP_TINY; } // A
        case 1u: { return AMAS_PROP_POLAR | AMAS_PROP_POSITIVE | AMAS_PROP_CHARGED; } // R
        case 2u: { return AMAS_PROP_POLAR | AMAS_PROP_SMALL; } // N
        case 3u: { return AMAS_PROP_POLAR | AMAS_PROP_SMALL | AMAS_PROP_NEGATIVE | AMAS_PROP_CHARGED; } // D
        case 4u: { return AMAS_PROP_HYDROPHOBIC | AMAS_PROP_SMALL; } // C
        case 5u: { return AMAS_PROP_POLAR; } // Q
        case 6u: { return AMAS_PROP_POLAR | AMAS_PROP_NEGATIVE | AMAS_PROP_CHARGED; } // E
        case 7u: { return AMAS_PROP_HYDROPHOBIC | AMAS_PROP_SMALL | AMAS_PROP_TINY; } // G
        case 8u: { return AMAS_PROP_HYDROPHOBIC | AMAS_PROP_POLAR | AMAS_PROP_AROMATIC | AMAS_PROP_POSITIVE | AMAS_PROP_CHARGED; } // H
        case 9u: { return AMAS_PROP_HYDROPHOBIC | AMAS_PROP_ALIPHATIC; } // I
        case 10u: { return AMAS_PROP_HYDROPHOBIC | AMAS_PROP_ALIPHATIC; } // L
        case 11u: { return AMAS_PROP_POLAR | AMAS_PROP_POSITIVE | AMAS_PROP_CHARGED; } // K
        case 12u: { return AMAS_PROP_HYDROPHOBIC; } // M
        case 13u: { return AMAS_PROP_HYDROPHOBIC | AMAS_PROP_AROMATIC; } // F
        case 14u: { return AMAS_PROP_SMALL | AMAS_PROP_PROLINE; } // P
        case 15u: { return AMAS_PROP_POLAR | AMAS_PROP_SMALL | AMAS_PROP_TINY; } // S
        case 16u: { return AMAS_PROP_POLAR | AMAS_PROP_SMALL; } // T
        case 17u: { return AMAS_PROP_HYDROPHOBIC | AMAS_PROP_POLAR | AMAS_PROP_AROMATIC; } // W
        case 18u: { return AMAS_PROP_HYDROPHOBIC | AMAS_PROP_POLAR | AMAS_PROP_AROMATIC; } // Y
        case 19u: { return AMAS_PROP_HYDROPHOBIC | AMAS_PROP_SMALL | AMAS_PROP_ALIPHATIC; } // V
        default: { return 0u; }
    }
}

fn calculate_conservation(final_counts: array<u32, ${metricConfig.bucketStride}>, non_gap_count: u32) -> vec2<f32> {
    if (non_gap_count == 0u || uniforms.msa_height == 0u) {
        return vec2<f32>(0.0, 0.0);
    }

    let gap_count = final_counts[${metricConfig.gapBucketIndex}u];
    if (gap_count * 100u >= 25u * uniforms.msa_height) {
        return vec2<f32>(0.0, 0.0);
    }

    var observed_kinds = 0u;
    var observed_non_gap_kinds_all = 0u;
    var conserved_positive = AMAS_PROPERTY_MASK_ALL;
    var conserved_negative = AMAS_PROPERTY_MASK_ALL;
    let residue_threshold = (uniforms.msa_height * 3u) / 100u;

    for (var aa = 0u; aa < ${metricConfig.coreSize}u; aa = aa + 1u) {
        let count = final_counts[aa];
        if (count == 0u) {
            continue;
        }
        observed_non_gap_kinds_all += 1u;
        if (count <= residue_threshold) {
            continue;
        }
        let props = amas_property_bits(aa);
        conserved_positive = conserved_positive & props;
        conserved_negative = conserved_negative & (AMAS_PROPERTY_MASK_ALL & ~props);
        observed_kinds += 1u;
    }

    if (observed_kinds == 0u) {
        return vec2<f32>(0.0, 0.0);
    }

    var score = countOneBits(conserved_positive) + countOneBits(conserved_negative);
    var mask = conserved_positive | (conserved_negative << AMAS_NEGATIVE_SHIFT);

    if (observed_non_gap_kinds_all == 1u) {
        score = 11u;
        mask = mask | AMAS_IDENTITY_BIT;
    } else if (score == 10u) {
        mask = mask | AMAS_ALL_PROPERTIES_BIT;
    }

    return vec2<f32>(f32(score), f32(mask));
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
        .replace("__QUALITY_FUNCTION__", buildQualityFunction(alphabet))
        .replace("__CONSERVATION_FUNCTION__", buildConservationFunction(alphabet));
}
