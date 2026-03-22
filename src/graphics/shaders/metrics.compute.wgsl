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
    counts: array<u32, __BUCKET_STRIDE__>,
}

struct ColumnMetrics {
    quality: f32,
    occupancy: f32,
    entropy: f32,
    modal_fraction_non_gap: f32,
    information_content_raw: f32,
    consensus_index: f32,
    consensus_tie: f32,
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var<storage, read> msa_tile: array<u32>;
@group(0) @binding(2) var<storage, read_write> intermediate_buffer: array<PartialCounts>;
@group(0) @binding(3) var<storage, read_write> metrics_out: array<ColumnMetrics>;
@group(0) @binding(4) var<storage, read> quality_matrix: array<i32>;
@group(0) @binding(5) var<storage, read_write> counts: array<u32>;


fn normalize_residue(raw: u32) -> u32 {
    if (raw >= 97u && raw <= 122u) {
        return raw - 32u;
    }
    return raw;
}

fn residue_to_index(raw: u32) -> u32 {
    let residue = normalize_residue(raw);
    switch residue {
        __RESIDUE_TO_INDEX_CASES__
        default: { return __GAP_BUCKET_INDEX__u; }  // gap/unknown/other
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

__QUALITY_FUNCTION__

fn calculate_entropy(final_counts: array<u32, __BUCKET_STRIDE__>, non_gap_count: u32) -> f32 {
    if (non_gap_count < 2u) {
        return 0.0;
    }

    let total = f32(non_gap_count);
    var entropy = 0.0;
    for (var i = 0u; i < __CORE_SIZE__u; i = i + 1u) {
        let count = final_counts[i];
        if (count == 0u) { continue; }
        let p = f32(count) / total;
        entropy -= p * log2(p);
    }

    return entropy / log2(f32(__CORE_SIZE__));
}

fn calculate_modal_fraction_non_gap(final_counts: array<u32, __BUCKET_STRIDE__>) -> f32 {
    var non_gap_count = 0u;
    var max_count = 0u;
    for (var i = 0u; i < __CORE_SIZE__u; i = i + 1u) {
        non_gap_count += final_counts[i];
        max_count = max(max_count, final_counts[i]);
    }
    if (non_gap_count == 0u) {
        return 0.0;
    }
    return f32(max_count) / f32(non_gap_count);
}

fn calculate_information_content_raw(entropy: f32, non_gap_count: u32) -> f32 {
    if (non_gap_count == 0u) {
        return 0.0;
    }
    let max_entropy = log2(f32(__CORE_SIZE__));
    return max(0.0, (max_entropy - entropy) / max_entropy);
}

fn calculate_consensus_index(final_counts: array<u32, __BUCKET_STRIDE__>) -> f32 {
    var max_count = 0u;
    var max_index = __GAP_BUCKET_INDEX__u;
    for (var i = 0u; i < __CORE_SIZE__u; i = i + 1u) {
        if (final_counts[i] > max_count) {
            max_count = final_counts[i];
            max_index = i;
        }
    }
    return f32(max_index);
}

fn calculate_consensus_tie(final_counts: array<u32, __BUCKET_STRIDE__>) -> f32 {
    var max_count = 0u;
    for (var i = 0u; i < __CORE_SIZE__u; i = i + 1u) {
        max_count = max(max_count, final_counts[i]);
    }
    if (max_count == 0u) {
        return 0.0;
    }

    var num_max = 0u;
    for (var i = 0u; i < __CORE_SIZE__u; i = i + 1u) {
        if (final_counts[i] == max_count) {
            num_max += 1u;
        }
    }
    return select(0.0, 1.0, num_max > 1u);
}

fn calculate_counts_offset(col: u32, aa: u32) -> u32 {
    return col * __BUCKET_STRIDE__u + aa;
}

@compute @workgroup_size(64, 1, 1)
fn count_residues(@builtin(global_invocation_id) gid: vec3u) {
    let col = gid.x;
    if (col >= uniforms.current_tile_cols) { return; }    
    
    var local_counts = array<u32, __BUCKET_STRIDE__>();
    
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
    var final_counts = array<u32, __BUCKET_STRIDE__>();
    for (var t = 0u; t < uniforms.total_vertical_tiles; t = t + 1u) {
        let slot = calculate_intermediate_offset(col, t);
        for (var aa = 0u; aa < __BUCKET_STRIDE__u; aa = aa + 1u) {
            final_counts[aa] += intermediate_buffer[slot].counts[aa];
            counts[calculate_counts_offset(col, aa)] = final_counts[aa];
        }
    }
    
    var non_gap_count = 0u;
    for (var i = 0u; i < __CORE_SIZE__u; i = i + 1u) {
        non_gap_count += final_counts[i];
    }
    
    let quality = calculate_quality(final_counts);
    let occupancy = f32(non_gap_count) / f32(uniforms.msa_height);
    let entropy = calculate_entropy(final_counts, non_gap_count);
    let modal_fraction_non_gap = calculate_modal_fraction_non_gap(final_counts);
    let information_content_raw = calculate_information_content_raw(entropy * log2(f32(__CORE_SIZE__)), non_gap_count);
    let consensus_index = calculate_consensus_index(final_counts);
    let consensus_tie = calculate_consensus_tie(final_counts);

    metrics_out[col].quality = quality; 
    metrics_out[col].occupancy = occupancy; 
    metrics_out[col].entropy = entropy;
    metrics_out[col].modal_fraction_non_gap = modal_fraction_non_gap;
    metrics_out[col].information_content_raw = information_content_raw;
    metrics_out[col].consensus_index = consensus_index;
    metrics_out[col].consensus_tie = consensus_tie;
}
