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

const ATLAS_SIZE: vec2<f32> = vec2<f32>(896.0, 256.0);
const GLYPH_SIZE: vec2<f32> = vec2<f32>(64.0, 64.0);
const ATLAS_PX_RANGE: f32 = 6.0;

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
    if (res == 45u) {
        return vec2<u32>(0u, 0u);
    }
    if (res >= 65u && res <= 77u) {
        return vec2<u32>((res - 65u) + 1u, 0u);
    }
    if (res >= 78u && res <= 90u) {
        return vec2<u32>(res - 78u, 1u);
    }
    if (res >= 97u && res <= 111u) {
        return vec2<u32>(res - 97u, 2u);
    }
    if (res >= 112u && res <= 122u) {
        return vec2<u32>(res - 112u, 3u);
    }
    return vec2<u32>(0u, 0u);
}

fn median3(v: vec3<f32>) -> f32 {
    return max(min(v.r, v.g), min(max(v.r, v.g), v.b));
}

fn glyph_atlas_uv(res: u32, local_uv: vec2<f32>) -> vec2<f32> {
    let cell = glyph_cell(res);
    return (vec2<f32>(cell) * GLYPH_SIZE + local_uv * GLYPH_SIZE) / ATLAS_SIZE;
}

fn sample_glyph_distance(atlas_uv: vec2<f32>) -> f32 {
    let sample = textureSampleLevel(fontAtlas, fontSampler, atlas_uv, 0.0);
    return median3(sample.rgb) - 0.5;
}

fn screen_px_range_from_local_uv(local_uv: vec2<f32>) -> f32 {
    let unit_range = vec2<f32>(ATLAS_PX_RANGE, ATLAS_PX_RANGE) / ATLAS_SIZE;
    let atlas_uv_derivative = max(
        fwidth(local_uv) * (GLYPH_SIZE / ATLAS_SIZE),
        vec2<f32>(1e-6, 1e-6)
    );
    let screen_tex_size = vec2<f32>(1.0, 1.0) / atlas_uv_derivative;
    return max(0.5 * dot(unit_range, screen_tex_size), 1.0);
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
    let local = window_pixel % ui.gridSize;
    let local_uv = (vec2<f32>(local) + vec2<f32>(0.5, 0.5)) / vec2<f32>(ui.gridSize);
    let glyph_screen_px_range = screen_px_range_from_local_uv(local_uv);

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
    let atlas_uv = glyph_atlas_uv(residue, local_uv);
    let glyph_distance = sample_glyph_distance(atlas_uv);
    let glyph_mask = clamp(glyph_distance * glyph_screen_px_range + 0.5, 0.0, 1.0);
    let background = color.rgb;
    let text_color = contrast_text_color(background);
    let rgb = mix(background, text_color, glyph_mask);
    return vec4<f32>(rgb, 1.0);
}
