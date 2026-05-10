// Quad-mode board: four visually distinct color swatches, one of which is
// the correct color. Distractors come from a curated cartoon palette. To
// keep the round from being too easy, one distractor is a "plausible near
// miss" (e.g. red for a pink correct) and the other two are pulled from
// further around the hue wheel — but every swatch must still read as a
// different tone family, so the player never sees two pinks or two blues.

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

// Themed palettes restrict distractors to colors that "make sense" in the
// universe of the answer — e.g. for Power Rangers items, only the canonical
// suit colors should appear so distractors never include a fuchsia or teal
// that no ranger ever wore. Same idea for Powerpuff Girls items: distractors
// come from the trio's canonical color scheme so the player chooses between
// "is this Blossom's red, Bubbles' blue, or Buttercup's green?" rather than
// hunting through a generic rainbow.
const PALETTES = {
  // Mighty Morphin suit colors. Blue, green, and black are the exact hex
  // values of the matching Ranger items in items.json so the correct swatch
  // and the palette agree pixel-for-pixel; the rest are widely-cited fan refs
  // for the other six suits.
  'power-rangers': [
    '#C8102E', // red ranger
    '#FFCD00', // yellow ranger
    '#0B0C0D', // black ranger
    '#0A71C1', // blue ranger
    '#2C8335', // green ranger
    '#FFFFFF', // white ranger
    '#F46DB7', // pink ranger
  ],
  'powerpuff': [
    '#E63946', // Blossom red bow
    '#4A90D9', // Bubbles blue
    '#2ECC71', // Buttercup green
    '#F371AC', // Powerpuff dress pink
  ],
};

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

// Distance score used to rank candidates. Hue still dominates, but
// saturation mismatch matters too — without that weight, white and gray
// (s = 0, h = 0) read as "close" to a saturated pink at h ≈ 330 simply
// because of the hue wraparound, and could leak into the plausible slot.
function colorDistance(a, b) {
  const hd = hueDistance(a.h, b.h) / 180;        // 0..1
  const ld = Math.abs(a.l - b.l) / 100;          // 0..1
  const sd = Math.abs(a.s - b.s) / 100;          // 0..1
  return hd * 0.5 + ld * 0.2 + sd * 0.4;
}

// Two colors register as the same tone family when their hue is too close
// (think two pinks or two blues sitting next to each other). Neutrals
// (white/gray/black) collapse to the same hue at h=0, so for those we use
// lightness to tell them apart. A neutral paired with a chromatic color
// always reads as different tones.
const HUE_GAP_MIN = 25;
const NEUTRAL_SAT = 15;
const NEUTRAL_LIGHT_GAP = 18;
function distinctTone(a, b) {
  const aNeutral = a.s < NEUTRAL_SAT;
  const bNeutral = b.s < NEUTRAL_SAT;
  if (aNeutral && bNeutral) {
    return Math.abs(a.l - b.l) > NEUTRAL_LIGHT_GAP;
  }
  if (aNeutral !== bNeutral) return true;
  return hueDistance(a.h, b.h) >= HUE_GAP_MIN;
}

function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

export function buildQuad(correctHex, { seed = 0, palette } = {}) {
  const correct = hexToHsl(correctHex);
  const rng = mulberry32(seed * 2654435761 + 31);

  // Themed palettes (e.g. Power Rangers) constrain distractors to a small
  // set of canonical colors. Fall back to the general cartoon palette if the
  // named palette doesn't exist.
  const source = (typeof palette === 'string' ? PALETTES[palette] : palette)
    || QUAD_PALETTE;
  // The general palette spans the hue wheel and includes near-shades the
  // distinctTone filter is meant to weed out. Themed palettes are already
  // hand-curated to be visually distinct (every Power Ranger color is canon),
  // so skipping the filter ensures plausible options like Red + Pink can both
  // appear on the board.
  const isThemed = source !== QUAD_PALETTE;

  const scored = source
    .filter(hex => hex.toUpperCase() !== correctHex.toUpperCase())
    .map(hex => ({ hex: hex.toUpperCase(), hsl: hexToHsl(hex) }))
    .map(p => ({ ...p, dist: colorDistance(correct, p.hsl) }));

  const chosen = [{ hex: correctHex.toUpperCase(), hsl: correct }];
  const distinctFromChosen = (cand) =>
    isThemed || chosen.every(c => distinctTone(cand.hsl, c.hsl));
  const alreadyPicked = (cand) =>
    chosen.some(c => c.hex === cand.hex);

  // Sort all candidates closest-first, dropping anything that reads as the
  // same tone family as the correct color (so we never offer a near-shade
  // that's effectively "the same color"). Themed palettes skip this filter.
  const ranked = [...scored]
    .sort((a, b) => a.dist - b.dist)
    .filter(c => isThemed || distinctTone(c.hsl, correct));

  // Plausible "near miss": closest distinct candidate. Sample from the top
  // three so the pick varies day to day rather than being identical every
  // round, while staying anchored on genuinely close colors.
  const closeBucket = ranked.slice(0, 3);
  shuffle(closeBucket, rng);
  if (closeBucket.length) chosen.push(closeBucket[0]);

  // Two further-away distractors. Pull from the next slice of the ranked
  // list — colors that are clearly different from correct, but still
  // recognizable cartoon hues a player might consider. Skipping the very
  // tail keeps neutrals like white/gray/black from dominating chromatic
  // rounds (they should appear sometimes, not every time).
  const midBucket = ranked.slice(3, 8);
  shuffle(midBucket, rng);
  for (const cand of midBucket) {
    if (chosen.length >= BOX_COUNT) break;
    if (alreadyPicked(cand)) continue;
    if (distinctFromChosen(cand)) chosen.push(cand);
  }

  // Backstop: if the mid pool was thin (e.g. small palette after filtering),
  // fall back to the rest of the ranked list to fill any remaining slots so
  // the board always has four entries.
  for (const cand of ranked) {
    if (chosen.length >= BOX_COUNT) break;
    if (alreadyPicked(cand)) continue;
    if (distinctFromChosen(cand)) chosen.push(cand);
  }
  for (const cand of ranked) {
    if (chosen.length >= BOX_COUNT) break;
    if (alreadyPicked(cand)) continue;
    chosen.push(cand);
  }

  const correctIndex = Math.floor(rng() * BOX_COUNT);
  const distractors = chosen.slice(1);
  shuffle(distractors, rng);
  const boxes = [];
  let di = 0;
  for (let i = 0; i < BOX_COUNT; i++) {
    if (i === correctIndex) {
      boxes.push({ index: i, hex: correctHex.toUpperCase(), isCorrect: true });
    } else {
      boxes.push({ index: i, hex: distractors[di++].hex, isCorrect: false });
    }
  }

  return { kind: 'quad', boxes, correctIndex, count: BOX_COUNT };
}

export const QUAD_BOX_COUNT = BOX_COUNT;
