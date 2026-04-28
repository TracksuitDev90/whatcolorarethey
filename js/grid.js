// Shade-grid generator. Builds a 6x6 (or arbitrary) board of shades around
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

// Per-step deltas. Tuned so the full 6x6 grid spans roughly:
//   lightness ±25, saturation ±8, hue ±6
// — close enough that adjacent cells are distinguishable but the family
// reads as one color (like the reference photo's teal sweep).
const LIGHT_STEP = 5;     // per row away from correct
const SAT_STEP = 1.6;     // per col away from correct
const HUE_STEP = 1.2;     // per col away from correct, applied subtly

export function buildGrid(correctHex, { rows = 6, cols = 6, seed = 0 } = {}) {
  const base = hexToHsl(correctHex);
  const rng = mulberry32(seed * 2654435761 + 17);
  const correctRow = Math.floor(rng() * rows);
  const correctCol = Math.floor(rng() * cols);

  const cells = [];
  for (let r = 0; r < rows; r++) {
    const row = [];
    for (let c = 0; c < cols; c++) {
      if (r === correctRow && c === correctCol) {
        row.push({ row: r, col: c, hex: correctHex.toUpperCase(), isCorrect: true });
        continue;
      }
      const dRow = r - correctRow; // negative = above (lighter), positive = below (darker)
      const dCol = c - correctCol;
      // Lightness gradient: rows above the correct row are lighter, rows below are darker.
      const l = clamp(base.l - dRow * LIGHT_STEP, 8, 96);
      // Saturation drops symmetrically as you move away from the correct column,
      // and hue drifts a touch left/right of base — same family, slight sweep.
      const s = clamp(base.s - Math.abs(dCol) * SAT_STEP, 5, 100);
      const h = base.h + dCol * HUE_STEP;
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
