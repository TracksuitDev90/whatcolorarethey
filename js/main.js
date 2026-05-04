import { loadCharacters } from './characters.js';
import { createDailyGame } from './game.js';
import {
  getUtcDateKey,
  shuffleCharacters,
  msUntilNextUtcDay,
  formatCountdown,
} from './daily.js';
import { renderShareCard, shareCanvas, shareText } from './share.js';

const COL_LABELS = ['A', 'B', 'C', 'D', 'E'];
const GRID_SIZE = 5;

const els = {
  img: document.getElementById('character-img'),
  name: document.getElementById('character-name'),
  photoFrame: document.getElementById('photo-frame'),
  board: document.getElementById('board'),
  grid: document.getElementById('grid'),
  colHeaders: document.getElementById('col-headers'),
  rowHeaders: document.getElementById('row-headers'),
  quad: document.getElementById('quad'),
  status: document.getElementById('status'),
  next: document.getElementById('next-btn'),
  share: document.getElementById('share-btn'),
  copyResult: document.getElementById('copy-btn'),
  shareSlot: document.getElementById('share-slot'),
  countdown: document.getElementById('countdown'),
  characterCard: document.getElementById('character-card'),
  roundChip: document.getElementById('round-chip'),
  streakChip: document.getElementById('streak-chip'),
  bestChip: document.getElementById('best-chip'),
  guessesChip: document.getElementById('guesses-chip'),
  tabItems: document.getElementById('tab-items'),
  tabGrid: document.getElementById('tab-grid'),
};

// Each tab is a separate experience: items use the 4-swatch quad and
// characters use the 5x5 shade grid. The two games run in parallel; switching
// tabs swaps which one is being played without touching the other's progress.
const games = { items: null, grid: null };
let mode = 'items';
let game;
let dateKey;
let focusRow = 0;
let focusCol = 0;
let countdownTimer = null;
let cachedShareCanvas = null;

init();

async function init() {
  try {
    const chars = await loadCharacters();
    dateKey = getUtcDateKey();
    // Daily cap removed for now — play every character each day. Re-enable
    // by passing a smaller count (e.g. 3) once we ship publicly.
    const itemPool = chars.filter(c => c.type === 'item');
    const gridPool = chars.filter(c => c.type !== 'item');
    games.items = itemPool.length
      ? createDailyGame(shuffleCharacters(itemPool), dateKey)
      : null;
    games.grid = gridPool.length
      ? createDailyGame(shuffleCharacters(gridPool), dateKey)
      : null;
    renderHeaders();
    setMode(games.items ? 'items' : 'grid');
  } catch (err) {
    console.error(err);
    els.status.textContent = `Failed to start: ${err.message}`;
  }
}

function setMode(next) {
  if (next !== 'items' && next !== 'grid') return;
  if (!games[next]) return;
  mode = next;
  game = games[mode];
  els.tabItems.classList.toggle('tab--active', mode === 'items');
  els.tabItems.setAttribute('aria-selected', mode === 'items' ? 'true' : 'false');
  els.tabGrid.classList.toggle('tab--active', mode === 'grid');
  els.tabGrid.setAttribute('aria-selected', mode === 'grid' ? 'true' : 'false');
  hideShareSlot();
  if (game.snapshot().finished) {
    showFinished();
  } else {
    renderRound();
  }
}

// Cheap idle-time prefetch so the next character's photo is in the HTTP
// cache by the time the player taps "Next round".
function prefetchImage(src) {
  if (!src || src.startsWith('data:')) return;
  const img = new Image();
  img.decoding = 'async';
  img.src = src;
}

function renderHeaders() {
  els.colHeaders.innerHTML = COL_LABELS
    .map((l, i) => `<span class="hdr" data-col="${i}">${l}</span>`).join('');
  els.rowHeaders.innerHTML = Array.from({ length: GRID_SIZE }, (_, i) =>
    `<span class="hdr" data-row="${i}">${i + 1}</span>`).join('');
}

