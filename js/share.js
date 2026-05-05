// Renders the end-of-day share card to a canvas: one row per round, each
// row a portrait next to N decorative boxes that visually echo the emoji
// share — solid colored squares, dark for unused/skipped, green for a
// correct guess, red for a wrong guess. N varies per row (3 for grid,
// 1 for quad). No name, subtitle, or color swatch — photo + guesses only.

import { maxGuessesFor } from './game.js';

const W = 1080;
const H = 1080;
const PADDING = 60;
const ROW_GAP = 36;

const COL_LABELS = ['A', 'B', 'C', 'D'];

const BOX_COLORS = {
  empty: '#1a1d24',
  emptyStroke: '#2c333f',
  correct: '#3ccb7f',   // 🟩
  wrong: '#e04a4a',     // 🟥
};

const PIXEL_RATIO = Math.max(2, Math.min(3, window.devicePixelRatio || 2));

export async function renderShareCard(snapshot) {
  const canvas = document.createElement('canvas');
  canvas.width = W * PIXEL_RATIO;
  canvas.height = H * PIXEL_RATIO;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.scale(PIXEL_RATIO, PIXEL_RATIO);

  drawBackground(ctx);
  drawHeader(ctx, snapshot);

  const rowsTop = 240;
  const rowsBottom = H - PADDING - 70;
  const rowCount = snapshot.rounds.length;
  const rowH = (rowsBottom - rowsTop - ROW_GAP * (rowCount - 1)) / rowCount;

  for (let i = 0; i < rowCount; i++) {
    const y = rowsTop + i * (rowH + ROW_GAP);
    await drawRow(ctx, snapshot, i, PADDING, y, W - PADDING * 2, rowH);
  }

  drawFooter(ctx);
  return canvas;
}

function drawBackground(ctx) {
  const grd = ctx.createLinearGradient(0, 0, 0, H);
  grd.addColorStop(0, '#1f2530');
  grd.addColorStop(1, '#0e1116');
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, W, H);
}

function drawHeader(ctx, snapshot) {
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#e6ebf2';
  ctx.font = '900 60px "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  ctx.fillText('Color Guesser', PADDING, 60);

  ctx.fillStyle = '#8b95a7';
  ctx.font = '600 28px "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  const wonCount = snapshot.rounds.filter(r => r.won).length;
  const modeLabel = snapshot.mode === 'items' ? 'Items' : 'Characters';
  const summary = `${snapshot.date} · ${modeLabel} · ${wonCount} / ${snapshot.rounds.length}`;
  ctx.fillText(summary, PADDING, 138);
}

function drawFooter(ctx) {
  ctx.fillStyle = '#8b95a7';
  ctx.textBaseline = 'bottom';
  ctx.font = '600 24px "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  ctx.fillText('whatcolorarethey · play today\'s puzzle', PADDING, H - 50);
  ctx.textBaseline = 'top';
}

async function drawRow(ctx, snapshot, i, x, y, w, h) {
  const round = snapshot.rounds[i];
  const character = snapshot.characters[i];
  const max = maxGuessesFor(character);

  const portraitSize = h;
  const portraitX = x;
  const portraitY = y;

  drawPortraitFrame(ctx, portraitX, portraitY, portraitSize);
  await drawPortrait(ctx, character.imageSrc, portraitX, portraitY, portraitSize);

  const rightX = portraitX + portraitSize + 32;
  const rightW = w - portraitSize - 32;

  // Boxes only — no name, subtitle, or swatch pip. Quad rows render a single
  // large box (one guess, win/lose); grid rows render the per-guess sequence.
  const boxGap = 18;
  const slotSize = Math.min(h, (rightW - boxGap * (max - 1)) / max);
  const totalBoxesW = slotSize * max + boxGap * Math.max(0, max - 1);
  const boxesX = rightX + (rightW - totalBoxesW) / 2;
  const boxesY = y + (h - slotSize) / 2;
  for (let b = 0; b < max; b++) {
    const bx = boxesX + b * (slotSize + boxGap);
    drawGuessBox(ctx, round, b, bx, boxesY, slotSize);
  }
}

