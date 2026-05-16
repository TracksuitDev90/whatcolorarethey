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

// OKLab is perceptually uniform on average but human vision is hue-anisotropic:
// a 0.035 lightness step on a yellow doesn't read the same as on a deep blue,
// and 8° of hue shift is invisible on a saturated red but reads as "different
// color" on a pale yellow. The JND_TABLE assigns hue-specific step sizes so
// difficulty stays roughly constant across characters. Values are interpolated
// linearly between bins on the OKLCH hue circle.
const JND_TABLE = [
  { h:   0, stepL: 0.035, stepC: 0.022, stepH: 9 },  // red
  { h:  30, stepL: 0.035, stepC: 0.022, stepH: 8 },  // red-orange
  { h:  60, stepL: 0.037, stepC: 0.022, stepH: 7 },  // orange
  { h:  90, stepL: 0.040, stepC: 0.025, stepH: 5 },  // yellow — hue invisible, lean on L+C
  { h: 120, stepL: 0.038, stepC: 0.024, stepH: 6 },  // yellow-green
  { h: 150, stepL: 0.035, stepC: 0.022, stepH: 8 },  // green
  { h: 180, stepL: 0.033, stepC: 0.022, stepH: 9 },  // cyan
  { h: 210, stepL: 0.033, stepC: 0.022, stepH: 9 },  // sky
  { h: 240, stepL: 0.033, stepC: 0.023, stepH: 10 }, // blue
  { h: 270, stepL: 0.033, stepC: 0.022, stepH: 10 }, // violet
  { h: 300, stepL: 0.034, stepC: 0.022, stepH: 9 },  // magenta
  { h: 330, stepL: 0.035, stepC: 0.022, stepH: 9 },  // pink
];

// Per-round jitter on each step (±20%) so consecutive rounds don't reuse
// the exact same gradient magnitude.
const JITTER_LO = 0.8;
const JITTER_HI = 1.2;

// Neutrals (chroma below this) skip the chroma/hue sweep entirely and
// vary lightness on both axes instead. The two step sizes are
// deliberately non-commensurate (ratio ≈ 2.27, not 2.00) so diagonal
// cells don't collapse onto identical combined lightness values.
const NEUTRAL_CHROMA_THRESHOLD = 0.03;
const NEUTRAL_STEP_L_ROW = 0.05;
const NEUTRAL_STEP_L_COL = 0.022;

// Lightness bounds (avoid pure black / pure white clipping).
const L_MIN = 0.05;
const L_MAX = 0.95;

// ΔE invariants enforced on every generated grid. Values are on the
// conventional ΔE scale where ~2 is a just-noticeable difference.
//
// The "correct max" is hue-family aware: for low-chroma or extreme-L
// colors (Ice King, Bugs Bunny), decoys are allowed to be much more
// saturated or much darker than the correct, because the player's task
// reframes as "pick the right shade of blue" rather than "pick the
// exact pale blue." Constraining the ceiling tight for pales just
// collapses the grid into 16 near-identical swatches; opening it lets
// the row axis sweep through the whole blue family.
const DELTA_E_PAIR_MIN = 2.0;
const DELTA_E_CORRECT_MIN = 2.5;
function deltaECorrectMaxFor({ C, L }) {
  // Saturated mid-L colors: tight ceiling — wide spread reads as a
  // different color family. Low-chroma or extreme-L colors: loose
  // ceiling — they need room to spread through their hue family.
  const extremeL = L > 0.85 || L < 0.30;
  if (C < 0.04 || extremeL) return 30.0;
  if (C < 0.09) return 22.0;
  return 16.0;
}
const MAX_ATTEMPTS = 8;
const INFLATE_PER_ATTEMPT = 1.25;

// Linearly interpolate hue-specific JND steps for the given OKLCH base.
// No chroma damping: `assignOffsets` already scales steps to fit available
// chroma headroom, so near-neutrals get the right behavior automatically.
function jndStepsFor({ H }) {
  const hue = ((H % 360) + 360) % 360;
  const bin = 360 / JND_TABLE.length;
  const i = Math.floor(hue / bin);
  const next = (i + 1) % JND_TABLE.length;
  const t = (hue - i * bin) / bin;
  const a = JND_TABLE[i];
  const b = JND_TABLE[next];
  return {
    stepL: a.stepL + (b.stepL - a.stepL) * t,
    stepC: a.stepC + (b.stepC - a.stepC) * t,
    stepH: a.stepH + (b.stepH - a.stepH) * t,
  };
}

