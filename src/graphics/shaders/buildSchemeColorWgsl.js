export function buildSchemeColorWgsl(alphabet) {
    const renderConfig = alphabet.renderConfig;
    if (!renderConfig) {
        throw new Error(`Alphabet ${alphabet.id} is missing renderConfig.`);
    }

    return `
fn default_scheme_color() -> vec4<f32> {
    if (theme.darkMode != 0u) {
        return vec4<f32>(0.08, 0.08, 0.09, 1.0);
    }
    return vec4<f32>(1.0, 1.0, 1.0, 1.0);
}

fn apply_clustalx_rules(raw_res: u32, mask: u32) -> vec4<f32> {
    let res = normalize_residue(raw_res);
    let is_hydrophobic =
        res == 65u ||
        res == 67u ||
        res == 70u ||
        res == 72u ||
        res == 73u ||
        res == 76u ||
        res == 77u ||
        res == 80u ||
        res == 86u ||
        res == 87u;
    if (is_hydrophobic && has_mask(mask, BIT_HYDROPHOBIC_60)) {
        return vec4<f32>(0.5, 0.7, 0.9, 1.0);
    }
    if ((res == 75u || res == 82u) && (has_mask(mask, BIT_KR_60) || has_mask(mask, BIT_KRQ_80_ANY))) {
        return vec4<f32>(0.9, 0.2, 0.2, 1.0);
    }
    if ((res == 81u || res == 69u) && (has_mask(mask, BIT_QE_50) || has_mask(mask, BIT_EQD_80_ANY))) {
        return vec4<f32>(0.0, 0.8, 0.0, 1.0);
    }
    if ((res == 68u || res == 69u) && (has_mask(mask, BIT_ED_50) || has_mask(mask, BIT_EQD_80_ANY))) {
        return vec4<f32>(0.9, 0.1, 0.9, 1.0);
    }
    if ((res == 78u) && (has_mask(mask, BIT_N_50) || has_mask(mask, BIT_DEN_80_ANY))) {
        return vec4<f32>(0.0, 0.8, 0.0, 1.0);
    }
    if ((res == 81u || res == 84u) && (has_mask(mask, BIT_QTKR_80_ANY) || has_mask(mask, BIT_TS_50))) {
        return vec4<f32>(0.0, 0.8, 0.0, 1.0);
    }
    if ((res == 83u || res == 84u) && (has_mask(mask, BIT_TS_50) || has_mask(mask, BIT_ST_80_ANY))) {
        return vec4<f32>(0.0, 0.8, 0.0, 1.0);
    }
    if (res == 67u && has_mask(mask, BIT_C_80)) {
        return vec4<f32>(0.95, 0.75, 0.2, 1.0);
    }
    if (res == 71u && has_mask(mask, BIT_G_PRESENT)) {
        return vec4<f32>(0.95, 0.55, 0.2, 1.0);
    }
    if (res == 80u && has_mask(mask, BIT_P_PRESENT)) {
        return vec4<f32>(0.95, 0.55, 0.2, 1.0);
    }
    if ((res == 72u || res == 89u) && has_mask(mask, BIT_AROMATIC_80_ANY)) {
        return vec4<f32>(0.1, 0.8, 0.8, 1.0);
    }
    return default_scheme_color();
}

fn apply_pid_rules(raw_res: u32, mask: u32) -> vec4<f32> {
    let res = normalize_residue(raw_res);
    let consensusResidue = mask & 0xFFu;
    let bucket = (mask >> 8u) & 0x3u;
    if (res == consensusResidue && bucket == 3u) {
        return select(vec4<f32>(0.0, 0.0, 1.0, 1.0), vec4<f32>(0.9, 0.9, 1.0, 1.0), theme.darkMode != 0u);
    }
    if (res == consensusResidue && bucket == 2u) {
        return select(vec4<f32>(0.4, 0.4, 1.0, 1.0), vec4<f32>(0.65, 0.65, 1.0, 1.0), theme.darkMode != 0u);
    }
    if (res == consensusResidue && bucket == 1u) {
        return select(vec4<f32>(0.8, 0.8, 1.0, 1.0), vec4<f32>(0.4, 0.4, 1.0, 1.0), theme.darkMode != 0u);
    }
    return default_scheme_color();
}

fn quality_index(raw_res: u32) -> u32 {
    let res = normalize_residue(raw_res);
    switch res {
        ${renderConfig.qualityIndexCasesWgsl.trim()}
        default: { return ${renderConfig.qualityDefaultIndex}u; }
    }
}

fn apply_blosum_rules(raw_res: u32, mask: u32) -> vec4<f32> {
    let consensusResidue = mask & 0xFFu;
    if (is_gap_residue(raw_res) || is_gap_residue(consensusResidue)) {
        return default_scheme_color();
    }
    let resIdx = quality_index(raw_res);
    let consensusIdx = quality_index(consensusResidue);
    if (resIdx == consensusIdx) {
        return vec4<f32>(0.4, 0.4, 1.0, 1.0);
    }
    let score = auxData[resIdx * ${renderConfig.qualityMatrixSize}u + consensusIdx];
    if (score >= 0) {
        return vec4<f32>(0.8, 0.8, 1.0, 1.0);
    }
    return default_scheme_color();
}

fn apply_hydrophobicity_rules(raw_res: u32) -> vec4<f32> {
    let res = normalize_residue(raw_res);
    if (res == 65u) { return vec4<f32>(0.678, 0.0, 0.322, 1.0); }
    if (res == 82u) { return vec4<f32>(0.0, 0.0, 1.0, 1.0); }
    if (res == 78u) { return vec4<f32>(0.047, 0.0, 0.953, 1.0); }
    if (res == 68u) { return vec4<f32>(0.047, 0.0, 0.953, 1.0); }
    if (res == 67u) { return vec4<f32>(0.761, 0.0, 0.239, 1.0); }
    if (res == 81u) { return vec4<f32>(0.047, 0.0, 0.953, 1.0); }
    if (res == 69u) { return vec4<f32>(0.047, 0.0, 0.953, 1.0); }
    if (res == 71u) { return vec4<f32>(0.416, 0.0, 0.584, 1.0); }
    if (res == 72u) { return vec4<f32>(0.082, 0.0, 0.918, 1.0); }
    if (res == 73u) { return vec4<f32>(1.0, 0.0, 0.0, 1.0); }
    if (res == 76u) { return vec4<f32>(0.918, 0.0, 0.082, 1.0); }
    if (res == 75u) { return vec4<f32>(0.0, 0.0, 1.0, 1.0); }
    if (res == 77u) { return vec4<f32>(0.690, 0.0, 0.310, 1.0); }
    if (res == 70u) { return vec4<f32>(0.796, 0.0, 0.204, 1.0); }
    if (res == 80u) { return vec4<f32>(0.275, 0.0, 0.725, 1.0); }
    if (res == 83u) { return vec4<f32>(0.369, 0.0, 0.631, 1.0); }
    if (res == 84u) { return vec4<f32>(0.380, 0.0, 0.620, 1.0); }
    if (res == 87u) { return vec4<f32>(0.357, 0.0, 0.643, 1.0); }
    if (res == 89u) { return vec4<f32>(0.310, 0.0, 0.690, 1.0); }
    if (res == 86u) { return vec4<f32>(0.965, 0.0, 0.035, 1.0); }
    if (res == 66u) { return vec4<f32>(0.047, 0.0, 0.953, 1.0); }
    if (res == 88u) { return vec4<f32>(0.408, 0.0, 0.592, 1.0); }
    if (res == 90u) { return vec4<f32>(0.047, 0.0, 0.953, 1.0); }
    return default_scheme_color();
}

fn apply_zappo_rules(raw_res: u32) -> vec4<f32> {
    let res = normalize_residue(raw_res);
    if (res == 65u) { return vec4<f32>(1.0, 0.686, 0.686, 1.0); }
    if (res == 82u) { return vec4<f32>(0.392, 0.392, 1.0, 1.0); }
    if (res == 78u) { return vec4<f32>(0.0, 1.0, 0.0, 1.0); }
    if (res == 68u) { return vec4<f32>(1.0, 0.0, 0.0, 1.0); }
    if (res == 67u) { return vec4<f32>(1.0, 1.0, 0.0, 1.0); }
    if (res == 81u) { return vec4<f32>(0.0, 1.0, 0.0, 1.0); }
    if (res == 69u) { return vec4<f32>(1.0, 0.0, 0.0, 1.0); }
    if (res == 71u) { return vec4<f32>(1.0, 0.0, 1.0, 1.0); }
    if (res == 72u) { return vec4<f32>(0.392, 0.392, 1.0, 1.0); }
    if (res == 73u) { return vec4<f32>(1.0, 0.686, 0.686, 1.0); }
    if (res == 76u) { return vec4<f32>(1.0, 0.686, 0.686, 1.0); }
    if (res == 75u) { return vec4<f32>(0.392, 0.392, 1.0, 1.0); }
    if (res == 77u) { return vec4<f32>(1.0, 0.686, 0.686, 1.0); }
    if (res == 70u) { return vec4<f32>(1.0, 0.784, 0.0, 1.0); }
    if (res == 80u) { return vec4<f32>(1.0, 0.0, 1.0, 1.0); }
    if (res == 83u) { return vec4<f32>(0.0, 1.0, 0.0, 1.0); }
    if (res == 84u) { return vec4<f32>(0.0, 1.0, 0.0, 1.0); }
    if (res == 87u) { return vec4<f32>(1.0, 0.784, 0.0, 1.0); }
    if (res == 89u) { return vec4<f32>(1.0, 0.784, 0.0, 1.0); }
    if (res == 86u) { return vec4<f32>(1.0, 0.686, 0.686, 1.0); }
    return default_scheme_color();
}

fn apply_taylor_rules(raw_res: u32) -> vec4<f32> {
    let res = normalize_residue(raw_res);
    if (res == 65u) { return vec4<f32>(0.800, 1.0, 0.0, 1.0); }
    if (res == 82u) { return vec4<f32>(0.0, 0.0, 1.0, 1.0); }
    if (res == 78u) { return vec4<f32>(0.800, 0.0, 1.0, 1.0); }
    if (res == 68u) { return vec4<f32>(1.0, 0.0, 0.0, 1.0); }
    if (res == 67u) { return vec4<f32>(1.0, 1.0, 0.0, 1.0); }
    if (res == 81u) { return vec4<f32>(1.0, 0.0, 0.800, 1.0); }
    if (res == 69u) { return vec4<f32>(1.0, 0.0, 0.400, 1.0); }
    if (res == 71u) { return vec4<f32>(1.0, 0.600, 0.0, 1.0); }
    if (res == 72u) { return vec4<f32>(0.0, 0.400, 1.0, 1.0); }
    if (res == 73u) { return vec4<f32>(0.400, 1.0, 0.0, 1.0); }
    if (res == 76u) { return vec4<f32>(0.200, 1.0, 0.0, 1.0); }
    if (res == 75u) { return vec4<f32>(0.400, 0.0, 1.0, 1.0); }
    if (res == 77u) { return vec4<f32>(0.0, 1.0, 0.0, 1.0); }
    if (res == 70u) { return vec4<f32>(0.0, 1.0, 0.400, 1.0); }
    if (res == 80u) { return vec4<f32>(1.0, 0.800, 0.0, 1.0); }
    if (res == 83u) { return vec4<f32>(1.0, 0.200, 0.0, 1.0); }
    if (res == 84u) { return vec4<f32>(1.0, 0.400, 0.0, 1.0); }
    if (res == 87u) { return vec4<f32>(0.0, 0.800, 1.0, 1.0); }
    if (res == 89u) { return vec4<f32>(0.0, 1.0, 0.800, 1.0); }
    if (res == 86u) { return vec4<f32>(0.600, 1.0, 0.0, 1.0); }
    return default_scheme_color();
}

fn apply_gecos_flower_rules(raw_res: u32) -> vec4<f32> {
    let res = normalize_residue(raw_res);
    if (res == 65u) { return vec4<f32>(0.694, 0.541, 0.318, 1.0); }
    if (res == 82u) { return vec4<f32>(0.514, 0.749, 0.945, 1.0); }
    if (res == 78u) { return vec4<f32>(0.043, 0.808, 0.776, 1.0); }
    if (res == 68u) { return vec4<f32>(0.004, 0.647, 0.471, 1.0); }
    if (res == 67u) { return vec4<f32>(1.0, 0.341, 0.004, 1.0); }
    if (res == 81u) { return vec4<f32>(0.447, 0.584, 0.682, 1.0); }
    if (res == 69u) { return vec4<f32>(0.176, 0.627, 0.631, 1.0); }
    if (res == 71u) { return vec4<f32>(0.694, 0.761, 0.235, 1.0); }
    if (res == 72u) { return vec4<f32>(0.004, 0.580, 0.976, 1.0); }
    if (res == 73u) { return vec4<f32>(0.949, 0.463, 0.388, 1.0); }
    if (res == 76u) { return vec4<f32>(0.875, 0.431, 0.459, 1.0); }
    if (res == 75u) { return vec4<f32>(0.498, 0.765, 0.843, 1.0); }
    if (res == 77u) { return vec4<f32>(0.996, 0.616, 0.686, 1.0); }
    if (res == 70u) { return vec4<f32>(0.980, 0.333, 0.616, 1.0); }
    if (res == 80u) { return vec4<f32>(0.310, 0.639, 0.165, 1.0); }
    if (res == 83u) { return vec4<f32>(0.706, 0.741, 0.608, 1.0); }
    if (res == 84u) { return vec4<f32>(0.824, 0.710, 0.463, 1.0); }
    if (res == 87u) { return vec4<f32>(1.0, 0.176, 0.929, 1.0); }
    if (res == 89u) { return vec4<f32>(0.788, 0.431, 0.812, 1.0); }
    if (res == 86u) { return vec4<f32>(0.992, 0.600, 0.482, 1.0); }
    return default_scheme_color();
}

fn apply_gecos_blossom_rules(raw_res: u32) -> vec4<f32> {
    let res = normalize_residue(raw_res);
    if (res == 65u) { return vec4<f32>(0.545, 0.769, 0.706, 1.0); }
    if (res == 82u) { return vec4<f32>(0.988, 0.584, 0.008, 1.0); }
    if (res == 78u) { return vec4<f32>(0.710, 0.761, 0.024, 1.0); }
    if (res == 68u) { return vec4<f32>(0.373, 0.647, 0.020, 1.0); }
    if (res == 67u) { return vec4<f32>(0.031, 0.576, 0.996, 1.0); }
    if (res == 81u) { return vec4<f32>(0.749, 0.522, 0.153, 1.0); }
    if (res == 69u) { return vec4<f32>(0.859, 0.710, 0.004, 1.0); }
    if (res == 71u) { return vec4<f32>(0.0, 0.827, 0.510, 1.0); }
    if (res == 72u) { return vec4<f32>(1.0, 0.341, 0.004, 1.0); }
    if (res == 73u) { return vec4<f32>(0.604, 0.729, 0.953, 1.0); }
    if (res == 76u) { return vec4<f32>(0.804, 0.647, 0.863, 1.0); }
    if (res == 75u) { return vec4<f32>(0.996, 0.647, 0.153, 1.0); }
    if (res == 77u) { return vec4<f32>(0.961, 0.631, 0.722, 1.0); }
    if (res == 70u) { return vec4<f32>(0.969, 0.310, 0.659, 1.0); }
    if (res == 80u) { return vec4<f32>(0.063, 0.839, 0.192, 1.0); }
    if (res == 83u) { return vec4<f32>(0.494, 0.616, 0.349, 1.0); }
    if (res == 84u) { return vec4<f32>(0.0, 0.635, 0.612, 1.0); }
    if (res == 87u) { return vec4<f32>(0.996, 0.031, 0.984, 1.0); }
    if (res == 89u) { return vec4<f32>(1.0, 0.306, 0.478, 1.0); }
    if (res == 86u) { return vec4<f32>(0.529, 0.753, 0.894, 1.0); }
    return default_scheme_color();
}

fn apply_gecos_sunset_rules(raw_res: u32) -> vec4<f32> {
    let res = normalize_residue(raw_res);
    if (res == 65u) { return vec4<f32>(0.996, 0.627, 0.992, 1.0); }
    if (res == 82u) { return vec4<f32>(0.522, 0.455, 0.416, 1.0); }
    if (res == 78u) { return vec4<f32>(0.671, 0.784, 0.961, 1.0); }
    if (res == 68u) { return vec4<f32>(0.180, 0.482, 0.745, 1.0); }
    if (res == 67u) { return vec4<f32>(0.988, 0.047, 0.996, 1.0); }
    if (res == 81u) { return vec4<f32>(0.549, 0.431, 0.506, 1.0); }
    if (res == 69u) { return vec4<f32>(0.404, 0.471, 0.573, 1.0); }
    if (res == 71u) { return vec4<f32>(0.153, 0.600, 1.0, 1.0); }
    if (res == 72u) { return vec4<f32>(0.859, 0.773, 0.557, 1.0); }
    if (res == 73u) { return vec4<f32>(0.980, 0.129, 0.631, 1.0); }
    if (res == 76u) { return vec4<f32>(0.878, 0.118, 0.510, 1.0); }
    if (res == 75u) { return vec4<f32>(0.871, 0.745, 0.800, 1.0); }
    if (res == 77u) { return vec4<f32>(0.820, 0.243, 0.482, 1.0); }
    if (res == 70u) { return vec4<f32>(1.0, 0.220, 0.365, 1.0); }
    if (res == 80u) { return vec4<f32>(0.341, 0.400, 0.976, 1.0); }
    if (res == 83u) { return vec4<f32>(0.906, 0.706, 0.992, 1.0); }
    if (res == 84u) { return vec4<f32>(0.651, 0.345, 0.718, 1.0); }
    if (res == 87u) { return vec4<f32>(1.0, 0.216, 0.004, 1.0); }
    if (res == 89u) { return vec4<f32>(0.796, 0.325, 0.224, 1.0); }
    if (res == 86u) { return vec4<f32>(0.996, 0.318, 0.722, 1.0); }
    return default_scheme_color();
}

fn apply_gecos_ocean_rules(raw_res: u32) -> vec4<f32> {
    let res = normalize_residue(raw_res);
    if (res == 65u) { return vec4<f32>(0.420, 0.890, 0.439, 1.0); }
    if (res == 82u) { return vec4<f32>(0.322, 0.780, 0.992, 1.0); }
    if (res == 78u) { return vec4<f32>(0.157, 0.910, 0.800, 1.0); }
    if (res == 68u) { return vec4<f32>(0.184, 0.745, 0.463, 1.0); }
    if (res == 67u) { return vec4<f32>(0.286, 0.506, 0.973, 1.0); }
    if (res == 81u) { return vec4<f32>(0.302, 0.686, 0.757, 1.0); }
    if (res == 69u) { return vec4<f32>(0.227, 0.663, 0.588, 1.0); }
    if (res == 71u) { return vec4<f32>(0.004, 0.788, 0.188, 1.0); }
    if (res == 72u) { return vec4<f32>(0.161, 0.592, 1.0, 1.0); }
    if (res == 73u) { return vec4<f32>(0.404, 0.988, 0.706, 1.0); }
    if (res == 76u) { return vec4<f32>(0.333, 0.937, 0.592, 1.0); }
    if (res == 75u) { return vec4<f32>(0.373, 0.745, 0.835, 1.0); }
    if (res == 77u) { return vec4<f32>(0.341, 0.941, 0.741, 1.0); }
    if (res == 70u) { return vec4<f32>(0.333, 0.831, 0.980, 1.0); }
    if (res == 80u) { return vec4<f32>(0.149, 0.933, 0.365, 1.0); }
    if (res == 83u) { return vec4<f32>(0.173, 0.894, 0.612, 1.0); }
    if (res == 84u) { return vec4<f32>(0.137, 0.851, 0.494, 1.0); }
    if (res == 87u) { return vec4<f32>(0.286, 0.667, 1.0, 1.0); }
    if (res == 89u) { return vec4<f32>(0.325, 0.753, 1.0, 1.0); }
    if (res == 86u) { return vec4<f32>(0.392, 0.980, 0.624, 1.0); }
    return default_scheme_color();
}

fn apply_helix_propensity_rules(raw_res: u32) -> vec4<f32> {
    let res = normalize_residue(raw_res);
    if (res == 65u) { return vec4<f32>(0.910, 0.910, 0.580, 1.0); }
    if (res == 82u) { return vec4<f32>(0.459, 0.459, 0.906, 1.0); }
    if (res == 78u) { return vec4<f32>(0.690, 0.690, 0.820, 1.0); }
    if (res == 68u) { return vec4<f32>(0.890, 0.890, 0.404, 1.0); }
    if (res == 67u) { return vec4<f32>(0.631, 0.631, 0.863, 1.0); }
    if (res == 81u) { return vec4<f32>(0.588, 0.588, 0.878, 1.0); }
    if (res == 69u) { return vec4<f32>(1.0, 1.0, 0.0, 1.0); }
    if (res == 71u) { return vec4<f32>(0.753, 0.753, 0.765, 1.0); }
    if (res == 72u) { return vec4<f32>(0.741, 0.741, 0.776, 1.0); }
    if (res == 73u) { return vec4<f32>(0.467, 0.467, 0.898, 1.0); }
    if (res == 76u) { return vec4<f32>(0.278, 0.278, 0.988, 1.0); }
    if (res == 75u) { return vec4<f32>(0.529, 0.529, 0.898, 1.0); }
    if (res == 77u) { return vec4<f32>(0.137, 0.137, 1.0, 1.0); }
    if (res == 70u) { return vec4<f32>(0.337, 0.337, 0.937, 1.0); }
    if (res == 80u) { return vec4<f32>(0.820, 0.820, 0.702, 1.0); }
    if (res == 83u) { return vec4<f32>(0.804, 0.804, 0.718, 1.0); }
    if (res == 84u) { return vec4<f32>(0.788, 0.788, 0.733, 1.0); }
    if (res == 87u) { return vec4<f32>(0.549, 0.549, 0.882, 1.0); }
    if (res == 89u) { return vec4<f32>(0.682, 0.682, 0.827, 1.0); }
    if (res == 86u) { return vec4<f32>(0.333, 0.333, 0.945, 1.0); }
    return default_scheme_color();
}

fn apply_strand_propensity_rules(raw_res: u32) -> vec4<f32> {
    let res = normalize_residue(raw_res);
    if (res == 65u) { return vec4<f32>(0.525, 0.525, 0.525, 1.0); }
    if (res == 82u) { return vec4<f32>(0.847, 0.847, 0.847, 1.0); }
    if (res == 78u) { return vec4<f32>(0.671, 0.671, 0.671, 1.0); }
    if (res == 68u) { return vec4<f32>(0.667, 0.667, 0.667, 1.0); }
    if (res == 67u) { return vec4<f32>(0.902, 0.902, 0.902, 1.0); }
    if (res == 81u) { return vec4<f32>(0.753, 0.753, 0.753, 1.0); }
    if (res == 69u) { return vec4<f32>(0.584, 0.584, 0.584, 1.0); }
    if (res == 71u) { return vec4<f32>(0.525, 0.525, 0.525, 1.0); }
    if (res == 72u) { return vec4<f32>(0.824, 0.824, 0.824, 1.0); }
    if (res == 73u) { return vec4<f32>(0.996, 0.996, 0.996, 1.0); }
    if (res == 76u) { return vec4<f32>(0.980, 0.980, 0.980, 1.0); }
    if (res == 75u) { return vec4<f32>(0.655, 0.655, 0.655, 1.0); }
    if (res == 77u) { return vec4<f32>(0.906, 0.906, 0.906, 1.0); }
    if (res == 70u) { return vec4<f32>(0.847, 0.847, 0.847, 1.0); }
    if (res == 80u) { return vec4<f32>(0.420, 0.420, 0.420, 1.0); }
    if (res == 83u) { return vec4<f32>(0.537, 0.537, 0.537, 1.0); }
    if (res == 84u) { return vec4<f32>(0.631, 0.631, 0.631, 1.0); }
    if (res == 87u) { return vec4<f32>(0.718, 0.718, 0.718, 1.0); }
    if (res == 89u) { return vec4<f32>(0.839, 0.839, 0.839, 1.0); }
    if (res == 86u) { return vec4<f32>(0.839, 0.839, 0.839, 1.0); }
    return default_scheme_color();
}

fn apply_turn_propensity_rules(raw_res: u32) -> vec4<f32> {
    let res = normalize_residue(raw_res);
    if (res == 65u) { return vec4<f32>(0.278, 0.278, 0.278, 1.0); }
    if (res == 82u) { return vec4<f32>(0.812, 0.812, 0.812, 1.0); }
    if (res == 78u) { return vec4<f32>(0.773, 0.773, 0.773, 1.0); }
    if (res == 68u) { return vec4<f32>(0.655, 0.655, 0.655, 1.0); }
    if (res == 67u) { return vec4<f32>(0.655, 0.655, 0.655, 1.0); }
    if (res == 81u) { return vec4<f32>(0.792, 0.792, 0.792, 1.0); }
    if (res == 69u) { return vec4<f32>(0.643, 0.643, 0.643, 1.0); }
    if (res == 71u) { return vec4<f32>(1.0, 1.0, 1.0, 1.0); }
    if (res == 72u) { return vec4<f32>(0.682, 0.682, 0.682, 1.0); }
    if (res == 73u) { return vec4<f32>(0.361, 0.361, 0.361, 1.0); }
    if (res == 76u) { return vec4<f32>(0.318, 0.318, 0.318, 1.0); }
    if (res == 75u) { return vec4<f32>(0.820, 0.820, 0.820, 1.0); }
    if (res == 77u) { return vec4<f32>(0.424, 0.424, 0.424, 1.0); }
    if (res == 70u) { return vec4<f32>(0.388, 0.388, 0.388, 1.0); }
    if (res == 80u) { return vec4<f32>(0.945, 0.945, 0.945, 1.0); }
    if (res == 83u) { return vec4<f32>(0.922, 0.922, 0.922, 1.0); }
    if (res == 84u) { return vec4<f32>(0.792, 0.792, 0.792, 1.0); }
    if (res == 87u) { return vec4<f32>(0.286, 0.286, 0.286, 1.0); }
    if (res == 89u) { return vec4<f32>(0.400, 0.400, 0.400, 1.0); }
    if (res == 86u) { return vec4<f32>(0.286, 0.286, 0.286, 1.0); }
    return default_scheme_color();
}

fn apply_buried_index_rules(raw_res: u32) -> vec4<f32> {
    let res = normalize_residue(raw_res);
    if (res == 65u) { return vec4<f32>(0.0, 0.514, 0.902, 1.0); }
    if (res == 82u) { return vec4<f32>(0.710, 0.141, 0.141, 1.0); }
    if (res == 78u) { return vec4<f32>(0.478, 0.282, 0.533, 1.0); }
    if (res == 68u) { return vec4<f32>(0.282, 0.396, 0.667, 1.0); }
    if (res == 67u) { return vec4<f32>(0.000, 0.808, 0.537, 1.0); }
    if (res == 81u) { return vec4<f32>(0.482, 0.278, 0.533, 1.0); }
    if (res == 69u) { return vec4<f32>(0.278, 0.396, 0.671, 1.0); }
    if (res == 71u) { return vec4<f32>(0.263, 0.369, 0.694, 1.0); }
    if (res == 72u) { return vec4<f32>(0.675, 0.165, 0.427, 1.0); }
    if (res == 73u) { return vec4<f32>(0.000, 0.886, 0.471, 1.0); }
    if (res == 76u) { return vec4<f32>(0.000, 1.0, 0.373, 1.0); }
    if (res == 75u) { return vec4<f32>(0.800, 0.067, 0.235, 1.0); }
    if (res == 77u) { return vec4<f32>(0.000, 0.839, 0.518, 1.0); }
    if (res == 70u) { return vec4<f32>(0.157, 0.651, 0.478, 1.0); }
    if (res == 80u) { return vec4<f32>(0.380, 0.329, 0.624, 1.0); }
    if (res == 83u) { return vec4<f32>(0.318, 0.376, 0.686, 1.0); }
    if (res == 84u) { return vec4<f32>(0.188, 0.463, 0.608, 1.0); }
    if (res == 87u) { return vec4<f32>(0.114, 0.729, 0.431, 1.0); }
    if (res == 89u) { return vec4<f32>(0.314, 0.373, 0.690, 1.0); }
    if (res == 86u) { return vec4<f32>(0.000, 0.871, 0.482, 1.0); }
    return default_scheme_color();
}

fn apply_3di_rules(raw_res: u32) -> vec4<f32> {
    if (is_gap_residue(raw_res)) { return default_scheme_color(); }
    let res = normalize_residue(raw_res);
    if (res == 65u) { return vec4<f32>(0.875, 0.604, 0.549, 1.0); }
    if (res == 67u) { return vec4<f32>(0.984, 0.447, 0.773, 1.0); }
    if (res == 68u) { return vec4<f32>(0.706, 0.639, 0.847, 1.0); }
    if (res == 69u) { return vec4<f32>(1.0, 0.341, 0.004, 1.0); }
    if (res == 70u) { return vec4<f32>(0.851, 0.620, 0.506, 1.0); }
    if (res == 71u) { return vec4<f32>(0.455, 0.569, 0.773, 1.0); }
    if (res == 72u) { return vec4<f32>(0.580, 0.671, 0.882, 1.0); }
    if (res == 73u) { return vec4<f32>(0.376, 0.616, 0.482, 1.0); }
    if (res == 75u) { return vec4<f32>(0.843, 0.639, 0.016, 1.0); }
    if (res == 76u) { return vec4<f32>(0.996, 0.298, 0.545, 1.0); }
    if (res == 77u) { return vec4<f32>(0.071, 0.647, 0.392, 1.0); }
    if (res == 78u) { return vec4<f32>(0.835, 0.439, 0.992, 1.0); }
    if (res == 80u) { return vec4<f32>(0.796, 0.600, 0.769, 1.0); }
    if (res == 81u) { return vec4<f32>(0.855, 0.557, 0.600, 1.0); }
    if (res == 82u) { return vec4<f32>(0.580, 0.529, 0.816, 1.0); }
    if (res == 83u) { return vec4<f32>(0.910, 0.259, 0.996, 1.0); }
    if (res == 84u) { return vec4<f32>(0.259, 0.635, 0.600, 1.0); }
    if (res == 86u) { return vec4<f32>(0.984, 0.494, 0.867, 1.0); }
    if (res == 87u) { return vec4<f32>(0.820, 0.639, 0.408, 1.0); }
    if (res == 88u) { return vec4<f32>(0.753, 0.753, 0.753, 1.0); }
    if (res == 89u) { return vec4<f32>(0.090, 0.659, 0.992, 1.0); }
    return default_scheme_color();
}

fn resolve_scheme_color(raw_res: u32, mask: u32) -> vec4<f32> {
    let base_background = default_scheme_color();
    if (is_lowercase_residue(raw_res)) {
        return base_background;
    }
    switch (theme.colorScheme) {
        case 0u: { return apply_clustalx_rules(raw_res, mask); }
        case 1u: { return apply_pid_rules(raw_res, mask); }
        case 2u: { return apply_blosum_rules(raw_res, mask); }
        case 3u: { return apply_hydrophobicity_rules(raw_res); }
        case 4u: { return apply_zappo_rules(raw_res); }
        case 5u: { return apply_taylor_rules(raw_res); }
        case 6u: { return apply_gecos_blossom_rules(raw_res); }
        case 7u: { return apply_gecos_sunset_rules(raw_res); }
        case 8u: { return apply_gecos_ocean_rules(raw_res); }
        case 9u: { return apply_helix_propensity_rules(raw_res); }
        case 10u: { return apply_strand_propensity_rules(raw_res); }
        case 11u: { return apply_turn_propensity_rules(raw_res); }
        case 12u: { return apply_buried_index_rules(raw_res); }
        case 13u: { return apply_3di_rules(raw_res); }
        default: { return base_background; }
    }
}`.trim();
}
