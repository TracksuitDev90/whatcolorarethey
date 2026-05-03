// Quad-mode board: four visually distinct color swatches, one of which is
// the correct color. Distractors are picked from a curated cartoon palette,
// scored by HSL distance from the correct color so the wrong options are
// far in hue or lightness — never a near-shade like the grid version.

import { hexToHsl } from './grid.js';

// Saturated, recognizable cartoon colors spread around the hue wheel,
// plus neutrals. Three distractors are picked from this list per round.
const QUAD_PALETTE = [
  '#E63946', // red
  '#F39C12', // orange
  '#F4D03F', // yellow
  '#6FB04A', // green
  '#2A9D8F', // teal
  '#4A90D9', // blue
  '#5B5BB8', // indigo
  '#8B5FBF', // purple
  '#E63B97', // magenta
  '#FF8FB3', // pink
  '#7B4F2C', // brown
  '#1A1A1A', // black
  '#FFFFFF', // white
  '#9B9B9B', // gray
];

const BOX_COUNT = 4;

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

function hueDistance(a, b) {
  const d = Math.abs(a - b) % 360;
  return Math.min(d, 360 - d);
}

// Hue dominates the score, with lightness as a tiebreaker so neutrals
// (black/white/gray) compete with chromatic colors fairly.
function colorDistance(a, b) {
  const hd = hueDistance(a.h, b.h) / 180;        // 0..1
  const ld = Math.abs(a.l - b.l) / 100;          // 0..1
  const sd = Math.abs(a.s - b.s) / 100;          // 0..1
  return hd * 0.7 + ld * 0.25 + sd * 0.05;
}

export function buildQuad(correctHex, { seed = 0 } = {}) {
  const correct = hexToHsl(correctHex);
  const rng = mulberry32(seed * 2654435761 + 31);

  // Score every palette color, sort most-different first.
  const scored = QUAD_PALETTE
    .filter(hex => hex.toUpperCase() !== correctHex.toUpperCase())
    .map(hex => ({ hex, hsl: hexToHsl(hex) }))
    .map(p => ({ ...p, dist: colorDistance(correct, p.hsl) }))
    .sort((a, b) => b.dist - a.dist);

  // Take the top half of the candidates and shuffle — that way the picks
  // are always far from correct, but vary day-to-day rather than always
  // being the same three "most opposite" colors.
  const pool = scored.slice(0, Math.max(6, Math.ceil(scored.length / 2)));
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }

  // Greedy pick: each distractor must also be visually distinct from the
  // distractors already chosen, so the four boxes never look like a pair.
  const distractors = [];
  const MIN_SIBLING_DIST = 0.22;
  for (const cand of pool) {
    if (distractors.length >= BOX_COUNT - 1) break;
    const tooClose = distractors.some(d =>
      colorDistance(cand.hsl, hexToHsl(d)) < MIN_SIBLING_DIST
    );
    if (!tooClose) distractors.push(cand.hex);
  }
  // Backstop: if the diversity filter starved us, fill from the remaining
  // pool in order. Means occasionally two distractors land closer together,
  // but the game never crashes on an oddly-positioned correct color.
  for (const cand of pool) {
    if (distractors.length >= BOX_COUNT - 1) break;
    if (!distractors.includes(cand.hex)) distractors.push(cand.hex);
  }

  const correctIndex = Math.floor(rng() * BOX_COUNT);
  const boxes = [];
  let di = 0;
  for (let i = 0; i < BOX_COUNT; i++) {
    if (i === correctIndex) {
      boxes.push({ index: i, hex: correctHex.toUpperCase(), isCorrect: true });
    } else {
      boxes.push({ index: i, hex: distractors[di++].toUpperCase(), isCorrect: false });
    }
  }

  return { kind: 'quad', boxes, correctIndex, count: BOX_COUNT };
}

export const QUAD_BOX_COUNT = BOX_COUNT;
