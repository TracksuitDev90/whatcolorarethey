// Shade-grid generator. Builds a 4x4 (or arbitrary) board of shades around
// a correct hex color, with the correct cell at a seeded random position.
// Lightness sweeps top-to-bottom; saturation/hue sweep left-to-right —
// matching the reference photo's gradient feel.

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

// Tiny seeded PRNG so each round is reproducible from its index.
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

// Per-step delta ranges. The exact step within each range is rolled per
// round (seeded), so consecutive rounds don't reuse the same gradient.
// Tightened from the previous 11-15 / 5-8 ranges so the surrounding
// shades sit a bit closer to the correct cell — the photo-vs-grid
// comparison should make the player squint, not pick by elimination.
const LIGHT_STEP_MIN = 9;
const LIGHT_STEP_MAX = 12;
const SAT_STEP_MIN = 4;
const SAT_STEP_MAX = 6;
const HUE_STEP_MIN = 4;
const HUE_STEP_MAX = 6;

// Neutral-mode steps. When the correct color is gray/white/black, the
// chromatic sweep barely moves — base.s ≈ 0 leaves nothing to subtract from,
// so distractors come out almost identical to the correct cell. For those
// rounds we widen the lightness sweep and tint distractors instead of
// de-tinting them, so neighbors are clearly distinguishable from the neutral
// correct color.
const NEUTRAL_SAT_THRESHOLD = 14;
const NEUTRAL_LIGHT_STEP_MIN = 14;
const NEUTRAL_LIGHT_STEP_MAX = 18;
const NEUTRAL_TINT_STEP_MIN = 18;
const NEUTRAL_TINT_STEP_MAX = 26;
const NEUTRAL_HUE_STEP_MIN = 35;
const NEUTRAL_HUE_STEP_MAX = 55;

export function buildGrid(
  correctHex,
  { rows = 4, cols = 4, seed = 0, avoidRow = null, avoidCol = null } = {},
) {
  const base = hexToHsl(correctHex);
  const rng = mulberry32(seed * 2654435761 + 17);
  let correctRow = Math.floor(rng() * rows);
  let correctCol = Math.floor(rng() * cols);
  // Force consecutive rounds to use a different cell. If the seed happens
  // to land on the same (row, col) as the previous round, shift it by a
  // seeded offset so the player isn't tapping the same spot twice in a row.
  if (
    avoidRow != null && avoidCol != null
    && correctRow === avoidRow && correctCol === avoidCol
  ) {
    correctRow = (correctRow + 1 + Math.floor(rng() * (rows - 1))) % rows;
    correctCol = (correctCol + 1 + Math.floor(rng() * (cols - 1))) % cols;
  }

  // Randomize gradient orientation + magnitude so the surrounding shades
  // shift each round — sometimes lighter on top, sometimes on the bottom;
  // sometimes a wider hue sweep, sometimes a tight one.
  const lightDir = rng() < 0.5 ? -1 : 1;
  const hueDir = rng() < 0.5 ? -1 : 1;

  const isNeutral = base.s < NEUTRAL_SAT_THRESHOLD;
  const lightStep = isNeutral
    ? NEUTRAL_LIGHT_STEP_MIN + rng() * (NEUTRAL_LIGHT_STEP_MAX - NEUTRAL_LIGHT_STEP_MIN)
    : LIGHT_STEP_MIN + rng() * (LIGHT_STEP_MAX - LIGHT_STEP_MIN);
  const satStep = isNeutral
    ? NEUTRAL_TINT_STEP_MIN + rng() * (NEUTRAL_TINT_STEP_MAX - NEUTRAL_TINT_STEP_MIN)
    : SAT_STEP_MIN + rng() * (SAT_STEP_MAX - SAT_STEP_MIN);
  const hueStep = isNeutral
    ? NEUTRAL_HUE_STEP_MIN + rng() * (NEUTRAL_HUE_STEP_MAX - NEUTRAL_HUE_STEP_MIN)
    : HUE_STEP_MIN + rng() * (HUE_STEP_MAX - HUE_STEP_MIN);

  // For chromatic colors the neighbor sweep anchors on the correct hue so
  // the gradient flows through it. For neutrals the correct cell has no
  // meaningful hue, so we roll a random anchor hue per round (otherwise
  // every neutral round defaults to red-tinted distractors).
  const neighborHueAnchor = isNeutral ? rng() * 360 : base.h;

  // White/black are at the extremes of lightness — same-row neighbors can't
  // sweep above 100 or below 0, which would paint them identical to the
  // correct cell. Pull the neighbor base toward the middle so the gradient
  // can step in either direction.
  let neighborLightAnchor = base.l;
  if (isNeutral) {
    if (neighborLightAnchor > 90) neighborLightAnchor = 90;
    else if (neighborLightAnchor < 10) neighborLightAnchor = 10;
  }
  // For neutrals, force the lightness sweep AWAY from the extreme so the
  // grid uses the full available range no matter where the correct cell
  // sits. Bright neutrals (white, light gray) step darker; dark neutrals
  // (black, dark gray) step lighter. Magnitude depends on distance from
  // correctRow so cells above and below are equally differentiated.
  const neutralLightSign = base.l > 50 ? 1 : -1;

  const cells = [];
  for (let r = 0; r < rows; r++) {
    const row = [];
    for (let c = 0; c < cols; c++) {
      if (r === correctRow && c === correctCol) {
        row.push({ row: r, col: c, hex: correctHex.toUpperCase(), isCorrect: true });
        continue;
      }
      const dRow = r - correctRow;
      const dCol = c - correctCol;
      const l = isNeutral
        ? clamp(neighborLightAnchor - neutralLightSign * Math.abs(dRow) * lightStep, 8, 96)
        : clamp(neighborLightAnchor - lightDir * dRow * lightStep, 8, 96);
      // Chromatic rounds: distractors lose saturation as you move from
      // correct (matching the existing photo-vs-grid feel). Neutral rounds:
      // distractors gain saturation as you move from correct, so the
      // surrounding cells visibly tint away from the gray/white anchor.
      const s = isNeutral
        ? clamp(Math.abs(dCol) * satStep + 8, 5, 90)
        : clamp(base.s - Math.abs(dCol) * satStep, 5, 100);
      const h = neighborHueAnchor + hueDir * dCol * hueStep;
      row.push({
        row: r,
        col: c,
        hex: hslToHex(h, s, l),
        isCorrect: false,
      });
    }
    cells.push(row);
  }

  return { cells, correctRow, correctCol, rows, cols };
}