function clearHints() {
  for (const h of document.querySelectorAll('.hdr--hint')) {
    h.classList.remove('hdr--hint');
  }
}

function applyAxisHints() {
  const s = game.snapshot();
  if (s.board.kind !== 'grid') return;
  const { correctRow, correctCol } = s.board;
  for (const w of s.wrongGuesses) {
    if (w.row === correctRow) {
      els.rowHeaders
        .querySelector(`.hdr[data-row="${w.row}"]`)
        ?.classList.add('hdr--hint');
    }
    if (w.col === correctCol) {
      els.colHeaders
        .querySelector(`.hdr[data-col="${w.col}"]`)
        ?.classList.add('hdr--hint');
    }
  }
}

function isItemRound(s) {
  return s?.character?.type === 'item';
}

function renderRound() {
  hideShareSlot();
  const s = game.snapshot();
  const c = s.character;
  const round = s.rounds[s.roundIndex];

  els.characterCard.hidden = false;
  // Drop `revealed` before swapping src so the next paint always shows the
  // new image already grayscale — no momentary color flash between rounds.
  els.photoFrame.classList.remove('revealed');
  // Clear any leftover transform/opacity from a swipe-advance.
  els.photoFrame.style.transform = '';
  els.photoFrame.style.opacity = '';
  els.photoFrame.style.transition = '';
  els.img.decoding = 'async';
  els.img.fetchPriority = 'high';
  els.img.src = c.imageSrc;
  els.img.alt = isItemRound(s)
    ? `Scene from ${c.show || c.name} (grayscale until revealed)`
    : `Cartoon character (grayscale until revealed)`;
  // Warm the next character's photo while this one is being played.
  const nextChar = s.characters[s.roundIndex + 1];
  if (nextChar) prefetchImage(nextChar.imageSrc);

  // Title slot doubles as the question for quad rounds (so the player
  // knows which item they're identifying) and as the reveal for both.
  els.name.innerHTML = isItemRound(s) ? promptText(c) : '&nbsp;';

  els.next.hidden = true;
  els.share.hidden = true;
  if (els.copyResult) els.copyResult.hidden = true;
  els.status.textContent = isItemRound(s)
    ? 'Pick the correct color.'
    : 'What color are they? Pick a swatch.';
  clearHints();

  if (s.board.kind === 'quad') {
    renderQuadBoard(s);
  } else {
    renderGridBoard(s);
  }

  // Replay any saved guesses for this round so refreshing mid-puzzle keeps state.
  for (const g of round.guesses) {
    const btn = guessButton(s, g);
    if (!btn) continue;
    btn.classList.add(g.correct ? 'cell--correct' : 'cell--wrong');
  }

  if (s.revealed) {
    revealRound(/*announce*/ false);
  } else if (s.board.kind === 'grid' && s.wrongGuesses.length >= 2) {
    applyAxisHints();
  }

  updateChips();
}

function promptText(c) {
  return `What color is ${c.name}?`;
}

function revealText(c) {
  if (c.type === 'item' && c.show) return `${c.name} — ${c.show}`;
  return c.name;
}

function renderGridBoard(s) {
  els.board.hidden = false;
  els.quad.hidden = true;
  els.grid.innerHTML = '';
  for (let r = 0; r < s.board.rows; r++) {
    for (let col = 0; col < s.board.cols; col++) {
      const cell = s.board.cells[r][col];
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'cell';
      btn.style.background = cell.hex;
      btn.dataset.row = r;
      btn.dataset.col = col;
      btn.setAttribute('role', 'gridcell');
      btn.setAttribute('aria-label', `Row ${r + 1} column ${COL_LABELS[col]}`);
      btn.tabIndex = (r === 0 && col === 0) ? 0 : -1;
      btn.addEventListener('pointerdown', onGridPointerDown);
      btn.addEventListener('keydown', onGridKeyDown);
      els.grid.appendChild(btn);
    }
  }
  focusRow = 0;
  focusCol = 0;
}

