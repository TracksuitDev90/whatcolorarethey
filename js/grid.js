// Shade-grid generator. Builds a 4x4 (or arbitrary) board of shades around
// a correct hex color, with the correct cell at a seeded random position.
//
// The grid is generated in OKLab/OKLCH (perceptually uniform) so neighbor
// difficulty is consistent across hues — a chroma step on Tweety yellow
// looks about as different as the same step on a dusty pink. The ramp is
// centered on the correct cell: rows and columns are assigned balanced
// signed offsets around the answer, so the correct cell sits in the
// middle of the visible spread instead of at one end of a monotone ramp.

// --- Legacy HSL helpers (still used by quad.js and daily.js) ------------

export function hexToHsl(hex) {
  const m = hex.replace('#', '');
  const n = m.length === 3
    ? m.split('').map(c => c + c).join('')
    : m;
  const r = parseInt(n.slice(0, 2), 16) / 255;
  const g = parseInt(n.slice(2, 4), 16) / 255;
  const b = parseInt(n.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0, s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h *= 60;
  }
  return { h, s: s * 100, l: l * 100 };
}

export function hslToHex(h, s, l) {
  const sat = clamp(s, 0, 100) / 100;
  const lig = clamp(l, 0, 100) / 100;
  const c = (1 - Math.abs(2 * lig - 1)) * sat;
  const hh = ((h % 360) + 360) % 360 / 60;
  const x = c * (1 - Math.abs(hh % 2 - 1));
  let r = 0, g = 0, b = 0;
  if (hh < 1) [r, g, b] = [c, x, 0];
  else if (hh < 2) [r, g, b] = [x, c, 0];
  else if (hh < 3) [r, g, b] = [0, c, x];
  else if (hh < 4) [r, g, b] = [0, x, c];
  else if (hh < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = lig - c / 2;
  const to = v => Math.round((v + m) * 255).toString(16).padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`.toUpperCase();
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

// --- OKLab / OKLCH utilities --------------------------------------------
// Reference: Björn Ottosson, https://bottosson.github.io/posts/oklab/

function srgbToLinear(c) {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function linearToSrgb(c) {
  return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

function hexToLinearRgb(hex) {
  const m = hex.replace('#', '');
  const n = m.length === 3 ? m.split('').map(c => c + c).join('') : m;
  return [
    srgbToLinear(parseInt(n.slice(0, 2), 16) / 255),
    srgbToLinear(parseInt(n.slice(2, 4), 16) / 255),
    srgbToLinear(parseInt(n.slice(4, 6), 16) / 255),
  ];
}

function linearRgbToOklab([r, g, b]) {
  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
  const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
  const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;
  const l_ = Math.cbrt(l);
  const m_ = Math.cbrt(m);
  const s_ = Math.cbrt(s);
  return [
    0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
    1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
    0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_,
  ];
}

function oklabToLinearRgb([L, a, b]) {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b;
  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
  ];
}

export function oklchFromHex(hex) {
  const [L, a, b] = linearRgbToOklab(hexToLinearRgb(hex));
  const C = Math.sqrt(a * a + b * b);
  let H = Math.atan2(b, a) * 180 / Math.PI;
  if (H < 0) H += 360;
  return { L, C, H };
}

function inGamut(L, C, H) {
  const hRad = H * Math.PI / 180;
  const a = C * Math.cos(hRad);
  const b = C * Math.sin(hRad);
  const [lr, lg, lb] = oklabToLinearRgb([L, a, b]);
  return lr >= 0 && lr <= 1 && lg >= 0 && lg <= 1 && lb >= 0 && lb <= 1;
}

// Binary-search the highest chroma at this (L, H) that stays inside sRGB.
function maxChromaAt(L, H) {
  let lo = 0, hi = 0.45;
  for (let i = 0; i < 18; i++) {
    const mid = (lo + hi) / 2;
    if (inGamut(L, mid, H)) lo = mid;
    else hi = mid;
  }
  return lo;
}

// Convert OKLCH back to an sRGB hex. If the requested chroma is outside
// gamut at this (L, H), reduce chroma toward the gamut boundary (preserving
// L and H — chroma is the dimension we're willing to compromise).
export function hexFromOklch(L, C, H) {
  let chroma = Math.max(0, C);
  if (!inGamut(L, chroma, H)) {
    chroma = maxChromaAt(L, H);
  }
  const hRad = H * Math.PI / 180;
  const a = chroma * Math.cos(hRad);
  const b = chroma * Math.sin(hRad);
  return linearRgbToHex(oklabToLinearRgb([L, a, b]).map(v => clamp(v, 0, 1)));
}

function linearRgbToHex([lr, lg, lb]) {
  const to = v => {
    const s = linearToSrgb(clamp(v, 0, 1));
    return Math.round(s * 255).toString(16).padStart(2, '0');
  };
  return `#${to(lr)}${to(lg)}${to(lb)}`.toUpperCase();
}

// --- Seeded PRNG --------------------------------------------------------

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// --- Grid generation ----------------------------------------------------

// Step sizes are target perceptual offsets per unit of the balanced offset
// pool (e.g., {-2, -1, +1, +2} for a 4-cell axis). STEP_L ≈ 0.035 in OKLab
// L is roughly a 3.5-ΔE difference — close enough to demand careful looking
// but far enough that no two neighbors are visually identical.
const STEP_L = 0.035;
const STEP_C = 0.020;
const STEP_H = 8;

// Per-round jitter on each step (±20%) so consecutive rounds don't reuse
// the exact same gradient magnitude.
const JITTER_LO = 0.8;
const JITTER_HI = 1.2;

// Neutrals (chroma below this) skip the chroma/hue sweep entirely and
// vary lightness on both axes instead.
const NEUTRAL_CHROMA_THRESHOLD = 0.03;
const NEUTRAL_STEP_L_ROW = 0.05;
const NEUTRAL_STEP_L_COL = 0.025;

// Lightness bounds (avoid pure black / pure white clipping).
const L_MIN = 0.05;
const L_MAX = 0.95;

// Choose a set of signed magnitudes for `n` cells along an axis, with one
// reserved for the correct cell (offset 0). The magnitudes are returned as
// integer multipliers; the caller multiplies by the step size.
//
// When both directions have enough headroom for two step units, use the
// balanced pool {-2, -1, +1, +2} and drop one at random — the correct cell
// then sits at rank 2 or 3 out of 4 (always mid-spread, never an extreme).
//
// When one direction is starved (e.g. base lightness near 1.0 leaves no
// room to go lighter), flip to a one-sided pool so all (n-1) distractors
// step into the available direction. The correct cell becomes an extreme
// in that case, but we'd otherwise be forced to collapse cells onto each
// other — and these edge canonicals are rare.
function pickOffsetMultipliers(rng, n, upRoom, downRoom) {
  const canUp2 = upRoom >= 2;
  const canDown2 = downRoom >= 2;
  let pool;
  if (canUp2 && canDown2) {
    pool = [-2, -1, +1, +2];
  } else if (upRoom < 1 && downRoom >= n - 1) {
    pool = [];
    for (let i = 1; i <= n - 1; i++) pool.push(-i);
  } else if (downRoom < 1 && upRoom >= n - 1) {
    pool = [];
    for (let i = 1; i <= n - 1; i++) pool.push(+i);
  } else if (upRoom < 2 && downRoom >= 3) {
    pool = [-3, -2, -1, +1];
  } else if (downRoom < 2 && upRoom >= 3) {
    pool = [-1, +1, +2, +3];
  } else {
    pool = [-2, -1, +1, +2];
  }

  while (pool.length > n - 1) {
    pool.splice(Math.floor(rng() * pool.length), 1);
  }
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool;
}

function assignOffsets(rng, n, correctIdx, step, upRoom, downRoom) {
  const mults = pickOffsetMultipliers(rng, n, upRoom, downRoom);
  const offsets = new Array(n);
  let p = 0;
  for (let i = 0; i < n; i++) {
    offsets[i] = i === correctIdx ? 0 : mults[p++] * step;
  }
  return offsets;
}

function jitter(rng, base) {
  return base * (JITTER_LO + rng() * (JITTER_HI - JITTER_LO));
}

export function buildGrid(
  correctHex,
  {
    rows = 4,
    cols = 4,
    seed = 0,
    correctRow: forcedRow = null,
    correctCol: forcedCol = null,
  } = {},
) {
  const base = oklchFromHex(correctHex);
  const rng = mulberry32(seed * 2654435761 + 17);
  const correctRow = Number.isInteger(forcedRow) && forcedRow >= 0 && forcedRow < rows
    ? forcedRow
    : Math.floor(rng() * rows);
  const correctCol = Number.isInteger(forcedCol) && forcedCol >= 0 && forcedCol < cols
    ? forcedCol
    : Math.floor(rng() * cols);

  const isNeutral = base.C < NEUTRAL_CHROMA_THRESHOLD;

  // Row offsets vary lightness. Headroom is symmetric distance to the
  // L_MIN / L_MAX clamps, measured in step units.
  const stepL = jitter(rng, isNeutral ? NEUTRAL_STEP_L_ROW : STEP_L);
  const lUpRoom = (L_MAX - base.L) / stepL;
  const lDownRoom = (base.L - L_MIN) / stepL;
  const rowDeltaL = assignOffsets(rng, rows, correctRow, stepL, lUpRoom, lDownRoom);

  let colDeltaL = null;
  let colDeltaC = null;
  let colDeltaH = null;
  if (isNeutral) {
    const stepLcol = jitter(rng, NEUTRAL_STEP_L_COL);
    // Column lightness uses the row-side headroom too — the combined
    // (row + col) shift must fit. Subtract the worst-case row shift.
    const rowMax = Math.max(...rowDeltaL.map(Math.abs));
    const upRoomCol = Math.max(0, (L_MAX - base.L - rowMax) / stepLcol);
    const downRoomCol = Math.max(0, (base.L - L_MIN - rowMax) / stepLcol);
    colDeltaL = assignOffsets(rng, cols, correctCol, stepLcol, upRoomCol, downRoomCol);
  } else {
    const stepC = jitter(rng, STEP_C);
    const stepH = jitter(rng, STEP_H);
    // Chroma headroom: down is base.C (can't go below zero), up is room
    // to the gamut boundary at base.L (approximate — actual gamut varies
    // by L, but hexFromOklch will clamp anything that overshoots).
    const cMax = maxChromaAt(base.L, base.H);
    const cUpRoom = Math.max(0, (cMax - base.C) / stepC);
    const cDownRoom = base.C / stepC;
    colDeltaC = assignOffsets(rng, cols, correctCol, stepC, cUpRoom, cDownRoom);
    // Hue can always go either way (no clamp).
    colDeltaH = assignOffsets(rng, cols, correctCol, stepH, 4, 4);
  }

  const cells = [];
  for (let r = 0; r < rows; r++) {
    const row = [];
    for (let c = 0; c < cols; c++) {
      if (r === correctRow && c === correctCol) {
        row.push({ row: r, col: c, hex: correctHex.toUpperCase(), isCorrect: true });
        continue;
      }
      let L, C, H;
      if (isNeutral) {
        L = clamp(base.L + rowDeltaL[r] + colDeltaL[c], L_MIN, L_MAX);
        C = 0;
        H = 0;
      } else {
        L = clamp(base.L + rowDeltaL[r], L_MIN, L_MAX);
        C = Math.max(0, base.C + colDeltaC[c]);
        H = base.H + colDeltaH[c];
      }
      row.push({
        row: r,
        col: c,
        hex: hexFromOklch(L, C, H),
        isCorrect: false,
      });
    }
    cells.push(row);
  }

  return { cells, correctRow, correctCol, rows, cols };
}
