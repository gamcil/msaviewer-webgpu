// WGSL Shader for MSA viewer

struct Uniforms {
    scrollPx: vec2<u32>,
    totalSize: vec2<u32>,
    gridSize: vec2<u32>,
    canvasSize: vec2<u32>
}

struct ThemeUniforms {
    darkMode: u32,
    colorScheme: u32,
}

@group(0) @binding(0) var<uniform> ui: Uniforms;
@group(0) @binding(1) var<storage, read> msaData: array<u32>;
@group(0) @binding(2) var<storage, read> colProfile: array<u32>;
@group(0) @binding(3) var<uniform> theme: ThemeUniforms;
@group(0) @binding(4) var fontAtlas: texture_2d<f32>;
@group(0) @binding(5) var fontSampler: sampler;
@group(0) @binding(6) var<storage, read> auxData: array<i32>;

struct VertexOutput {
    @builtin(position) pos: vec4<f32>,
    @location(0) uv: vec2<f32>,
}

const BIT_HYDROPHOBIC_60: u32 = 1u << 0u;
const BIT_KR_60: u32 = 1u << 1u;
const BIT_KRQ_80_ANY: u32 = 1u << 2u;
const BIT_QE_50: u32 = 1u << 3u;
const BIT_ED_50: u32 = 1u << 4u;
const BIT_EQD_80_ANY: u32 = 1u << 5u;
const BIT_DEN_80_ANY: u32 = 1u << 6u;
const BIT_N_50: u32 = 1u << 7u;
const BIT_QTKR_80_ANY: u32 = 1u << 8u;
const BIT_TS_50: u32 = 1u << 9u;
const BIT_ST_80_ANY: u32 = 1u << 10u;
const BIT_C_80: u32 = 1u << 11u;
const BIT_G_PRESENT: u32 = 1u << 12u;
const BIT_P_PRESENT: u32 = 1u << 13u;
const BIT_AROMATIC_80_ANY: u32 = 1u << 14u;

fn normalize_residue(raw: u32) -> u32 {
    if (raw >= 97u && raw <= 122u) {
        return raw - 32u;
    }
    return raw;
}

fn has_mask(mask: u32, bit: u32) -> bool {
    return (mask & bit) != 0u;
}

fn glyph_cell(res: u32) -> vec2<u32> {
    let upper = normalize_residue(res);
    if (upper >= 65u && upper <= 78u) {
        return vec2<u32>(upper - 65u, 0u);
    }
    if (upper >= 79u && upper <= 90u) {
        return vec2<u32>(upper - 79u, 1u);
    }
    if (upper == 45u) {
        return vec2<u32>(12u, 1u);
    }
    return vec2<u32>(13u, 1u);
}

fn blosum_index(raw_res: u32) -> u32 {
    let res = normalize_residue(raw_res);
    switch res {
        case 65u: { return 0u; }   // A
        case 82u: { return 1u; }   // R
        case 78u: { return 2u; }   // N
        case 68u: { return 3u; }   // D
        case 67u: { return 4u; }   // C
        case 81u: { return 5u; }   // Q
        case 69u: { return 6u; }   // E
        case 71u: { return 7u; }   // G
        case 72u: { return 8u; }   // H
        case 73u: { return 9u; }   // I
        case 76u: { return 10u; }  // L
        case 75u: { return 11u; }  // K
        case 77u: { return 12u; }  // M
        case 70u: { return 13u; }  // F
        case 80u: { return 14u; }  // P
        case 83u: { return 15u; }  // S
        case 84u: { return 16u; }  // T
        case 87u: { return 17u; }  // W
        case 89u: { return 18u; }  // Y
        case 86u: { return 19u; }  // V
        case 66u: { return 20u; }  // B
        case 74u: { return 21u; }  // J
        case 90u: { return 22u; }  // Z
        case 88u: { return 23u; }  // X
        default: { return 24u; }   // *
    }
}

fn sample_glyph_mask(res: u32, local_uv: vec2<f32>) -> f32 {
    let cell = glyph_cell(res);
    let atlas_size = vec2<f32>(896.0, 128.0);
    let glyph_size = vec2<f32>(64.0, 64.0);
    let atlas_uv = (vec2<f32>(cell) * glyph_size + local_uv * glyph_size) / atlas_size;
    let sample = textureSampleLevel(fontAtlas, fontSampler, atlas_uv, 0.0);
    // return sample.a;
    return max(sample.a, max(sample.r, max(sample.g, sample.b)));
}

fn default_scheme_color() -> vec4<f32> {
    if (theme.darkMode != 0u) {
        return vec4<f32>(0.08, 0.08, 0.09, 1.0);
    }
    return vec4<f32>(1.0, 1.0, 1.0, 1.0);
}

