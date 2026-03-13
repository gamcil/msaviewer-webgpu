// Compute shader for BLOSUM62 colorscheme.
// Computes a bitmask for each column indicating consensus residue

struct Params {
    columns: u32,
    rows: u32,
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> msaData: array<u32>;
@group(0) @binding(2) var<storage, read_write> columnMasks: array<u32>;


fn normalizeResidue(raw: u32) -> u32 {
    if (raw >= 97u && raw <= 122u) {
        return raw - 32u;
    }
    return raw;
}

fn isGap(raw: u32) -> bool {
    return raw == 0u || raw == 45u || raw == 46u || raw == 32u;
}

fn moreThanPercent(count: u32, total: u32, percent: u32) -> bool {
    return total > 0u && count * 100u > percent * total;
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let col = gid.x;
    if (col >= params.columns) {
        return;
    }

    var nonGapCount = 0u;
    var maxCount = 0u;
    var maxResidue = 0u;
    var tmpCount = 0u;

    var countA = 0u;
    var countC = 0u;
    var countD = 0u;
    var countE = 0u;
    var countF = 0u;
    var countG = 0u;
    var countH = 0u;
    var countI = 0u;
    var countK = 0u;
    var countL = 0u;
    var countM = 0u;
    var countN = 0u;
    var countP = 0u;
    var countQ = 0u;
    var countR = 0u;
    var countS = 0u;
    var countT = 0u;
    var countV = 0u;
    var countW = 0u;
    var countY = 0u;

    for (var row = 0u; row < params.rows; row = row + 1u) {
        let residue = normalizeResidue(msaData[row * params.columns + col]);
        if (isGap(residue)) {
            continue;
        }
        tmpCount = 0u;
        nonGapCount = nonGapCount + 1u;
        switch residue {
            case 65u: { countA = countA + 1u; tmpCount = countA; }
            case 67u: { countC = countC + 1u; tmpCount = countC; }
            case 68u: { countD = countD + 1u; tmpCount = countD; }
            case 69u: { countE = countE + 1u; tmpCount = countE; }
            case 70u: { countF = countF + 1u; tmpCount = countF; }
            case 71u: { countG = countG + 1u; tmpCount = countG; }
            case 72u: { countH = countH + 1u; tmpCount = countH; }
            case 73u: { countI = countI + 1u; tmpCount = countI; }
            case 75u: { countK = countK + 1u; tmpCount = countK; }
            case 76u: { countL = countL + 1u; tmpCount = countL; }
            case 77u: { countM = countM + 1u; tmpCount = countM; }
            case 78u: { countN = countN + 1u; tmpCount = countN; }
            case 80u: { countP = countP + 1u; tmpCount = countP; }
            case 81u: { countQ = countQ + 1u; tmpCount = countQ; }
            case 82u: { countR = countR + 1u; tmpCount = countR; }
            case 83u: { countS = countS + 1u; tmpCount = countS; }
            case 84u: { countT = countT + 1u; tmpCount = countT; }
            case 86u: { countV = countV + 1u; tmpCount = countV; }
            case 87u: { countW = countW + 1u; tmpCount = countW; }
            case 89u: { countY = countY + 1u; tmpCount = countY; }
            default: {}
        }
        if (tmpCount > maxCount) {
            maxCount = tmpCount;
            maxResidue = residue;
        }
    }
    columnMasks[col] = maxResidue;
}
