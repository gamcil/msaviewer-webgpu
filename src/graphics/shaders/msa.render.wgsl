// WGSL Shader for MSA viewer

struct Uniforms {
    scrollPx: vec2<u32>,
    totalSize: vec2<u32>,
    gridSize: vec2<u32>,
    canvasSize: vec2<u32>,
    windowOrigin: vec2<u32>,
    windowSize: vec2<u32>,
}

struct ThemeUniforms {
    darkMode: u32,
    colorScheme: u32,
}

struct VisibleColumnMapEntry {
    rawCol: u32,
    rawWindowCol: u32,
}

@group(0) @binding(0) var<uniform> ui: Uniforms;
@group(0) @binding(1) var msaData: texture_2d<u32>;
@group(0) @binding(2) var<storage, read> colProfile: array<u32>;
@group(0) @binding(3) var<uniform> theme: ThemeUniforms;
@group(0) @binding(4) var fontAtlas: texture_2d<f32>;
@group(0) @binding(5) var fontSampler: sampler;
@group(0) @binding(6) var<storage, read> visibleColumnMap: array<VisibleColumnMapEntry>;
@group(0) @binding(7) var<storage, read> auxData: array<i32>;

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

fn is_lowercase_residue(raw: u32) -> bool {
    return raw >= 97u && raw <= 122u;
}

fn is_gap_residue(raw: u32) -> bool {
    return raw == 0u || raw == 45u || raw == 46u || raw == 32u;
}

fn has_mask(mask: u32, bit: u32) -> bool {
    return (mask & bit) != 0u;
}

fn glyph_cell(res: u32) -> vec2<u32> {
    if (res >= 65u && res <= 78u) {
        return vec2<u32>(res - 65u, 0u);
    }
    if (res >= 79u && res <= 90u) {
        return vec2<u32>(res - 79u, 1u);
    }
    if (res >= 97u && res <= 110u) {
        return vec2<u32>(res - 97u, 2u);
    }
    if (res >= 111u && res <= 122u) {
        return vec2<u32>(res - 111u, 3u);
    }
    if (res == 45u) {
        return vec2<u32>(12u, 1u);
    }
    return vec2<u32>(13u, 1u);
}

fn sample_glyph_mask(res: u32, local_uv: vec2<f32>) -> f32 {
    let cell = glyph_cell(res);
    let atlas_size = vec2<f32>(896.0, 256.0);
    let glyph_size = vec2<f32>(64.0, 64.0);
    let atlas_uv = (vec2<f32>(cell) * glyph_size + local_uv * glyph_size) / atlas_size;
    let sample = textureSampleLevel(fontAtlas, fontSampler, atlas_uv, 0.0);
    return max(sample.a, max(sample.r, max(sample.g, sample.b)));
}

fn read_residue(window_row: u32, window_col: u32) -> u32 {
    return textureLoad(msaData, vec2<i32>(i32(window_col), i32(window_row)), 0).x;
}

__SCHEME_COLOR_WGSL__

fn contrast_text_color(background: vec3<f32>) -> vec3<f32> {
    let luma = dot(background, vec3<f32>(0.299, 0.587, 0.114));
    if (luma > 0.55) {
        return vec3<f32>(0.05, 0.05, 0.05);
    }
    return vec3<f32>(0.95, 0.95, 0.95);
}

@vertex
fn vs_main(@builtin(vertex_index) idx: u32) -> VertexOutput {
    var pos = array<vec2<f32>, 6> (
        vec2<f32>(-1.0, -1.0), vec2<f32>(1.0, -1.0), vec2<f32>(-1.0, 1.0),
        vec2<f32>(-1.0, 1.0), vec2<f32>(1.0, -1.0), vec2<f32>(1.0, 1.0)
    );
    var out: VertexOutput;
    out.pos = vec4<f32>(pos[idx], 0.0, 1.0);
    out.uv = pos[idx] * 0.5 + 0.5;
    return out;
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
    let pixel = vec2<u32>(u32(in.pos.x), u32(in.pos.y));
    let window_pixel = pixel + ui.scrollPx;
    let local_cell = window_pixel / ui.gridSize;
    let col = ui.windowOrigin.x + local_cell.x;
    let row = ui.windowOrigin.y + local_cell.y;
    let base_background = default_scheme_color();

    if (pixel.x >= ui.canvasSize.x || pixel.y >= ui.canvasSize.y) {
        return base_background;
    }
    if (col >= ui.totalSize.x || row >= ui.totalSize.y) {
        return base_background;
    }
    if (local_cell.x >= ui.windowSize.x || local_cell.y >= ui.windowSize.y) {
        return base_background;
    }

    let column_map = visibleColumnMap[local_cell.x];
    let residue = read_residue(local_cell.y, column_map.rawWindowCol);
    let mask = colProfile[column_map.rawCol];
    let color = resolve_scheme_color(residue, mask);
    let local = window_pixel % ui.gridSize;
    let local_uv = (vec2<f32>(local) + vec2<f32>(0.5, 0.5)) / vec2<f32>(ui.gridSize);
    let glyph_mask = smoothstep(0.2, 0.8, sample_glyph_mask(residue, local_uv));
    let background = color.rgb;
    let text_color = contrast_text_color(background);
    let rgb = mix(background, text_color, glyph_mask);
    return vec4<f32>(rgb, 1.0);
}
