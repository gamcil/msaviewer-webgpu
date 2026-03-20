// 2-pass compute shader for column score metrics
// aggregate counts over tiles then computes scores

const TILE_WIDTH: u32 = 512u;
const TILE_HEIGHT: u32 = 256u;

struct Uniforms {
    total_vertical_tiles: u32,
    msa_height: u32,
    total_msa_columns: u32,
    current_row_tile: u32,
    current_col_start: u32,
    current_tile_cols: u32
}

struct PartialCounts {
    counts: array<u32, 21>,
}

struct ColumnMetrics {
    quality: f32,
    occupancy: f32,
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var<storage, read> msa_tile: array<u32>;
@group(0) @binding(2) var<storage, read_write> intermediate_buffer: array<PartialCounts>;
@group(0) @binding(3) var<storage, read_write> metrics_out: array<ColumnMetrics>;
@group(0) @binding(4) var<storage, read> blosum62: array<i32>;


fn normalize_residue(raw: u32) -> u32 {
    if (raw >= 97u && raw <= 122u) {
        return raw - 32u;
    }
    return raw;
}

fn residue_to_index(raw: u32) -> u32 {
    let residue = normalize_residue(raw);
    switch residue {
        case 65u: { return 0u; }  // A
        case 82u: { return 1u; }  // R
        case 78u: { return 2u; }  // N
        case 68u: { return 3u; }  // D
        case 67u: { return 4u; }  // C
        case 81u: { return 5u; }  // Q
        case 69u: { return 6u; }  // E
        case 71u: { return 7u; }  // G
        case 72u: { return 8u; }  // H
        case 73u: { return 9u; }  // I
        case 76u: { return 10u; } // L
        case 75u: { return 11u; } // K
        case 77u: { return 12u; } // M
        case 70u: { return 13u; } // F
        case 80u: { return 14u; } // P
        case 83u: { return 15u; } // S
        case 84u: { return 16u; } // T
        case 87u: { return 17u; } // W
        case 89u: { return 18u; } // Y
        case 86u: { return 19u; } // V
        default: { return 20u; }  // gap/unknown/other
    }
}

fn calculate_intermediate_offset(col: u32, tile_row_id: u32) -> u32 {
    return (col * uniforms.total_vertical_tiles) + tile_row_id;
}

fn get_residue_from_blob(col: u32, row: u32) -> u32 {
    let byte_index = (row * TILE_WIDTH) + col;
    let u32_index = byte_index >> 2u;           // Equivalent to / 4
    let bit_offset = (byte_index & 3u) << 3u;   // Equivalent to (index % 4) * 8
    return extractBits(msa_tile[u32_index], bit_offset, 8u);
}

fn calculate_quality(final_counts: array<u32, 21>) -> f32 {
    var non_gap_count = 0u;
    for (var i = 0u; i < 20u; i = i + 1u) {
        non_gap_count += final_counts[i];
    }
    if (non_gap_count < 2u || uniforms.msa_height == 0u) {
        return 0.0;
    }
    let occupancy = f32(non_gap_count) / f32(uniforms.msa_height);

    var quality = 0.0;
    var total_pairs = 0.0;

    for (var i = 0u; i < 20u; i = i + 1u) {
        let count_i = f32(final_counts[i]);
        if (count_i == 0.0) { continue; }

        for (var j = 0u; j < 20u; j = j + 1u) {
            let count_j = f32(final_counts[j]);
            if (count_j == 0.0) { continue; }

            let pair_count = count_i * count_j;
            let pair_score = f32(blosum62[i * 25u + j]);
            let self_i = f32(blosum62[i * 25u + i]);
            let self_j = f32(blosum62[j * 25u + j]);
            let denom = max(self_i, self_j);
            let ratio = select(0.0, pair_score / denom, denom > 0.0);
            quality += pair_count * ratio;
            total_pairs += pair_count;
        }
    }
    if (total_pairs == 0.0) { return 0.0; }
    return max(0.0, (quality / total_pairs) * occupancy);
}

@compute @workgroup_size(64, 1, 1)
fn count_residues(@builtin(global_invocation_id) gid: vec3u) {
    let col = gid.x;
    if (col >= uniforms.current_tile_cols) { return; }    
    
    var local_counts = array<u32, 21>();
    
    let tile_start_row = uniforms.current_row_tile * TILE_HEIGHT;
    
    for (var row = 0u; row < TILE_HEIGHT; row = row + 1u) {
        if (tile_start_row + row >= uniforms.msa_height) { break; }
        let raw_residue = get_residue_from_blob(col, row);
        if (raw_residue >= 97u && raw_residue <= 122u) { continue; }
        let residue_index = residue_to_index(raw_residue);
        local_counts[residue_index] = local_counts[residue_index] + 1u;
    }
    
    let slot_index = calculate_intermediate_offset(col, uniforms.current_row_tile);
    intermediate_buffer[slot_index].counts = local_counts;
}

@compute @workgroup_size(64, 1, 1)
fn aggregate_metrics(@builtin(global_invocation_id) gid: vec3u) {
    let col = gid.x;
    if (col >= uniforms.total_msa_columns) { return; }
    
    // final summation of counts
    var final_counts = array<u32, 21>();
    for (var t = 0u; t < uniforms.total_vertical_tiles; t = t + 1u) {
        let slot = calculate_intermediate_offset(col, t);
        for (var aa = 0u; aa < 21u; aa = aa + 1u) {
            final_counts[aa] += intermediate_buffer[slot].counts[aa];
        }
    }
    
    var non_gap_count = 0u;
    for (var i = 0u; i < 20u; i = i + 1u) {
        non_gap_count += final_counts[i];
    }
    
    let quality = calculate_quality(final_counts);
    let occupancy = f32(non_gap_count) / f32(uniforms.msa_height);

    metrics_out[col].quality = quality; 
    metrics_out[col].occupancy = occupancy; 
}
