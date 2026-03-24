// WGSL Shader for the minimap

struct MinimapParams {
    totalRows: u32,
    totalCols: u32,
    chunkRowStart: u32,
    chunkColStart: u32,
    chunkRows: u32,
    chunkCols: u32,
    minimapWidth: u32,
    minimapHeight: u32,
}

struct ThemeUniforms {
    darkMode: u32,
    colorScheme: u32,
}

struct VisibleColumnMapEntry {
    rawCol: u32,
    rawWindowCol: u32,
}

@group(0) @binding(0) var<uniform> params: MinimapParams;
@group(0) @binding(1) var msaData: texture_2d<u32>;
@group(0) @binding(2) var<storage, read> colProfile: array<u32>;
@group(0) @binding(3) var<uniform> theme: ThemeUniforms;
@group(0) @binding(4) var<storage, read> visibleColumnMap: array<VisibleColumnMapEntry>;
@group(0) @binding(5) var<storage, read> auxData: array<i32>;
@group(0) @binding(6) var<storage, read_write> outPixels: array<u32>;

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

fn read_residue(local_row: u32, local_col: u32) -> u32 {
    return textureLoad(msaData, vec2<i32>(i32(local_col), i32(local_row)), 0).x;
}

__SCHEME_COLOR_WGSL__

fn scheme_color(raw_res: u32, local_col: u32) -> vec4<f32> {
    let column_map = visibleColumnMap[local_col];
    let mask = colProfile[column_map.rawCol];
    return resolve_scheme_color(raw_res, mask);
}

fn write_output(pixel_index: u32, r_sum: u32, g_sum: u32, b_sum: u32, count: u32) {
    let base = pixel_index * 4u;
    outPixels[base] = outPixels[base] + r_sum;
    outPixels[base + 1u] = outPixels[base + 1u] + g_sum;
    outPixels[base + 2u] = outPixels[base + 2u] + b_sum;
    outPixels[base + 3u] = outPixels[base + 3u] + count;
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let x = gid.x;
    let y = gid.y;
    if (x >= params.minimapWidth || y >= params.minimapHeight) {
        return;
    }

    let pixel_index = y * params.minimapWidth + x;

    let global_col_start = (x * params.totalCols) / params.minimapWidth;
    let global_col_end = max(global_col_start + 1u, ((x + 1u) * params.totalCols) / params.minimapWidth);
    let global_row_start = (y * params.totalRows) / params.minimapHeight;
    let global_row_end = max(global_row_start + 1u, ((y + 1u) * params.totalRows) / params.minimapHeight);

    let chunk_col_end = params.chunkColStart + params.chunkCols;
    let chunk_row_end = params.chunkRowStart + params.chunkRows;

    let sample_col_start = max(global_col_start, params.chunkColStart);
    let sample_col_end = min(global_col_end, chunk_col_end);
    let sample_row_start = max(global_row_start, params.chunkRowStart);
    let sample_row_end = min(global_row_end, chunk_row_end);

    if (sample_col_start >= sample_col_end || sample_row_start >= sample_row_end) {
        write_output(pixel_index, 0u, 0u, 0u, 0u);
        return;
    }

    let sample_col = sample_col_start + ((sample_col_end - sample_col_start) / 2u);
    let sample_row = sample_row_start + ((sample_row_end - sample_row_start) / 2u);
    let local_col = sample_col - params.chunkColStart;
    let local_row = sample_row - params.chunkRowStart;

    let residue = read_residue(local_row, visibleColumnMap[local_col].rawWindowCol);
    if (is_gap_residue(residue)) {
        write_output(pixel_index, 0u, 0u, 0u, 0u);
        return;
    }

    let color = scheme_color(residue, local_col);
    let r = u32(round(color.r * 255.0));
    let g = u32(round(color.g * 255.0));
    let b = u32(round(color.b * 255.0));
    write_output(pixel_index, r, g, b, 1u);
}
