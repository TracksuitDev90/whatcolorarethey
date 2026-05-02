// Shade-grid generator. Builds a 5x5 (or arbitrary) board of shades around
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
const LIGHT_STEP_MIN = 8;
const LIGHT_STEP_MAX = 12;
const SAT_STEP_MIN = 3;
const SAT_STEP_MAX = 5;
const HUE_STEP_MIN = 3;
const HUE_STEP_MAX = 5;

export function buildGrid(correctHex, { rows = 5, cols = 5, seed = 0 } = {}) {
  const base = hexToHsl(correctHex);
  const rng = mulberry32(seed * 2654435761 + 17);
  const correctRow = Math.floor(rng() * rows);
  const correctCol = Math.floor(rng() * cols);

  // Randomize gradient orientation + magnitude so the surrounding shades
  // shift each round — sometimes lighter on top, sometimes on the bottom;
  // sometimes a wider hue sweep, sometimes a tight one.
  const lightDir = rng() < 0.5 ? -1 : 1;
  const hueDir = rng() < 0.5 ? -1 : 1;
  const lightStep = LIGHT_STEP_MIN + rng() * (LIGHT_STEP_MAX - LIGHT_STEP_MIN);
  const satStep = SAT_STEP_MIN + rng() * (SAT_STEP_MAX - SAT_STEP_MIN);
  const hueStep = HUE_STEP_MIN + rng() * (HUE_STEP_MAX - HUE_STEP_MIN);

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
      const l = clamp(base.l - lightDir * dRow * lightStep, 8, 96);
      const s = clamp(base.s - Math.abs(dCol) * satStep, 5, 100);
      const h = base.h + hueDir * dCol * hueStep;
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