function renderQuadBoard(s) {
  els.board.hidden = true;
  els.quad.hidden = false;
  els.quad.innerHTML = '';
  for (const box of s.board.boxes) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cell quad-cell';
    btn.style.background = box.hex;
    btn.dataset.index = box.index;
    btn.setAttribute('aria-label', `Color choice ${box.index + 1}`);
    btn.tabIndex = box.index === 0 ? 0 : -1;
    btn.addEventListener('pointerdown', onQuadPointerDown);
    btn.addEventListener('keydown', onQuadKeyDown);
    els.quad.appendChild(btn);
  }
}

function guessButton(s, g) {
  if (s.board.kind === 'quad') {
    return els.quad.querySelector(`.quad-cell[data-index="${g.index}"]`);
  }
  return cellButton(g.row, g.col);
}

function cellButton(row, col) {
  return els.grid.querySelector(`.cell[data-row="${row}"][data-col="${col}"]`);
}

function quadButton(index) {
  return els.quad.querySelector(`.quad-cell[data-index="${index}"]`);
}

function onGridPointerDown(e) {
  e.preventDefault();
  const btn = e.currentTarget;
  submitGuess({ row: Number(btn.dataset.row), col: Number(btn.dataset.col) }, btn);
}

function onGridKeyDown(e) {
  const r = Number(e.currentTarget.dataset.row);
  const c = Number(e.currentTarget.dataset.col);
  switch (e.key) {
    case 'ArrowRight': moveGridFocus(r, Math.min(GRID_SIZE - 1, c + 1)); break;
    case 'ArrowLeft':  moveGridFocus(r, Math.max(0, c - 1)); break;
    case 'ArrowDown':  moveGridFocus(Math.min(GRID_SIZE - 1, r + 1), c); break;
    case 'ArrowUp':    moveGridFocus(Math.max(0, r - 1), c); break;
    case 'Enter':
    case ' ':
      e.preventDefault();
      submitGuess({ row: r, col: c }, e.currentTarget);
      break;
    case 'n':
    case 'N':
      if (!els.next.hidden) els.next.click();
      break;
    default: return;
  }
  e.preventDefault();
}

function onQuadPointerDown(e) {
  e.preventDefault();
  const btn = e.currentTarget;
  submitGuess({ index: Number(btn.dataset.index) }, btn);
}

function onQuadKeyDown(e) {
  // Indices are laid out as a 2x2: 0 1 / 2 3.
  // Horizontal flip: idx XOR 1. Vertical flip: idx XOR 2.
  const idx = Number(e.currentTarget.dataset.index);
  switch (e.key) {
    case 'ArrowRight':
    case 'ArrowLeft':  moveQuadFocus(idx ^ 1); break;
    case 'ArrowDown':
    case 'ArrowUp':    moveQuadFocus(idx ^ 2); break;
    case 'Enter':
    case ' ':
      e.preventDefault();
      submitGuess({ index: idx }, e.currentTarget);
      break;
    case 'n':
    case 'N':
      if (!els.next.hidden) els.next.click();
      break;
    default: return;
  }
  e.preventDefault();
}

function moveGridFocus(r, c) {
  focusRow = r;
  focusCol = c;
  for (const btn of els.grid.querySelectorAll('.cell')) {
    const br = Number(btn.dataset.row);
    const bc = Number(btn.dataset.col);
    btn.tabIndex = (br === r && bc === c) ? 0 : -1;
  }
  cellButton(r, c)?.focus();
}

function moveQuadFocus(idx) {
  for (const btn of els.quad.querySelectorAll('.quad-cell')) {
    btn.tabIndex = Number(btn.dataset.index) === idx ? 0 : -1;
  }
  quadButton(idx)?.focus();
}

