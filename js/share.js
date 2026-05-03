// Renders the end-of-day share card to a canvas: one row per character,
// each row a portrait next to three boxes — X for wrong guesses, ✓ for
// the winning guess, dimmed for unused slots.

const W = 1080;
const H = 1080;
const PADDING = 60;
const ROW_GAP = 36;

const COL_LABELS = ['A', 'B', 'C', 'D', 'E'];
const MAX_GUESSES = 3;

// Render at 2x backing resolution so the share image stays crisp on
// retina screens and after social-network re-encoding.
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

  const rowsTop = 230;
  const rowsBottom = H - PADDING - 70;
  const rowCount = snapshot.rounds.length;
  const rowH = (rowsBottom - rowsTop - ROW_GAP * (rowCount - 1)) / rowCount;

  for (let i = 0; i < rowCount; i++) {
    const y = rowsTop + i * (rowH + ROW_GAP);
    await drawRow(ctx, snapshot, i, PADDING, y, W - PADDING * 2, rowH);
  }

  drawFooter(ctx, snapshot);
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
  ctx.fillText('What Color Are They?', PADDING, 60);

  ctx.fillStyle = '#8b95a7';
  ctx.font = '600 28px "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  const wonCount = snapshot.rounds.filter(r => r.won).length;
  const summary = `Daily ${snapshot.date} · ${wonCount} / ${snapshot.rounds.length}`;
  ctx.fillText(summary, PADDING, 132);
}

function drawFooter(ctx, snapshot) {
  ctx.fillStyle = '#8b95a7';
  ctx.textBaseline = 'bottom';
  ctx.font = '600 24px "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  ctx.fillText('whatcolorarethey · play today\'s puzzle', PADDING, H - 50);
  ctx.textBaseline = 'top';
}

async function drawRow(ctx, snapshot, i, x, y, w, h) {
  const round = snapshot.rounds[i];
  const character = snapshot.characters[i];

  const portraitSize = h;
  const portraitX = x;
  const portraitY = y;

  drawPortraitFrame(ctx, portraitX, portraitY, portraitSize);
  await drawPortrait(ctx, character.imageSrc, portraitX, portraitY, portraitSize);
  drawSwatchPip(ctx, character, portraitX + portraitSize - 36, portraitY + portraitSize - 36);

  const rightX = portraitX + portraitSize + 32;
  const rightW = w - portraitSize - 32;

  ctx.fillStyle = '#e6ebf2';
  ctx.font = '900 34px "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  ctx.textBaseline = 'top';
  ctx.fillText(truncate(ctx, character.name, rightW), rightX, y + 6);

  const subtitle = roundLabel(round);
  ctx.fillStyle = '#8b95a7';
  ctx.font = '600 24px "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  ctx.fillText(subtitle, rightX, y + 52);

  const boxGap = 18;
  const boxSize = Math.min(120, (rightW - boxGap * (MAX_GUESSES - 1)) / MAX_GUESSES);
  const boxesY = y + h - boxSize;
  for (let b = 0; b < MAX_GUESSES; b++) {
    const bx = rightX + b * (boxSize + boxGap);
    drawGuessBox(ctx, round, b, bx, boxesY, boxSize);
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
    // object-fit: cover behavior
    const ratio = img.width / img.height;
    let dw = size, dh = size;
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
    // Fall back to initials rendered onto the frame.
  }
}

function drawSwatchPip(ctx, character, cx, cy) {
  ctx.save();
  ctx.fillStyle = character.color.hex;
  ctx.strokeStyle = '#0e1116';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(cx, cy, 22, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawGuessBox(ctx, round, idx, x, y, size) {
  const guess = round.guesses[idx];
  const radius = 14;
  ctx.save();
  if (!guess) {
    ctx.fillStyle = '#1f2530';
    ctx.strokeStyle = '#262d38';
    ctx.lineWidth = 2;
    roundRect(ctx, x, y, size, size, radius);
    ctx.fill();
    ctx.stroke();
  } else if (guess.correct) {
    ctx.fillStyle = '#4dd9c0';
    roundRect(ctx, x, y, size, size, radius);
    ctx.fill();
    drawGlyph(ctx, '✓', x + size / 2, y + size / 2, size, '#062420');
  } else {
    ctx.fillStyle = '#2a313d';
    ctx.strokeStyle = '#3a4456';
    ctx.lineWidth = 2;
    roundRect(ctx, x, y, size, size, radius);
    ctx.fill();
    ctx.stroke();
    drawX(ctx, x, y, size);
  }
  drawBoxLabel(ctx, guess, x, y, size);
  ctx.restore();
}

function drawBoxLabel(ctx, guess, x, y, size) {
  if (!guess) return;
  ctx.fillStyle = guess.correct ? 'rgba(6,36,32,0.85)' : 'rgba(180,190,206,0.95)';
  ctx.textBaseline = 'top';
  ctx.font = '800 20px "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  const tag = `${COL_LABELS[guess.col] ?? '?'}${guess.row + 1}`;
  ctx.fillText(tag, x + 10, y + 8);
}

function drawGlyph(ctx, ch, cx, cy, size, color) {
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `900 ${Math.round(size * 0.55)}px "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
  ctx.fillText(ch, cx, cy + 2);
  ctx.textAlign = 'start';
}

function drawX(ctx, x, y, size) {
  const pad = size * 0.28;
  ctx.strokeStyle = '#ff7a8a';
  ctx.lineWidth = Math.max(4, size * 0.06);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x + pad, y + pad);
  ctx.lineTo(x + size - pad, y + size - pad);
  ctx.moveTo(x + size - pad, y + pad);
  ctx.lineTo(x + pad, y + size - pad);
  ctx.stroke();
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

function truncate(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  const ell = '…';
  let lo = 0, hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (ctx.measureText(text.slice(0, mid) + ell).width <= maxWidth) lo = mid + 1;
    else hi = mid;
  }
  return text.slice(0, Math.max(0, lo - 1)) + ell;
}

function roundLabel(round) {
  if (round.won) {
    const n = round.guesses.length;
    return `Solved in ${n} ${n === 1 ? 'guess' : 'guesses'}`;
  }
  if (round.lost) return 'Out of guesses';
  if (round.guesses.length === 0) return 'Not played';
  const left = MAX_GUESSES - round.guesses.length;
  return `${left} guess${left === 1 ? '' : 'es'} left`;
}

export async function shareCanvas(canvas, snapshot) {
  const blob = await new Promise(res => canvas.toBlob(res, 'image/png'));
  if (!blob) throw new Error('Could not encode share image');
  const filename = `whatcolorarethey-${snapshot.date}.png`;

  if (navigator.canShare) {
    try {
      const file = new File([blob], filename, { type: 'image/png' });
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: 'What Color Are They?',
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

export function shareText(snapshot) {
  const wins = snapshot.rounds.filter(r => r.won).length;
  const total = snapshot.rounds.length;
  const line = snapshot.rounds
    .map(r => {
      if (!r.guesses.length) return '⬜⬜⬜';
      const cells = Array.from({ length: MAX_GUESSES }, (_, i) => {
        const g = r.guesses[i];
        if (!g) return '⬜';
        return g.correct ? '🟩' : '🟥';
      });
      return cells.join('');
    })
    .join('\n');
  return `What Color Are They? ${snapshot.date}\n${wins}/${total}\n\n${line}`;
}
