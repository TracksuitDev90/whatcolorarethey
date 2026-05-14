// Quad-mode board: four visually distinct color swatches, one of which is
// the correct color. Distractors come from a curated cartoon palette. To
// keep the round from being too easy, one distractor is a "plausible near
// miss" (e.g. red for a pink correct) and the other two are pulled from
// further around the hue wheel — but every swatch must still read as a
// different tone family, so the player never sees two pinks or two blues.

import { hexToHsl, hslToHex } from './grid.js';

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
  // Brock's vest is green — pair it with the other primary cartoon hues
  // (blue, orange, red) so the player picks between four canonical colors
  // and never sees gray as an option.
  'brock-vest': [
    '#88C038', // Brock vest green (correct)
    '#4A90D9', // blue
    '#F39C12', // orange
    '#E63946', // red
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
export function distinctTone(a, b) {
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

// Default-palette gray is intentionally rare. It's still in the rotation so
// the occasional gray-tinged distractor turns up, but most rounds drop it
// before scoring so the typical board reads as four chromatic colors.
const RARE_HEX = '#9B9B9B';
const RARE_KEEP_CHANCE = 0.2;

// Same-family "near miss" tuning. The plausible distractor is synthesized
// from the correct color by keeping its hue and shoving its lightness far
// enough that it reads as "clearly a different shade of the same color"
// rather than "almost the right shade". Lower bound prevents a flat tonal
// duplicate; upper bound prevents the swatch from collapsing into pure
// white/black for mid-saturation hues.
const SHADE_SHIFT_MIN = 28;
const SHADE_SHIFT_MAX = 42;
// How close a candidate's hue must be to share a "family" with the correct
// color for the synthesized-shade purposes. Wider than HUE_GAP_MIN so two
// adjacent hues (e.g. red ↔ pink, yellow ↔ orange) are treated as
// potentially-too-close and benefit from the shade-shift behaviour.
const SAME_FAMILY_HUE = 35;

// Build a same-family but clearly-different-shade distractor by keeping the
// correct hue and shoving lightness toward whichever extreme has more room.
// Saturation jitters slightly so the synthesized swatch doesn't feel like a
// mathematical mirror of the correct cell. Neutral correct colors (white,
// black, gray) skip this — there is no chromatic family to anchor to.
function synthesizeShadeShifted(correctHsl, rng) {
  if (correctHsl.s < 12) return null;
  const upRoom = 92 - correctHsl.l;
  const downRoom = correctHsl.l - 10;
  let direction;
  if (upRoom < 18) direction = -1;
  else if (downRoom < 18) direction = 1;
  else direction = rng() < 0.5 ? -1 : 1;
  const shift = SHADE_SHIFT_MIN + rng() * (SHADE_SHIFT_MAX - SHADE_SHIFT_MIN);
  const newL = Math.max(10, Math.min(92, correctHsl.l + direction * shift));
  const newS = Math.max(20, Math.min(100, correctHsl.s - 8 + rng() * 16));
  return { h: correctHsl.h, s: newS, l: newL };
}

export function buildQuad(correctHex, { seed = 0, palette, correctIndex: forcedIndex = null } = {}) {
  const correct = hexToHsl(correctHex);
  const rng = mulberry32(seed * 2654435761 + 31);

  // Themed palettes (e.g. Power Rangers) constrain distractors to a small
  // set of canonical colors. Fall back to the general cartoon palette if the
  // named palette doesn't exist. `isThemed` is captured BEFORE the gray-strip
  // step because that step returns a new filtered array — comparing against
  // QUAD_PALETTE by reference after the strip would mis-classify the default
  // palette as a themed one and skip the distinctTone filter.
  const requestedPalette = (typeof palette === 'string' ? PALETTES[palette] : palette);
  const isThemed = !!requestedPalette;
  let source = requestedPalette || QUAD_PALETTE;

  // Gray rarely belongs alongside the saturated cartoon hues the game centres
  // on. Strip it from the default palette most rounds — the dice roll lives
  // off the seeded rng so the decision is stable per round.
  if (!isThemed && rng() > RARE_KEEP_CHANCE) {
    source = source.filter(hex => hex.toUpperCase() !== RARE_HEX);
  }
  // The general palette spans the hue wheel and includes near-shades the
  // distinctTone filter is meant to weed out. Themed palettes are already
  // hand-curated to be visually distinct (every Power Ranger color is canon),
  // so skipping the filter ensures plausible options like Red + Pink can both
  // appear on the board.

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

  // Plausible "near miss". For themed palettes we still pick the closest
  // canonical color (Pink Ranger when the answer is Red Ranger, etc.). For
  // the general palette we synthesize a same-hue but clearly different-
  // lightness swatch instead — that produces a "light/dark version of the
  // same color" distractor without ever being only a few shades off.
  if (isThemed) {
    const closeBucket = ranked.slice(0, 3);
    shuffle(closeBucket, rng);
    if (closeBucket.length) chosen.push(closeBucket[0]);
  } else {
    const shifted = synthesizeShadeShifted(correct, rng);
    if (shifted) {
      chosen.push({
        hex: hslToHex(shifted.h, shifted.s, shifted.l).toUpperCase(),
        hsl: shifted,
      });
    } else if (ranked.length) {
      // Neutral correct: there is no chromatic family to shade-shift, so
      // fall back to the closest distinct palette pick the way themed
      // palettes do.
      const closeBucket = ranked.slice(0, 3);
      shuffle(closeBucket, rng);
      chosen.push(closeBucket[0]);
    }
  }

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

  // Callers (the daily game) pass in a deterministic index that walks around
  // the four positions each round so the same item on a later day lands on
  // a different swatch. Fall back to a seeded pick when not provided.
  const correctIndex = Number.isInteger(forcedIndex) && forcedIndex >= 0 && forcedIndex < BOX_COUNT
    ? forcedIndex
    : Math.floor(rng() * BOX_COUNT);
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