function drawPortraitFrame(ctx, x, y, size) {
  ctx.save();
  ctx.fillStyle = '#161b22';
  ctx.strokeStyle = '#262d38';
  ctx.lineWidth = 2;
  roundRect(ctx, x, y, size, size, 18);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

async function drawPortrait(ctx, src, x, y, size) {
  try {
    const img = await loadImage(src);
    ctx.save();
    roundRect(ctx, x, y, size, size, 18);
    ctx.clip();
    const ratio = img.width / img.height;
    let dw, dh;
    if (ratio > 1) {
      dh = size;
      dw = size * ratio;
    } else {
      dw = size;
      dh = size / ratio;
    }
    const dx = x + (size - dw) / 2;
    const dy = y + (size - dh) / 2;
    ctx.drawImage(img, dx, dy, dw, dh);
    ctx.restore();
  } catch {
    // Frame stays empty on failure.
  }
}

function drawGuessBox(ctx, round, idx, x, y, size) {
  const guess = round.guesses[idx];
  const radius = 16;
  ctx.save();
  if (!guess) {
    // Empty slot (or a skipped round): solid dark square mirroring ⬛.
    ctx.fillStyle = BOX_COLORS.empty;
    ctx.strokeStyle = BOX_COLORS.emptyStroke;
    ctx.lineWidth = 2;
    roundRect(ctx, x, y, size, size, radius);
    ctx.fill();
    ctx.stroke();
  } else if (guess.correct) {
    drawSolidBox(ctx, x, y, size, radius, BOX_COLORS.correct);
  } else {
    drawSolidBox(ctx, x, y, size, radius, BOX_COLORS.wrong);
  }
  drawBoxLabel(ctx, guess, x, y, size);
  ctx.restore();
}

function drawSolidBox(ctx, x, y, size, radius, fill) {
  ctx.fillStyle = fill;
  roundRect(ctx, x, y, size, size, radius);
  ctx.fill();
  // Subtle inner highlight so the boxes feel "filled" rather than flat.
  ctx.save();
  ctx.globalAlpha = 0.18;
  const grd = ctx.createLinearGradient(x, y, x, y + size);
  grd.addColorStop(0, '#ffffff');
  grd.addColorStop(0.6, 'rgba(255,255,255,0)');
  ctx.fillStyle = grd;
  roundRect(ctx, x, y, size, size, radius);
  ctx.fill();
  ctx.restore();
}

function drawBoxLabel(ctx, guess, x, y, size) {
  if (!guess) return;
  // Grid guesses get the cell coordinate (A1, B3); quad guesses don't.
  if (!Number.isInteger(guess.col) || !Number.isInteger(guess.row)) return;
  ctx.fillStyle = guess.correct ? 'rgba(6,36,32,0.85)' : 'rgba(255,240,240,0.92)';
  ctx.textBaseline = 'top';
  ctx.font = '800 20px "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  const tag = `${COL_LABELS[guess.col] ?? '?'}${guess.row + 1}`;
  ctx.fillText(tag, x + 10, y + 8);
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

export async function shareCanvas(canvas, snapshot) {
  const blob = await new Promise(res => canvas.toBlob(res, 'image/png'));
  if (!blob) throw new Error('Could not encode share image');
  const filename = `colorguesser-${snapshot.date}.png`;

  if (navigator.canShare) {
    try {
      const file = new File([blob], filename, { type: 'image/png' });
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: 'Color Guesser',
          text: shareText(snapshot),
        });
        return { kind: 'shared' };
      }
    } catch (err) {
      if (err?.name === 'AbortError') return { kind: 'cancelled' };
      // fall through to download
    }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return { kind: 'downloaded' };
}

// Emoji-only share — black box default, green for correct, red for wrong.
// Matches the user-spec "Color Guesser" header and one line per character.
export function shareText(snapshot) {
  const lines = snapshot.rounds.map((r, i) => {
    const c = snapshot.characters[i];
    const max = maxGuessesFor(c);
    const cells = Array.from({ length: max }, (_, k) => {
      const g = r.guesses[k];
      if (!g) return '⬛';
      return g.correct ? '🟩' : '🟥';
    }).join('');
    return `${c.name}: ${cells}`;
  });
  return ['Color Guesser', '', ...lines].join('\n');
}

// Build a shareable URL that encodes today's results into a query param.
// The receiving page detects ?s= and renders a read-only share view.
export function shareLinkUrl(snapshot) {
  const payload = {
    d: snapshot.date,
    m: snapshot.mode,
    c: snapshot.characters.map(c => c.id),
    r: snapshot.rounds.map(r => ({
      g: r.guesses.map(g => ({
        c: g.correct ? 1 : 0,
        ...(Number.isInteger(g.row) ? { r: g.row, x: g.col } : {}),
        ...(Number.isInteger(g.index) ? { i: g.index } : {}),
      })),
      w: r.won ? 1 : 0,
      l: r.lost ? 1 : 0,
      s: r.skipped ? 1 : 0,
    })),
  };
  const json = JSON.stringify(payload);
  const b64 = btoa(unescape(encodeURIComponent(json)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  const url = new URL(window.location.href);
  // Drop any existing query so we control the params; keep just `s`.
  url.search = '';
  url.searchParams.set('s', b64);
  url.hash = '';
  return url.toString();
}

export function decodeSharePayload(s) {
  try {
    const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
    const pad = b64.length % 4 ? '='.repeat(4 - (b64.length % 4)) : '';
    const json = decodeURIComponent(escape(atob(b64 + pad)));
    return JSON.parse(json);
  } catch {
    return null;
  }
}

// Build a synthetic snapshot from a decoded share payload + the loaded
// character list. Used by the read-only share view.
export function snapshotFromPayload(payload, allCharacters) {
  const byId = new Map(allCharacters.map(c => [c.id, c]));
  const characters = payload.c.map(id => byId.get(id)).filter(Boolean);
  if (characters.length !== payload.c.length) return null;
  const rounds = payload.r.map((r, i) => ({
    charId: characters[i].id,
    guesses: (r.g || []).map(g => ({
      correct: !!g.c,
      ...(Number.isInteger(g.r) ? { row: g.r, col: g.x } : {}),
      ...(Number.isInteger(g.i) ? { index: g.i } : {}),
    })),
    won: !!r.w,
    lost: !!r.l,
    skipped: !!r.s,
  }));
  return {
    date: payload.d,
    mode: payload.m || 'grid',
    characters,
    character: characters[0],
    rounds,
    roundIndex: rounds.length - 1,
    totalRounds: rounds.length,
    streak: 0,
    bestStreak: 0,
    finished: true,
    revealed: true,
  };
}