// Euclidean distance in OKLab, scaled by 100 to land on the conventional
// ΔE axis (~2 = just noticeable). Used to validate that generated grids
// meet the perceptibility invariants.
function deltaE(hex1, hex2) {
  const [L1, a1, b1] = linearRgbToOklab(hexToLinearRgb(hex1));
  const [L2, a2, b2] = linearRgbToOklab(hexToLinearRgb(hex2));
  const dL = L1 - L2;
  const da = a1 - a2;
  const db = b1 - b2;
  return Math.sqrt(dL * dL + da * da + db * db) * 100;
}

// Inspect the grid against all three ΔE invariants. Reports separately
// whether the ramp is too tight (floor violated: cells too similar) or
// too spread (ceiling violated: a decoy reads as a different color
// family). The retry loop uses this signal to decide whether to inflate
// or deflate the step magnitudes — exponentially climbing in one
// direction would overshoot in the other.
//
// `score` is the total magnitude of violations: smaller is better. Used
// to pick the best-of-attempts grid when no attempt passes cleanly.
function inspectGrid(cells, correctHex, ceilingMax) {
  const flat = cells.flat();
  let floorViolation = 0;
  let ceilingViolation = 0;
  for (let i = 0; i < flat.length; i++) {
    const cell = flat[i];
    if (!cell.isCorrect) {
      const d = deltaE(cell.hex, correctHex);
      if (d < DELTA_E_CORRECT_MIN) {
        floorViolation += DELTA_E_CORRECT_MIN - d;
      }
      if (d > ceilingMax) {
        ceilingViolation += d - ceilingMax;
      }
    }
    for (let j = i + 1; j < flat.length; j++) {
      const d = deltaE(cell.hex, flat[j].hex);
      if (d < DELTA_E_PAIR_MIN) {
        floorViolation += DELTA_E_PAIR_MIN - d;
      }
    }
  }
  return {
    ok: floorViolation === 0 && ceilingViolation === 0,
    floorViolation,
    ceilingViolation,
    score: floorViolation + ceilingViolation,
  };
}

// Choose a sorted set of signed offsets for an axis of `n` cells with the
// correct cell at `correctIdx`. Cells fan out from correct in monotone
// order: rank `i - correctIdx` becomes the offset multiplier, then the
// step is multiplied in. Result reads as a smooth ramp (the original
// "gradient" feel) because the offsets are NOT shuffled.
//
// Two orientations exist — ascending (positive offsets above correctIdx)
// and descending (negative above). Pick whichever fits the available
// headroom best; if neither fits at the full step, shrink the step
// proportionally so the spread fits in the tighter direction.
function assignOffsets(rng, n, correctIdx, baseStep, upRoom, downRoom) {
  const negCount = correctIdx;
  const posCount = n - 1 - correctIdx;
  if (negCount === 0 && posCount === 0) return [0];

  // Effective step multiplier (≤ 1) that fits the direction. Each
  // orientation needs `needUp` units of room above and `needDown` below.
  function fitFor(needUp, needDown) {
    let s = 1;
    if (needUp > 0) s = Math.min(s, upRoom / needUp);
    if (needDown > 0) s = Math.min(s, downRoom / needDown);
    return s;
  }
  const ascFit = fitFor(posCount, negCount);
  const descFit = fitFor(negCount, posCount);

  let flip;
  if (ascFit > descFit + 0.001) flip = false;
  else if (descFit > ascFit + 0.001) flip = true;
  else flip = rng() < 0.5;

  const stepMult = Math.min(1, flip ? descFit : ascFit);
  const step = Math.max(0.003, baseStep * stepMult);

  const offsets = new Array(n);
  for (let i = 0; i < n; i++) {
    const rank = i - correctIdx;
    offsets[i] = (flip ? -rank : rank) * step;
  }
  return offsets;
}

function jitter(rng, base) {
  return base * (JITTER_LO + rng() * (JITTER_HI - JITTER_LO));
}