fn contrast_text_color(background: vec3<f32>) -> vec3<f32> {
    let luma = dot(background, vec3<f32>(0.299, 0.587, 0.114));
    if (luma > 0.55) {
        return vec3<f32>(0.05, 0.05, 0.05);
    }
    return vec3<f32>(0.95, 0.95, 0.95);
}

fn apply_clustalx_rules(raw_res: u32, mask: u32) -> vec4<f32> {
    let res = normalize_residue(raw_res);
    let is_hydrophobic =
        res == 65u || // A
        res == 67u || // C
        res == 70u || // F
        res == 72u || // H
        res == 73u || // I
        res == 76u || // L
        res == 77u || // M
        res == 80u || // P
        res == 86u || // V
        res == 87u;   // W
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
    if (
        (res == 81u || res == 84u) &&
        (has_mask(mask, BIT_QTKR_80_ANY) || has_mask(mask, BIT_TS_50))
    ) {
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

fn apply_blosum_rules(raw_res: u32, mask: u32) -> vec4<f32> {
    let consensusResidue = mask & 0xFFu;
    let resIdx = blosum_index(raw_res);
    let consensusIdx = blosum_index(consensusResidue);
    if (resIdx == consensusIdx) {
        return vec4<f32>(0.4, 0.4, 1.0, 1.0);
    }
    let score = auxData[resIdx * 25u + consensusIdx];
    if (score >= 0) {
        return vec4<f32>(0.8, 0.8, 1.0, 1.0);
    }
    return default_scheme_color();
}

fn apply_hydrophobicity_rules(raw_res: u32) -> vec4<f32> {
    let res = normalize_residue(raw_res);
    if (res == 65u) { return vec4<f32>(0.678, 0.0, 0.322, 1.0); } // A #ad0052
    if (res == 82u) { return vec4<f32>(0.0, 0.0, 1.0, 1.0); }     // R #0000ff
    if (res == 78u) { return vec4<f32>(0.047, 0.0, 0.953, 1.0); } // N #0c00f3
    if (res == 68u) { return vec4<f32>(0.047, 0.0, 0.953, 1.0); } // D #0c00f3
    if (res == 67u) { return vec4<f32>(0.761, 0.0, 0.239, 1.0); } // C #c2003d
    if (res == 81u) { return vec4<f32>(0.047, 0.0, 0.953, 1.0); } // Q #0c00f3
    if (res == 69u) { return vec4<f32>(0.047, 0.0, 0.953, 1.0); } // E #0c00f3
    if (res == 71u) { return vec4<f32>(0.416, 0.0, 0.584, 1.0); } // G #6a0095
    if (res == 72u) { return vec4<f32>(0.082, 0.0, 0.918, 1.0); } // H #1500ea
    if (res == 73u) { return vec4<f32>(1.0, 0.0, 0.0, 1.0); }     // I #ff0000
    if (res == 76u) { return vec4<f32>(0.918, 0.0, 0.082, 1.0); } // L #ea0015
    if (res == 75u) { return vec4<f32>(0.0, 0.0, 1.0, 1.0); }     // K #0000ff
    if (res == 77u) { return vec4<f32>(0.690, 0.0, 0.310, 1.0); } // M #b0004f
    if (res == 70u) { return vec4<f32>(0.796, 0.0, 0.204, 1.0); } // F #cb0034
    if (res == 80u) { return vec4<f32>(0.275, 0.0, 0.725, 1.0); } // P #4600b9
    if (res == 83u) { return vec4<f32>(0.369, 0.0, 0.631, 1.0); } // S #5e00a1
    if (res == 84u) { return vec4<f32>(0.380, 0.0, 0.620, 1.0); } // T #61009e
    if (res == 87u) { return vec4<f32>(0.357, 0.0, 0.643, 1.0); } // W #5b00a4
    if (res == 89u) { return vec4<f32>(0.310, 0.0, 0.690, 1.0); } // Y #4f00b0
    if (res == 86u) { return vec4<f32>(0.965, 0.0, 0.035, 1.0); } // V #f60009
    if (res == 66u) { return vec4<f32>(0.047, 0.0, 0.953, 1.0); } // B #0c00f3
    if (res == 88u) { return vec4<f32>(0.408, 0.0, 0.592, 1.0); } // X #680097
    if (res == 90u) { return vec4<f32>(0.047, 0.0, 0.953, 1.0); } // Z #0c00f3
    return default_scheme_color();
}

fn apply_zappo_rules(raw_res: u32) -> vec4<f32> {
    let res = normalize_residue(raw_res);
    if (res == 65u) { return vec4<f32>(1.0, 0.686, 0.686, 1.0); } // A #ffafaf
    if (res == 82u) { return vec4<f32>(0.392, 0.392, 1.0, 1.0); } // R #6464ff
    if (res == 78u) { return vec4<f32>(0.0, 1.0, 0.0, 1.0); }     // N #00ff00
    if (res == 68u) { return vec4<f32>(1.0, 0.0, 0.0, 1.0); }     // D #ff0000
    if (res == 67u) { return vec4<f32>(1.0, 1.0, 0.0, 1.0); }     // C #ffff00
    if (res == 81u) { return vec4<f32>(0.0, 1.0, 0.0, 1.0); }     // Q #00ff00
    if (res == 69u) { return vec4<f32>(1.0, 0.0, 0.0, 1.0); }     // E #ff0000
    if (res == 71u) { return vec4<f32>(1.0, 0.0, 1.0, 1.0); }     // G #ff00ff
    if (res == 72u) { return vec4<f32>(0.392, 0.392, 1.0, 1.0); } // H #6464ff
    if (res == 73u) { return vec4<f32>(1.0, 0.686, 0.686, 1.0); } // I #ffafaf
    if (res == 76u) { return vec4<f32>(1.0, 0.686, 0.686, 1.0); } // L #ffafaf
    if (res == 75u) { return vec4<f32>(0.392, 0.392, 1.0, 1.0); } // K #6464ff
    if (res == 77u) { return vec4<f32>(1.0, 0.686, 0.686, 1.0); } // M #ffafaf
    if (res == 70u) { return vec4<f32>(1.0, 0.784, 0.0, 1.0); }   // F #ffc800
    if (res == 80u) { return vec4<f32>(1.0, 0.0, 1.0, 1.0); }     // P #ff00ff
    if (res == 83u) { return vec4<f32>(0.0, 1.0, 0.0, 1.0); }     // S #00ff00
    if (res == 84u) { return vec4<f32>(0.0, 1.0, 0.0, 1.0); }     // T #00ff00
    if (res == 87u) { return vec4<f32>(1.0, 0.784, 0.0, 1.0); }   // W #ffc800
    if (res == 89u) { return vec4<f32>(1.0, 0.784, 0.0, 1.0); }   // Y #ffc800
    if (res == 86u) { return vec4<f32>(1.0, 0.686, 0.686, 1.0); } // V #ffafaf
    return default_scheme_color();
}

fn apply_taylor_rules(raw_res: u32) -> vec4<f32> {
    let res = normalize_residue(raw_res);
    if (res == 65u) { return vec4<f32>(0.800, 1.0, 0.0, 1.0); } // A #ccff00
    if (res == 82u) { return vec4<f32>(0.0, 0.0, 1.0, 1.0); }   // R #0000ff
    if (res == 78u) { return vec4<f32>(0.800, 0.0, 1.0, 1.0); } // N #cc00ff
    if (res == 68u) { return vec4<f32>(1.0, 0.0, 0.0, 1.0); }   // D #ff0000
    if (res == 67u) { return vec4<f32>(1.0, 1.0, 0.0, 1.0); }   // C #ffff00
    if (res == 81u) { return vec4<f32>(1.0, 0.0, 0.800, 1.0); } // Q #ff00cc
    if (res == 69u) { return vec4<f32>(1.0, 0.0, 0.400, 1.0); } // E #ff0066
    if (res == 71u) { return vec4<f32>(1.0, 0.600, 0.0, 1.0); } // G #ff9900
    if (res == 72u) { return vec4<f32>(0.0, 0.400, 1.0, 1.0); } // H #0066ff
    if (res == 73u) { return vec4<f32>(0.400, 1.0, 0.0, 1.0); } // I #66ff00
    if (res == 76u) { return vec4<f32>(0.200, 1.0, 0.0, 1.0); } // L #33ff00
    if (res == 75u) { return vec4<f32>(0.400, 0.0, 1.0, 1.0); } // K #6600ff
    if (res == 77u) { return vec4<f32>(0.0, 1.0, 0.0, 1.0); }   // M #00ff00
    if (res == 70u) { return vec4<f32>(0.0, 1.0, 0.400, 1.0); } // F #00ff66
    if (res == 80u) { return vec4<f32>(1.0, 0.800, 0.0, 1.0); } // P #ffcc00
    if (res == 83u) { return vec4<f32>(1.0, 0.200, 0.0, 1.0); } // S #ff3300
    if (res == 84u) { return vec4<f32>(1.0, 0.400, 0.0, 1.0); } // T #ff6600
    if (res == 87u) { return vec4<f32>(0.0, 0.800, 1.0, 1.0); } // W #00ccff
    if (res == 89u) { return vec4<f32>(0.0, 1.0, 0.800, 1.0); } // Y #00ffcc
    if (res == 86u) { return vec4<f32>(0.600, 1.0, 0.0, 1.0); } // V #99ff00
    return default_scheme_color();
}

fn apply_gecos_flower_rules(raw_res: u32) -> vec4<f32> {
    let res = normalize_residue(raw_res);
    if (res == 65u) { return vec4<f32>(0.694, 0.541, 0.318, 1.0); } // A #b18a51
    if (res == 82u) { return vec4<f32>(0.514, 0.749, 0.945, 1.0); } // R #83bff1
    if (res == 78u) { return vec4<f32>(0.043, 0.808, 0.776, 1.0); } // N #0bcec6
    if (res == 68u) { return vec4<f32>(0.004, 0.647, 0.471, 1.0); } // D #01a578
    if (res == 67u) { return vec4<f32>(1.0, 0.341, 0.004, 1.0); }   // C #ff5701
    if (res == 81u) { return vec4<f32>(0.447, 0.584, 0.682, 1.0); } // Q #7295ae
    if (res == 69u) { return vec4<f32>(0.176, 0.627, 0.631, 1.0); } // E #2da0a1
    if (res == 71u) { return vec4<f32>(0.694, 0.761, 0.235, 1.0); } // G #b1c23c
    if (res == 72u) { return vec4<f32>(0.004, 0.580, 0.976, 1.0); } // H #0194f9
    if (res == 73u) { return vec4<f32>(0.949, 0.463, 0.388, 1.0); } // I #f27663
    if (res == 76u) { return vec4<f32>(0.875, 0.431, 0.459, 1.0); } // L #df6e75
    if (res == 75u) { return vec4<f32>(0.498, 0.765, 0.843, 1.0); } // K #7fc3d7
    if (res == 77u) { return vec4<f32>(0.996, 0.616, 0.686, 1.0); } // M #fe9daf
    if (res == 70u) { return vec4<f32>(0.980, 0.333, 0.616, 1.0); } // F #fa559d
    if (res == 80u) { return vec4<f32>(0.310, 0.639, 0.165, 1.0); } // P #4fa32a
    if (res == 83u) { return vec4<f32>(0.706, 0.741, 0.608, 1.0); } // S #b4bd9b
    if (res == 84u) { return vec4<f32>(0.824, 0.710, 0.463, 1.0); } // T #d2b576
    if (res == 87u) { return vec4<f32>(1.0, 0.176, 0.929, 1.0); }   // W #ff2ded
    if (res == 89u) { return vec4<f32>(0.788, 0.431, 0.812, 1.0); } // Y #c96ecf
    if (res == 86u) { return vec4<f32>(0.992, 0.600, 0.482, 1.0); } // V #fd997b
    return default_scheme_color();
}

fn apply_gecos_blossom_rules(raw_res: u32) -> vec4<f32> {
    let res = normalize_residue(raw_res);
    if (res == 65u) { return vec4<f32>(0.545, 0.769, 0.706, 1.0); } // A #8bc4b4
    if (res == 82u) { return vec4<f32>(0.988, 0.584, 0.008, 1.0); } // R #fc9502
    if (res == 78u) { return vec4<f32>(0.710, 0.761, 0.024, 1.0); } // N #b5c206
    if (res == 68u) { return vec4<f32>(0.373, 0.647, 0.020, 1.0); } // D #5fa505
    if (res == 67u) { return vec4<f32>(0.031, 0.576, 0.996, 1.0); } // C #0893fe
    if (res == 81u) { return vec4<f32>(0.749, 0.522, 0.153, 1.0); } // Q #bf8527
    if (res == 69u) { return vec4<f32>(0.859, 0.710, 0.004, 1.0); } // E #dbb501
    if (res == 71u) { return vec4<f32>(0.0, 0.827, 0.510, 1.0); }   // G #00d382
    if (res == 72u) { return vec4<f32>(1.0, 0.341, 0.004, 1.0); }   // H #ff5701
    if (res == 73u) { return vec4<f32>(0.604, 0.729, 0.953, 1.0); } // I #9abaf3
    if (res == 76u) { return vec4<f32>(0.804, 0.647, 0.863, 1.0); } // L #cda5dc
    if (res == 75u) { return vec4<f32>(0.996, 0.647, 0.153, 1.0); } // K #fea527
    if (res == 77u) { return vec4<f32>(0.961, 0.631, 0.722, 1.0); } // M #f5a1b8
    if (res == 70u) { return vec4<f32>(0.969, 0.310, 0.659, 1.0); } // F #f74fa8
    if (res == 80u) { return vec4<f32>(0.063, 0.839, 0.192, 1.0); } // P #10d631
    if (res == 83u) { return vec4<f32>(0.494, 0.616, 0.349, 1.0); } // S #7e9d59
    if (res == 84u) { return vec4<f32>(0.0, 0.635, 0.612, 1.0); }   // T #00a29c
    if (res == 87u) { return vec4<f32>(0.996, 0.031, 0.984, 1.0); } // W #fe08fb
    if (res == 89u) { return vec4<f32>(1.0, 0.306, 0.478, 1.0); }   // Y #ff4e7a
    if (res == 86u) { return vec4<f32>(0.529, 0.753, 0.894, 1.0); } // V #87c0e4
    return default_scheme_color();
}

fn apply_gecos_sunset_rules(raw_res: u32) -> vec4<f32> {
    let res = normalize_residue(raw_res);
    if (res == 65u) { return vec4<f32>(0.996, 0.627, 0.992, 1.0); } // A #fea0fd
    if (res == 82u) { return vec4<f32>(0.522, 0.455, 0.416, 1.0); } // R #85746a
    if (res == 78u) { return vec4<f32>(0.671, 0.784, 0.961, 1.0); } // N #abc8f5
    if (res == 68u) { return vec4<f32>(0.180, 0.482, 0.745, 1.0); } // D #2e7bbe
    if (res == 67u) { return vec4<f32>(0.988, 0.047, 0.996, 1.0); } // C #fc0cfe
    if (res == 81u) { return vec4<f32>(0.549, 0.431, 0.506, 1.0); } // Q #8c6e81
    if (res == 69u) { return vec4<f32>(0.404, 0.471, 0.573, 1.0); } // E #677892
    if (res == 71u) { return vec4<f32>(0.153, 0.600, 1.0, 1.0); }   // G #2799ff
    if (res == 72u) { return vec4<f32>(0.859, 0.773, 0.557, 1.0); } // H #dbc58e
    if (res == 73u) { return vec4<f32>(0.980, 0.129, 0.631, 1.0); } // I #fa21a1
    if (res == 76u) { return vec4<f32>(0.878, 0.118, 0.510, 1.0); } // L #e01e82
    if (res == 75u) { return vec4<f32>(0.871, 0.745, 0.800, 1.0); } // K #debecc
    if (res == 77u) { return vec4<f32>(0.820, 0.243, 0.482, 1.0); } // M #d13e7b
    if (res == 70u) { return vec4<f32>(1.0, 0.220, 0.365, 1.0); }   // F #ff385d
    if (res == 80u) { return vec4<f32>(0.341, 0.400, 0.976, 1.0); } // P #5766f9
    if (res == 83u) { return vec4<f32>(0.906, 0.706, 0.992, 1.0); } // S #e7b4fd
    if (res == 84u) { return vec4<f32>(0.651, 0.345, 0.718, 1.0); } // T #a658b7
    if (res == 87u) { return vec4<f32>(1.0, 0.216, 0.004, 1.0); }   // W #ff3701
    if (res == 89u) { return vec4<f32>(0.796, 0.325, 0.224, 1.0); } // Y #cb5339
    if (res == 86u) { return vec4<f32>(0.996, 0.318, 0.722, 1.0); } // V #fe51b8
    return default_scheme_color();
}

fn apply_gecos_ocean_rules(raw_res: u32) -> vec4<f32> {
    let res = normalize_residue(raw_res);
    if (res == 65u) { return vec4<f32>(0.776, 0.792, 0.608, 1.0); } // A #c6ca9b
    if (res == 82u) { return vec4<f32>(0.047, 0.627, 0.659, 1.0); } // R #0ca0a8
    if (res == 78u) { return vec4<f32>(0.039, 0.875, 0.765, 1.0); } // N #0adfc3
    if (res == 68u) { return vec4<f32>(0.298, 0.875, 0.631, 1.0); } // D #4cdfa1
    if (res == 67u) { return vec4<f32>(0.776, 0.506, 0.212, 1.0); } // C #c68136
    if (res == 81u) { return vec4<f32>(0.545, 0.827, 0.820, 1.0); } // Q #8bd3d1
    if (res == 69u) { return vec4<f32>(0.376, 0.855, 0.788, 1.0); } // E #60dac9
    if (res == 71u) { return vec4<f32>(0.200, 0.647, 0.318, 1.0); } // G #33a551
    if (res == 72u) { return vec4<f32>(0.0, 0.812, 0.996, 1.0); }   // H #00cffe
    if (res == 73u) { return vec4<f32>(0.949, 0.729, 0.667, 1.0); } // I #f2baaa
    if (res == 76u) { return vec4<f32>(0.733, 0.541, 0.514, 1.0); } // L #bb8a83
    if (res == 75u) { return vec4<f32>(0.251, 0.627, 0.565, 1.0); } // K #40a090
    if (res == 77u) { return vec4<f32>(0.643, 0.545, 0.533, 1.0); } // M #a48b88
    if (res == 70u) { return vec4<f32>(0.671, 0.533, 0.682, 1.0); } // F #ab88ae
    if (res == 80u) { return vec4<f32>(0.686, 0.827, 0.396, 1.0); } // P #afd365
    if (res == 83u) { return vec4<f32>(0.427, 0.608, 0.455, 1.0); } // S #6d9b74
    if (res == 84u) { return vec4<f32>(0.553, 0.584, 0.400, 1.0); } // T #8d9566
    if (res == 87u) { return vec4<f32>(0.459, 0.541, 0.933, 1.0); } // W #758aee
    if (res == 89u) { return vec4<f32>(0.729, 0.765, 0.988, 1.0); } // Y #bac3fc
    if (res == 86u) { return vec4<f32>(0.914, 0.745, 0.643, 1.0); } // V #e9bea4
    return default_scheme_color();
}

fn apply_helix_propensity_rules(raw_res: u32) -> vec4<f32> {
    let res = normalize_residue(raw_res);
    if (res == 65u) { return vec4<f32>(0.906, 0.094, 0.906, 1.0); } // A #e718e7
    if (res == 82u) { return vec4<f32>(0.435, 0.565, 0.435, 1.0); } // R #6f906f
    if (res == 78u) { return vec4<f32>(0.106, 0.894, 0.106, 1.0); } // N #1be41b
    if (res == 68u) { return vec4<f32>(0.467, 0.533, 0.467, 1.0); } // D #778877
    if (res == 67u) { return vec4<f32>(0.137, 0.863, 0.137, 1.0); } // C #23dc23
    if (res == 81u) { return vec4<f32>(0.573, 0.427, 0.573, 1.0); } // Q #926d92
    if (res == 69u) { return vec4<f32>(1.0, 0.0, 1.0, 1.0); }       // E #ff00ff
    if (res == 71u) { return vec4<f32>(0.0, 1.0, 0.0, 1.0); }       // G #00ff00
    if (res == 72u) { return vec4<f32>(0.459, 0.541, 0.459, 1.0); } // H #758a75
    if (res == 73u) { return vec4<f32>(0.541, 0.459, 0.541, 1.0); } // I #8a758a
    if (res == 76u) { return vec4<f32>(0.682, 0.318, 0.682, 1.0); } // L #ae51ae
    if (res == 75u) { return vec4<f32>(0.627, 0.373, 0.627, 1.0); } // K #a05fa0
    if (res == 77u) { return vec4<f32>(0.937, 0.063, 0.937, 1.0); } // M #ef10ef
    if (res == 70u) { return vec4<f32>(0.596, 0.404, 0.596, 1.0); } // F #986798
    if (res == 80u) { return vec4<f32>(0.0, 1.0, 0.0, 1.0); }       // P #00ff00
    if (res == 83u) { return vec4<f32>(0.212, 0.788, 0.212, 1.0); } // S #36c936
    if (res == 84u) { return vec4<f32>(0.278, 0.722, 0.278, 1.0); } // T #47b847
    if (res == 87u) { return vec4<f32>(0.541, 0.459, 0.541, 1.0); } // W #8a758a
    if (res == 89u) { return vec4<f32>(0.129, 0.871, 0.129, 1.0); } // Y #21de21
    if (res == 86u) { return vec4<f32>(0.522, 0.478, 0.522, 1.0); } // V #857a85
    if (res == 66u) { return vec4<f32>(0.286, 0.714, 0.286, 1.0); } // B #49b649
    if (res == 88u) { return vec4<f32>(0.459, 0.541, 0.459, 1.0); } // X #758a75
    if (res == 90u) { return vec4<f32>(0.788, 0.212, 0.788, 1.0); } // Z #c936c9
    return default_scheme_color();
}

fn apply_strand_propensity_rules(raw_res: u32) -> vec4<f32> {
    let res = normalize_residue(raw_res);
    if (res == 65u) { return vec4<f32>(0.345, 0.345, 0.655, 1.0); } // A #5858a7
    if (res == 82u) { return vec4<f32>(0.420, 0.420, 0.580, 1.0); } // R #6b6b94
    if (res == 78u) { return vec4<f32>(0.392, 0.392, 0.608, 1.0); } // N #64649b
    if (res == 68u) { return vec4<f32>(0.129, 0.129, 0.871, 1.0); } // D #2121de
    if (res == 67u) { return vec4<f32>(0.616, 0.616, 0.384, 1.0); } // C #9d9d62
    if (res == 81u) { return vec4<f32>(0.549, 0.549, 0.451, 1.0); } // Q #8c8c73
    if (res == 69u) { return vec4<f32>(0.0, 0.0, 1.0, 1.0); }       // E #0000ff
    if (res == 71u) { return vec4<f32>(0.286, 0.286, 0.714, 1.0); } // G #4949b6
    if (res == 72u) { return vec4<f32>(0.376, 0.376, 0.624, 1.0); } // H #60609f
    if (res == 73u) { return vec4<f32>(0.925, 0.925, 0.075, 1.0); } // I #ecec13
    if (res == 76u) { return vec4<f32>(0.698, 0.698, 0.302, 1.0); } // L #b2b24d
    if (res == 75u) { return vec4<f32>(0.278, 0.278, 0.722, 1.0); } // K #4747b8
    if (res == 77u) { return vec4<f32>(0.510, 0.510, 0.490, 1.0); } // M #82827d
    if (res == 70u) { return vec4<f32>(0.761, 0.761, 0.239, 1.0); } // F #c2c23d
    if (res == 80u) { return vec4<f32>(0.137, 0.137, 0.863, 1.0); } // P #2323dc
    if (res == 83u) { return vec4<f32>(0.286, 0.286, 0.714, 1.0); } // S #4949b6
    if (res == 84u) { return vec4<f32>(0.616, 0.616, 0.384, 1.0); } // T #9d9d62
    if (res == 87u) { return vec4<f32>(0.753, 0.753, 0.247, 1.0); } // W #c0c03f
    if (res == 89u) { return vec4<f32>(0.827, 0.827, 0.173, 1.0); } // Y #d3d32c
    if (res == 86u) { return vec4<f32>(1.0, 1.0, 0.0, 1.0); }       // V #ffff00
    if (res == 66u) { return vec4<f32>(0.263, 0.263, 0.737, 1.0); } // B #4343bc
    if (res == 88u) { return vec4<f32>(0.475, 0.475, 0.525, 1.0); } // X #797986
    if (res == 90u) { return vec4<f32>(0.278, 0.278, 0.722, 1.0); } // Z #4747b8
    return default_scheme_color();
}

fn apply_turn_propensity_rules(raw_res: u32) -> vec4<f32> {
    let res = normalize_residue(raw_res);
    if (res == 65u) { return vec4<f32>(0.173, 0.827, 0.827, 1.0); } // A #2cd3d3
    if (res == 82u) { return vec4<f32>(0.439, 0.561, 0.561, 1.0); } // R #708f8f
    if (res == 78u) { return vec4<f32>(1.0, 0.0, 0.0, 1.0); }       // N #ff0000
    if (res == 68u) { return vec4<f32>(0.910, 0.090, 0.090, 1.0); } // D #e81717
    if (res == 67u) { return vec4<f32>(0.659, 0.341, 0.341, 1.0); } // C #a85757
    if (res == 81u) { return vec4<f32>(0.247, 0.753, 0.753, 1.0); } // Q #3fc0c0
    if (res == 69u) { return vec4<f32>(0.467, 0.533, 0.533, 1.0); } // E #778888
    if (res == 71u) { return vec4<f32>(1.0, 0.0, 0.0, 1.0); }       // G #ff0000
    if (res == 72u) { return vec4<f32>(0.439, 0.561, 0.561, 1.0); } // H #708f8f
    if (res == 73u) { return vec4<f32>(0.0, 1.0, 1.0, 1.0); }       // I #00ffff
    if (res == 76u) { return vec4<f32>(0.110, 0.890, 0.890, 1.0); } // L #1ce3e3
    if (res == 75u) { return vec4<f32>(0.494, 0.506, 0.506, 1.0); } // K #7e8181
    if (res == 77u) { return vec4<f32>(0.118, 0.882, 0.882, 1.0); } // M #1ee1e1
    if (res == 70u) { return vec4<f32>(0.118, 0.882, 0.882, 1.0); } // F #1ee1e1
    if (res == 80u) { return vec4<f32>(0.965, 0.035, 0.035, 1.0); } // P #f60909
    if (res == 83u) { return vec4<f32>(0.882, 0.118, 0.118, 1.0); } // S #e11e1e
    if (res == 84u) { return vec4<f32>(0.451, 0.549, 0.549, 1.0); } // T #738c8c
    if (res == 87u) { return vec4<f32>(0.451, 0.549, 0.549, 1.0); } // W #738c8c
    if (res == 89u) { return vec4<f32>(0.616, 0.384, 0.384, 1.0); } // Y #9d6262
    if (res == 86u) { return vec4<f32>(0.027, 0.973, 0.973, 1.0); } // V #07f8f8
    if (res == 66u) { return vec4<f32>(0.953, 0.047, 0.047, 1.0); } // B #f30c0c
    if (res == 88u) { return vec4<f32>(0.486, 0.514, 0.514, 1.0); } // X #7c8383
    if (res == 90u) { return vec4<f32>(0.357, 0.643, 0.643, 1.0); } // Z #5ba4a4
    return default_scheme_color();
}

fn apply_buried_index_rules(raw_res: u32) -> vec4<f32> {
    let res = normalize_residue(raw_res);
    if (res == 65u) { return vec4<f32>(0.0, 0.639, 0.361, 1.0); } // A #00a35c
    if (res == 82u) { return vec4<f32>(0.0, 0.988, 0.012, 1.0); } // R #00fc03
    if (res == 78u) { return vec4<f32>(0.0, 0.922, 0.078, 1.0); } // N #00eb14
    if (res == 68u) { return vec4<f32>(0.0, 0.922, 0.078, 1.0); } // D #00eb14
    if (res == 67u) { return vec4<f32>(0.0, 0.0, 1.0, 1.0); }     // C #0000ff
    if (res == 81u) { return vec4<f32>(0.0, 0.945, 0.055, 1.0); } // Q #00f10e
    if (res == 69u) { return vec4<f32>(0.0, 0.945, 0.055, 1.0); } // E #00f10e
    if (res == 71u) { return vec4<f32>(0.0, 0.616, 0.384, 1.0); } // G #009d62
    if (res == 72u) { return vec4<f32>(0.0, 0.835, 0.165, 1.0); } // H #00d52a
    if (res == 73u) { return vec4<f32>(0.0, 0.329, 0.671, 1.0); } // I #0054ab
    if (res == 76u) { return vec4<f32>(0.0, 0.482, 0.518, 1.0); } // L #007b84
    if (res == 75u) { return vec4<f32>(0.0, 1.0, 0.0, 1.0); }     // K #00ff00
    if (res == 77u) { return vec4<f32>(0.0, 0.592, 0.408, 1.0); } // M #009768
    if (res == 70u) { return vec4<f32>(0.0, 0.529, 0.471, 1.0); } // F #008778
    if (res == 80u) { return vec4<f32>(0.0, 0.878, 0.122, 1.0); } // P #00e01f
    if (res == 83u) { return vec4<f32>(0.0, 0.835, 0.165, 1.0); } // S #00d52a
    if (res == 84u) { return vec4<f32>(0.0, 0.859, 0.141, 1.0); } // T #00db24
    if (res == 87u) { return vec4<f32>(0.0, 0.659, 0.341, 1.0); } // W #00a857
    if (res == 89u) { return vec4<f32>(0.0, 0.902, 0.098, 1.0); } // Y #00e619
    if (res == 86u) { return vec4<f32>(0.0, 0.373, 0.627, 1.0); } // V #005fa0
    if (res == 66u) { return vec4<f32>(0.0, 0.922, 0.078, 1.0); } // B #00eb14
    if (res == 88u) { return vec4<f32>(0.0, 0.714, 0.286, 1.0); } // X #00b649
    if (res == 90u) { return vec4<f32>(0.0, 0.945, 0.055, 1.0); } // Z #00f10e
    return default_scheme_color();
}

@vertex
fn vs_main(@builtin(vertex_index) idx: u32) -> VertexOutput {
    var pos = array<vec2<f32>, 6> (
        vec2<f32>(-1.0, -1.0), vec2<f32>(1.0, -1.0), vec2<f32>(-1.0, 1.0),
        vec2<f32>(-1.0, 1.0), vec2<f32>(1.0, -1.0), vec2<f32>(1.0, 1.0)
    );
    var out: VertexOutput;
    out.pos = vec4<f32>(pos[idx], 0.0, 1.0);
    out.uv = pos[idx] * 0.5 + 0.5; // Map from [-1,1] to [0,1]
    return out;
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
    let pixel = vec2<u32>(u32(in.pos.x), u32(in.pos.y));
    let content_pixel = pixel + ui.scrollPx;
    let cell = content_pixel / ui.gridSize;
    let col = cell.x;
    let row = cell.y;
    let base_background = default_scheme_color();

    if (pixel.x >= ui.canvasSize.x || pixel.y >= ui.canvasSize.y) {
        return base_background;
    }
    if (col >= ui.totalSize.x || row >= ui.totalSize.y) {
        return base_background;
    }

    let residue = msaData[row * ui.totalSize.x + col];
    let mask = colProfile[col];

    var color = vec4<f32>(0.0, 0.0, 0.0, 1.0);
    switch (theme.colorScheme) {
        case 0u: { color = apply_clustalx_rules(residue, mask); }
        case 1u: { color = apply_pid_rules(residue, mask); }
        case 2u: { color = apply_blosum_rules(residue, mask); }
        case 3u: { color = apply_hydrophobicity_rules(residue); }
        case 4u: { color = apply_zappo_rules(residue); }
        case 5u: { color = apply_taylor_rules(residue); }
        case 6u: { color = apply_gecos_blossom_rules(residue); }
        case 7u: { color = apply_gecos_sunset_rules(residue); }
        case 8u: { color = apply_gecos_ocean_rules(residue); }
        case 9u: { color = apply_helix_propensity_rules(residue); }
        case 10u: { color = apply_strand_propensity_rules(residue); }
        case 11u: { color = apply_turn_propensity_rules(residue); }
        case 12u: { color = apply_buried_index_rules(residue); }
        default: { color = vec4<f32>(0.0, 0.0, 0.0, 1.0); }
    }
    let local = content_pixel % ui.gridSize;
    let local_uv = (vec2<f32>(local) + vec2<f32>(0.5, 0.5)) / vec2<f32>(ui.gridSize);
    let glyph_mask = smoothstep(0.2, 0.8, sample_glyph_mask(residue, local_uv));
    let background = color.rgb;
    let text_color = contrast_text_color(background);
    let rgb = mix(background, text_color, glyph_mask);
    return vec4<f32>(rgb, 1.0);
}