function submitGuess(pos, btn) {
  if (btn.classList.contains('cell--wrong') || btn.classList.contains('cell--correct')) return;
  const result = game.guess(pos);
  if (result.kind === 'correct') {
    btn.classList.add('cell--correct');
    revealRound();
  } else if (result.kind === 'wrong') {
    btn.classList.add('cell--wrong');
    flash(els.photoFrame, 'shake');
    els.status.textContent = `Not quite. ${result.guessesLeft} guess${result.guessesLeft === 1 ? '' : 'es'} left.`;
    if (result.guessesLeft === 1) applyAxisHints();
    updateChips();
  } else if (result.kind === 'exhausted') {
    btn.classList.add('cell--wrong');
    revealRound();
  }
}

function revealRound(announce = true) {
  const s = game.snapshot();
  const c = s.character;
  els.photoFrame.classList.add('revealed');
  els.name.textContent = revealText(c);

  if (s.board.kind === 'quad') {
    const correctBtn = quadButton(s.board.correctIndex);
    correctBtn?.classList.add('cell--correct');
    for (const btn of els.quad.querySelectorAll('.quad-cell')) {
      if (!btn.classList.contains('cell--wrong') && !btn.classList.contains('cell--correct')) {
        btn.classList.add('cell--dim');
      }
    }
  } else {
    const correctBtn = cellButton(s.board.correctRow, s.board.correctCol);
    correctBtn?.classList.add('cell--correct');
    for (const btn of els.grid.querySelectorAll('.cell')) {
      if (!btn.classList.contains('cell--wrong') && !btn.classList.contains('cell--correct')) {
        btn.classList.add('cell--dim');
      }
    }
  }

  // Keep the status row quiet on reveal — the title shows the answer and
  // the highlighted swatch shows the colour, so the next-round button is
  // all we need below.
  els.status.textContent = '';
  const hasNext = s.roundIndex < s.totalRounds - 1;
  if (!hasNext) {
    els.next.hidden = true;
    if (s.finished && announce) {
      setTimeout(showFinished, 1100);
    }
  } else {
    els.next.hidden = false;
    els.next.focus();
  }
  updateChips();
}

function updateChips() {
  const s = game.snapshot();
  els.roundChip.textContent = `Round ${s.roundIndex + 1} / ${s.totalRounds}`;
  els.streakChip.textContent = `Streak ${s.streak}`;
  els.bestChip.textContent = `Best ${s.bestStreak}`;
  els.guessesChip.textContent = `Guesses ${s.guessesLeft}`;
}

els.tabItems.addEventListener('click', () => setMode('items'));
els.tabGrid.addEventListener('click', () => setMode('grid'));

function advanceRound() {
  const r = game.next();
  if (r.kind === 'finished' || game.snapshot().finished) {
    showFinished();
  } else {
    renderRound();
  }
}

els.next.addEventListener('click', advanceRound);

// Swipe-to-advance: once a round is revealed, dragging the photo
// horizontally past the threshold advances to the next round. Mirrors
// the next-round button so the player can play one-handed without
// reaching back to the action bar.
attachSwipeToAdvance(els.photoFrame);