// Single attempt at building a grid. The retry loop in `buildGrid` calls
// this with increasing `inflate` until the ΔE invariants are met. The
// correct-cell position is fixed by `seed` (NOT mixed with attempt) so
// the player doesn't see the answer jump position between retries on the
// same round.
function generateGridOnce(correctHex, opts, inflate) {
  const { rows, cols, baseSeed, forcedRow, forcedCol, attempt } = opts;
  const base = oklchFromHex(correctHex);
  // Position RNG uses the stable seed; step/jitter RNG mixes in attempt
  // so each retry produces a genuinely different spread.
  const posRng = mulberry32(baseSeed * 2654435761 + 17);
  const stepRng = mulberry32(baseSeed * 2654435761 + 17 + attempt * 0x9E3779B9);

  let correctRow = Number.isInteger(forcedRow) && forcedRow >= 0 && forcedRow < rows
    ? forcedRow
    : Math.floor(posRng() * rows);
  const correctCol = Number.isInteger(forcedCol) && forcedCol >= 0 && forcedCol < cols
    ? forcedCol
    : Math.floor(posRng() * cols);

  // If base.L is at the gamut extreme (pure white, pure black), the
  // symmetric ramp can't fit cells on both sides — there's no upward
  // headroom past L=1.0 or downward past L=0.0. `assignOffsets` would
  // collapse step to its minimum, making every cell collide. Pin the
  // correct cell to whichever edge of the grid lets all decoys live in
  // the available direction. The player still sees a random column.
  if (!Number.isInteger(forcedRow)) {
    if (base.L > 0.97) correctRow = 0;
    else if (base.L < 0.05) correctRow = rows - 1;
  }

  const isNeutral = base.C < NEUTRAL_CHROMA_THRESHOLD;
  // Effective lightness bounds: never tighter than the base color itself.
  // If base.L sits above L_MAX (e.g. pure white) or below L_MIN (e.g.
  // pure black), the fixed clamp would collapse multiple cells onto the
  // same value. Letting the bound extend to base.L preserves cell
  // identity at the extremes.
  const effLMin = Math.min(L_MIN, base.L);
  const effLMax = Math.max(L_MAX, base.L);
  const steps = jndStepsFor(base);

  // For pale or low-chroma colors (Ice King, Bugs Bunny, Jigglypuff),
  // the decoys are allowed to span a much wider slice of the hue family
  // — "other shades of blue" rather than "other near-identical pales."
  // Boost the base row step so the first attempt already produces a
  // visible L spread instead of waiting for the retry loop to inflate.
  let lowChromaBoost = 1.0;
  if (isNeutral) {
    lowChromaBoost = 1.8;
  } else if (base.C < 0.05) {
    lowChromaBoost = 1.8;
  } else if (base.C < 0.08) {
    lowChromaBoost = 1.5;
  } else if (base.C < 0.12) {
    lowChromaBoost = 1.2;
  }

  // Row offsets vary lightness. Headroom is distance to the effective
  // L bounds, measured in step units.
  const baseRowStepL = isNeutral ? NEUTRAL_STEP_L_ROW : steps.stepL;
  const stepL = jitter(stepRng, baseRowStepL * lowChromaBoost) * inflate;
  const lUpRoom = (effLMax - base.L) / stepL;
  const lDownRoom = (base.L - effLMin) / stepL;
  const rowDeltaL = assignOffsets(stepRng, rows, correctRow, stepL, lUpRoom, lDownRoom);

  // Column axis: chroma + hue. For neutrals (base.C ≈ 0) we synthesize a
  // small chroma so the column has a perceptual dimension to walk — the
  // hue gets seeded randomly so two neutrals on the same day don't pick
  // the same tint direction. Without this, the only column variation
  // would be lightness, and `rowDeltaL[r] + colDeltaL[c]` linear sums
  // collide on diagonals (cells coincide on identical L values).
  const SYNTH_C_FOR_NEUTRAL = 0.018;
  const colC = isNeutral ? SYNTH_C_FOR_NEUTRAL : base.C;
  const colH = isNeutral ? posRng() * 360 : base.H;
  const colStepsSrc = isNeutral
    ? { stepC: SYNTH_C_FOR_NEUTRAL * 0.9, stepH: 25 }
    : steps;
  const stepC = jitter(stepRng, colStepsSrc.stepC * lowChromaBoost) * inflate;
  let stepH = jitter(stepRng, colStepsSrc.stepH) * inflate;
  const cMax = maxChromaAt(base.L, colH);
  const cUpRoom = stepC > 0 ? Math.max(0, (cMax - colC) / stepC) : 0;
  const cDownRoom = stepC > 0 ? colC / stepC : 0;
  const colDeltaC = stepC > 0
    ? assignOffsets(stepRng, cols, correctCol, stepC, cUpRoom, cDownRoom)
    : new Array(cols).fill(0);

  // Effective chroma step after gamut compression. If the column axis is
  // gamut-bound (chroma headroom < what stepC asked for), the actual
  // rank-1 chroma delta can fall below the JND. Compensate by widening
  // the hue step — hue has no gamut clamp, and at moderate-to-high
  // chroma a hue offset produces a visible color shift even when chroma
  // can't move further. Cap at 20° to avoid crossing color families.
  const effectiveStepC = colDeltaC.length > 1
    ? Math.abs(colDeltaC[1] - colDeltaC[0])
    : stepC;
  const TARGET_RANK_ONE_DE = DELTA_E_PAIR_MIN / 100;
  const dcEffect = effectiveStepC;
  if (dcEffect < TARGET_RANK_ONE_DE && colC > 0.01) {
    const dhEffectNeeded = Math.sqrt(
      Math.max(0, TARGET_RANK_ONE_DE * TARGET_RANK_ONE_DE - dcEffect * dcEffect)
    );
    const requiredStepH = dhEffectNeeded / (colC * Math.PI / 180);
    if (requiredStepH > stepH) stepH = Math.min(requiredStepH, 20);
  }
  // Hue can always go either way (no clamp).
  const colDeltaH = assignOffsets(stepRng, cols, correctCol, stepH, 4, 4);

  const cells = [];
  for (let r = 0; r < rows; r++) {
    const row = [];
    for (let c = 0; c < cols; c++) {
      if (r === correctRow && c === correctCol) {
        row.push({ row: r, col: c, hex: correctHex.toUpperCase(), isCorrect: true });
        continue;
      }
      const L = clamp(base.L + rowDeltaL[r], effLMin, effLMax);
      const C = Math.max(0, colC + colDeltaC[c]);
      const H = colH + colDeltaH[c];
      row.push({
        row: r,
        col: c,
        L, C, H,
        hex: hexFromOklch(L, C, H),
        isCorrect: false,
      });
    }
    cells.push(row);
  }

  // Final dedup pass: pathological cases (pure white at L=1.0 with zero
  // chroma headroom, etc.) can produce two cells with nearly-identical
  // perceptual color even after the structural fixes — the gamut clamp
  // collapses everything to the same near-white when L is extreme. Walk
  // the cells and nudge L by a small per-cell salt until each cell is
  // perceptibly distinct (>1 ΔE) from every prior cell. The nudges are
  // small (≤ 0.04 L) but guarantee distinguishable swatches — duplicate
  // or near-duplicate cells would break the game outright.
  const SEP_MIN = 1.0;
  const NUDGE_STEP = 0.006;
  const NUDGE_MAX = 0.04;
  const flat = cells.flat();
  // Seed `accepted` with the correct cell up front. Otherwise decoys
  // iterated BEFORE the correct cell in row-major order wouldn't be
  // checked against it — at extreme L (#FFFFFF) those decoys are often
  // also gamut-clipped to pure white, creating duplicates of the answer.
  const correctCell = flat.find(c => c.isCorrect);
  const accepted = correctCell ? [correctCell] : [];
  for (const cell of flat) {
    if (cell === correctCell) {
      delete cell.L; delete cell.C; delete cell.H;
      continue;
    }
    let nudge = 0;
    let attempt = 0;
    const tooClose = () => accepted.some(p => deltaE(p.hex, cell.hex) < SEP_MIN);
    while (tooClose() && nudge <= NUDGE_MAX) {
      attempt++;
      // Walk nudge magnitude outward, alternating direction so the
      // dedup explores both lighter and darker than the original L.
      nudge = Math.ceil(attempt / 2) * NUDGE_STEP;
      const dir = (attempt % 2 === 1) ? -1 : 1;
      const newL = clamp(cell.L + dir * nudge, effLMin, effLMax);
      cell.hex = hexFromOklch(newL, cell.C, cell.H);
    }
    accepted.push(cell);
    delete cell.L;
    delete cell.C;
    delete cell.H;
  }

  return { cells, correctRow, correctCol, rows, cols };
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
  const opts = { rows, cols, baseSeed: seed, forcedRow, forcedCol, attempt: 0 };
  const base = oklchFromHex(correctHex);
  const ceilingMax = deltaECorrectMaxFor(base);
  let inflate = 1.0;
  let best = null;
  let bestScore = Infinity;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    opts.attempt = attempt;
    const grid = generateGridOnce(correctHex, opts, inflate);
    const insp = inspectGrid(grid.cells, correctHex, ceilingMax);
    if (insp.ok) return grid;
    if (insp.score < bestScore) {
      best = grid;
      bestScore = insp.score;
    }
    // Adjust inflate toward whichever bound is more violated. If only the
    // floor is violated → spread cells wider. If only the ceiling →
    // contract. If both, the floor wins (better to over-spread than to
    // have invisible neighbors).
    if (insp.floorViolation > 0 && insp.floorViolation >= insp.ceilingViolation) {
      inflate *= INFLATE_PER_ATTEMPT;
    } else if (insp.ceilingViolation > 0) {
      inflate /= INFLATE_PER_ATTEMPT;
    }
  }
  return best;
}
