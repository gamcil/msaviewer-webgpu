// Compute shader for CLUSTALX colorscheme.
//
// One invocation computes the profile mask for a single alignment column.
// The output bit layout is:
//  0  HYDROPHOBIC_60      >60% of WLVIMAFCHP
//  1  KR_60              >60% of K or R
//  2  KRQ_80_ANY         >80% of K or R or Q individually
//  3  QE_50              >50% of Q or E
//  4  ED_50              >50% of E or D
//  5  EQD_80_ANY         >80% of E or Q or D individually
//  6  DEN_80_ANY         >80% of D or E or N individually
//  7  N_50               >50% of N
//  8  QTKR_80_ANY        >80% of Q or T or K or R individually
//  9  TS_50              >50% of T or S
// 10  ST_80_ANY          >80% of S or T individually
// 11  C_80               >80% of C
// 12  G_PRESENT          >0% of G
// 13  P_PRESENT          >0% of P
// 14  AROMATIC_80_ANY    >80% of W,Y,A,C,P,Q,F,H,I,L,M,V individually

struct Params {
    columns: u32,
    rows: u32,
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> msaData: array<u32>;
@group(0) @binding(2) var<storage, read_write> columnMasks: array<u32>;

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
        nonGapCount = nonGapCount + 1u;
        switch residue {
            case 65u: { countA = countA + 1u; }
            case 67u: { countC = countC + 1u; }
            case 68u: { countD = countD + 1u; }
            case 69u: { countE = countE + 1u; }
            case 70u: { countF = countF + 1u; }
            case 71u: { countG = countG + 1u; }
            case 72u: { countH = countH + 1u; }
            case 73u: { countI = countI + 1u; }
            case 75u: { countK = countK + 1u; }
            case 76u: { countL = countL + 1u; }
            case 77u: { countM = countM + 1u; }
            case 78u: { countN = countN + 1u; }
            case 80u: { countP = countP + 1u; }
            case 81u: { countQ = countQ + 1u; }
            case 82u: { countR = countR + 1u; }
            case 83u: { countS = countS + 1u; }
            case 84u: { countT = countT + 1u; }
            case 86u: { countV = countV + 1u; }
            case 87u: { countW = countW + 1u; }
            case 89u: { countY = countY + 1u; }
            default: {}
        }
    }

    // Count grouped thresholds
    let hydrophobicCount = countW + countL + countV + countI + countM + countA + countF + countC + countH + countP;
    let krCount = countK + countR;
    let qeCount = countQ + countE;
    let edCount = countE + countD;
    let tsCount = countT + countS;

    var mask = 0u;

    if (moreThanPercent(hydrophobicCount, nonGapCount, 60u)) {
        mask = mask | BIT_HYDROPHOBIC_60;
    }
    if (moreThanPercent(krCount, nonGapCount, 60u)) {
        mask = mask | BIT_KR_60;
    }
    if (
        moreThanPercent(countK, nonGapCount, 80u) ||
        moreThanPercent(countR, nonGapCount, 80u) ||
        moreThanPercent(countQ, nonGapCount, 80u)
    ) {
        mask = mask | BIT_KRQ_80_ANY;
    }
    if (moreThanPercent(qeCount, nonGapCount, 50u)) {
        mask = mask | BIT_QE_50;
    }
    if (moreThanPercent(edCount, nonGapCount, 50u)) {
        mask = mask | BIT_ED_50;
    }
    if (
        moreThanPercent(countE, nonGapCount, 80u) ||
        moreThanPercent(countQ, nonGapCount, 80u) ||
        moreThanPercent(countD, nonGapCount, 80u)
    ) {
        mask = mask | BIT_EQD_80_ANY;
    }
    if (
        moreThanPercent(countD, nonGapCount, 80u) ||
        moreThanPercent(countE, nonGapCount, 80u) ||
        moreThanPercent(countN, nonGapCount, 80u)
    ) {
        mask = mask | BIT_DEN_80_ANY;
    }
    if (moreThanPercent(countN, nonGapCount, 50u)) {
        mask = mask | BIT_N_50;
    }
    if (
        moreThanPercent(countQ, nonGapCount, 80u) ||
        moreThanPercent(countT, nonGapCount, 80u) ||
        moreThanPercent(countK, nonGapCount, 80u) ||
        moreThanPercent(countR, nonGapCount, 80u)
    ) {
        mask = mask | BIT_QTKR_80_ANY;
    }
    if (moreThanPercent(tsCount, nonGapCount, 50u)) {
        mask = mask | BIT_TS_50;
    }
    if (
        moreThanPercent(countS, nonGapCount, 80u) ||
        moreThanPercent(countT, nonGapCount, 80u)
    ) {
        mask = mask | BIT_ST_80_ANY;
    }
    if (moreThanPercent(countC, nonGapCount, 80u)) {
        mask = mask | BIT_C_80;
    }
    if (countG > 0u) {
        mask = mask | BIT_G_PRESENT;
    }
    if (countP > 0u) {
        mask = mask | BIT_P_PRESENT;
    }
    if (
        moreThanPercent(countW, nonGapCount, 80u) ||
        moreThanPercent(countY, nonGapCount, 80u) ||
        moreThanPercent(countA, nonGapCount, 80u) ||
        moreThanPercent(countC, nonGapCount, 80u) ||
        moreThanPercent(countP, nonGapCount, 80u) ||
        moreThanPercent(countQ, nonGapCount, 80u) ||
        moreThanPercent(countF, nonGapCount, 80u) ||
        moreThanPercent(countH, nonGapCount, 80u) ||
        moreThanPercent(countI, nonGapCount, 80u) ||
        moreThanPercent(countL, nonGapCount, 80u) ||
        moreThanPercent(countM, nonGapCount, 80u) ||
        moreThanPercent(countV, nonGapCount, 80u)
    ) {
        mask = mask | BIT_AROMATIC_80_ANY;
    }

    columnMasks[col] = mask;
}