function attachSwipeToAdvance(target) {
  if (!target) return;
  const SWIPE_THRESHOLD = 70;     // px of horizontal travel to commit
  const VERTICAL_LIMIT = 60;      // beyond this we treat it as a scroll
  let active = false;
  let startX = 0;
  let startY = 0;
  let pointerId = null;

  const canSwipe = () => !els.next.hidden;

  const reset = (animate) => {
    target.style.transition = animate ? 'transform 180ms ease' : '';
    target.style.transform = '';
    target.style.opacity = '';
    if (animate) {
      setTimeout(() => { target.style.transition = ''; }, 200);
    }
  };

  target.addEventListener('pointerdown', (e) => {
    if (!canSwipe()) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    active = true;
    pointerId = e.pointerId;
    startX = e.clientX;
    startY = e.clientY;
    target.style.transition = '';
  });

  target.addEventListener('pointermove', (e) => {
    if (!active || e.pointerId !== pointerId) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (Math.abs(dy) > VERTICAL_LIMIT && Math.abs(dy) > Math.abs(dx)) {
      // Vertical scroll — let the page have it.
      active = false;
      reset(true);
      return;
    }
    if (Math.abs(dx) > 8) {
      // Capture so the gesture keeps tracking even if the finger leaves
      // the photo frame.
      try { target.setPointerCapture(pointerId); } catch { /* ignore */ }
      e.preventDefault();
      target.style.transform = `translateX(${dx}px) rotate(${dx * 0.02}deg)`;
      const fade = Math.min(1, Math.abs(dx) / (SWIPE_THRESHOLD * 2));
      target.style.opacity = String(1 - fade * 0.35);
    }
  });

  const finish = (e) => {
    if (!active || e.pointerId !== pointerId) return;
    active = false;
    const dx = e.clientX - startX;
    try { target.releasePointerCapture(pointerId); } catch { /* ignore */ }
    if (canSwipe() && Math.abs(dx) >= SWIPE_THRESHOLD) {
      // Throw the card off-screen, then advance.
      const dir = dx > 0 ? 1 : -1;
      target.style.transition = 'transform 180ms ease, opacity 180ms ease';
      target.style.transform = `translateX(${dir * window.innerWidth}px) rotate(${dir * 8}deg)`;
      target.style.opacity = '0';
      setTimeout(() => {
        reset(false);
        advanceRound();
      }, 180);
    } else {
      reset(true);
    }
  };

  target.addEventListener('pointerup', finish);
  target.addEventListener('pointercancel', finish);
}

if (els.share) {
  els.share.addEventListener('click', async () => {
    if (!cachedShareCanvas) return;
    els.share.disabled = true;
    try {
      await shareCanvas(cachedShareCanvas, game.snapshot());
    } catch (err) {
      console.error(err);
      els.status.textContent = `Could not share: ${err.message}`;
    } finally {
      els.share.disabled = false;
    }
  });
}

if (els.copyResult) {
  els.copyResult.addEventListener('click', async () => {
    const text = shareText(game.snapshot());
    try {
      await navigator.clipboard.writeText(text);
      els.copyResult.textContent = 'Copied!';
      setTimeout(() => { els.copyResult.textContent = 'Copy text'; }, 1800);
    } catch {
      els.copyResult.textContent = 'Copy failed';
    }
  });
}

async function showFinished() {
  const s = game.snapshot();
  els.characterCard.hidden = true;
  els.board.hidden = true;
  els.quad.hidden = true;
  els.next.hidden = true;
  els.status.textContent = '';

  const wins = s.rounds.filter(r => r.won).length;
  const summary = `${wins} of ${s.totalRounds} solved today.`;
  els.status.textContent = summary;
  updateChips();

  els.shareSlot.hidden = false;
  els.shareSlot.innerHTML = '';
  cachedShareCanvas = await renderShareCard(s);
  cachedShareCanvas.classList.add('share-card');
  els.shareSlot.appendChild(cachedShareCanvas);

  els.share.hidden = false;
  els.share.disabled = false;
  if (els.copyResult) els.copyResult.hidden = false;
  startCountdown();
}

function hideShareSlot() {
  if (els.shareSlot) {
    els.shareSlot.hidden = true;
    els.shareSlot.innerHTML = '';
  }
  cachedShareCanvas = null;
  if (countdownTimer) {
    clearInterval(countdownTimer);
    countdownTimer = null;
  }
  if (els.countdown) els.countdown.textContent = '';
}

function startCountdown() {
  if (!els.countdown) return;
  const tick = () => {
    const ms = msUntilNextUtcDay();
    els.countdown.textContent = `Next puzzle in ${formatCountdown(ms)} (UTC)`;
    if (ms <= 0) {
      clearInterval(countdownTimer);
      countdownTimer = null;
      window.location.reload();
    }
  };
  tick();
  countdownTimer = setInterval(tick, 1000);
}

function flash(el, cls) {
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
  setTimeout(() => el.classList.remove(cls), 500);
}
