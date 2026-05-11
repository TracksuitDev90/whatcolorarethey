import { loadCharacters } from './characters.js';
import { createDailyGame, onceStorageWriteFailed } from './game.js';
import {
  getUtcDateKey,
  pickDailyCharacters,
  msUntilNextUtcDay,
  formatCountdown,
} from './daily.js';
import {
  renderShareCard,
  shareCanvas,
  shareText,
  shareLinkUrl,
  decodeSharePayload,
  snapshotFromPayload,
} from './share.js';

const COL_LABELS = ['A', 'B', 'C', 'D'];
const GRID_SIZE = 4;
const ROUNDS_PER_DAY = 3;

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
  skip: document.getElementById('skip-btn'),
  share: document.getElementById('share-btn'),
  link: document.getElementById('link-btn'),
  copyResult: document.getElementById('copy-btn'),
  shareSlot: document.getElementById('share-slot'),
  shareActions: document.getElementById('share-actions'),
  countdown: document.getElementById('countdown'),
  characterCard: document.getElementById('character-card'),
  roundChip: document.getElementById('round-chip'),
  streakChip: document.getElementById('streak-chip'),
  bestChip: document.getElementById('best-chip'),
  guessesChip: document.getElementById('guesses-chip'),
  skipsChip: document.getElementById('skips-chip'),
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
  showLoading();
  try {
    const chars = await loadCharacters();
    dateKey = getUtcDateKey();

    // Read-only "view someone else's results" mode — kicked off when the
    // page loads with ?s=<encoded share>. Skip the rest of game setup so
    // we never overwrite the visitor's own progress with the shared one.
    const params = new URLSearchParams(window.location.search);
    const sharedParam = params.get('s');
    if (sharedParam) {
      const ok = await tryRenderSharedView(sharedParam, chars);
      if (ok) return;
      // Decode failed (corrupt/expired link). Strip the param so it doesn't
      // stick around on refresh, surface a one-time toast, then fall through
      // to the normal daily game.
      const cleanUrl = new URL(window.location.href);
      cleanUrl.searchParams.delete('s');
      window.history.replaceState({}, '', cleanUrl.toString());
      toast("That share link couldn't be read — showing today's puzzle instead.");
    }

    const itemPool = chars.filter(c => c.type === 'item');
    const gridPool = chars.filter(c => c.type !== 'item');
    const itemDaily = pickDailyCharacters(itemPool, dateKey, ROUNDS_PER_DAY);
    const gridDaily = pickDailyCharacters(gridPool, dateKey, ROUNDS_PER_DAY);
    games.items = itemDaily.length
      ? createDailyGame(itemDaily, dateKey, { mode: 'items' })
      : null;
    games.grid = gridDaily.length
      ? createDailyGame(gridDaily, dateKey, { mode: 'grid' })
      : null;
    renderHeaders();
    setMode(games.items ? 'items' : 'grid');
    onceStorageWriteFailed(() => {
      toast("Your progress won't be saved in this browsing mode.");
    });
  } catch (err) {
    showInitError(err);
  }
}

function showLoading() {
  els.characterCard.hidden = true;
  els.board.hidden = true;
  els.quad.hidden = true;
  els.status.innerHTML = '<span class="spinner" aria-hidden="true"></span>Loading today\'s puzzle…';
}

function showInitError(err) {
  els.characterCard.hidden = true;
  els.board.hidden = true;
  els.quad.hidden = true;
  els.status.innerHTML = '';
  const msg = document.createElement('span');
  msg.textContent = "Couldn't load today's puzzle. ";
  els.status.appendChild(msg);
  const retry = document.createElement('button');
  retry.type = 'button';
  retry.className = 'btn btn--ghost btn--inline';
  retry.textContent = 'Retry';
  retry.addEventListener('click', () => { init(); });
  els.status.appendChild(retry);
  if (err?.message) {
    const detail = document.createElement('div');
    detail.className = 'status-detail';
    detail.textContent = err.message;
    els.status.appendChild(detail);
  }
}

async function tryRenderSharedView(s, allCharacters) {
  const payload = decodeSharePayload(s);
  if (!payload) return false;
  const snap = snapshotFromPayload(payload, allCharacters);
  if (!snap) return false;
  // Read-only view: rip out the live UI so the player's own progress is
  // never touched, and so the share-action button listeners (which expect a
  // running game) never fire.
  document.querySelector('.tabs')?.setAttribute('hidden', '');
  els.characterCard.hidden = true;
  els.board.hidden = true;
  els.quad.hidden = true;
  els.skip.hidden = true;
  els.next.hidden = true;
  els.name.textContent = '';
  const wins = snap.rounds.filter(r => r.won).length;
  els.status.textContent = `Shared result · ${snap.date} · ${wins} of ${snap.rounds.length} solved`;
  els.shareSlot.hidden = false;
  els.shareSlot.innerHTML = '';
  const canvas = await renderShareCard(snap);
  canvas.classList.add('share-card');
  els.shareSlot.appendChild(canvas);
  // Drop the original share-action buttons entirely and replace with a
  // single "Play today" CTA. Replacing the contents removes the stale
  // listeners so we don't accidentally fire them.
  els.shareActions.hidden = false;
  els.shareActions.innerHTML = '';
  const playBtn = document.createElement('button');
  playBtn.type = 'button';
  playBtn.className = 'btn btn--primary';
  playBtn.textContent = 'Play today\'s puzzle';
  playBtn.addEventListener('click', () => {
    const url = new URL(window.location.href);
    url.search = '';
    url.hash = '';
    window.location.href = url.toString();
  });
  els.shareActions.appendChild(playBtn);
  return true;
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
  const stage = document.getElementById('stage');
  if (stage) {
    stage.setAttribute('aria-labelledby', mode === 'items' ? 'tab-items' : 'tab-grid');
  }
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
  // Force a fresh load. Without removing the attribute first, switching tabs
  // mid-round can leave the previous mode's photo visible until the next
  // image's bytes arrive — items and characters are separate experiences.
  if (els.img.getAttribute('src') !== c.imageSrc) {
    els.img.removeAttribute('src');
    els.img.src = c.imageSrc;
  }
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
  els.shareActions.hidden = true;
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
    revealRound(/*announce*/ false, /*skipped*/ round.skipped);
  } else if (s.board.kind === 'grid' && s.wrongGuesses.length >= 2) {
    applyAxisHints();
  }

  updateChips();
  updateSkipButton();
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
    case 's':
    case 'S':
      if (!els.skip.hidden && !els.skip.disabled) els.skip.click();
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
    case 's':
    case 'S':
      if (!els.skip.hidden && !els.skip.disabled) els.skip.click();
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

function revealRound(announce = true, skipped = false) {
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

  els.status.textContent = skipped ? 'Skipped — here\'s the answer.' : '';
  els.skip.hidden = true;
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
  // Hide the "/ N" suffix when N is effectively unlimited — it would just
  // read as noise (e.g. "Round 1 / 999"). Same for skips.
  // Drop the "/ N" suffix when the daily run is open-ended — surfacing "1 of
  // 57" reads as a slog rather than an invitation, even though the pool
  // technically has that many entries.
  els.roundChip.textContent = s.totalRounds >= 10
    ? `Round ${s.roundIndex + 1}`
    : `Round ${s.roundIndex + 1} / ${s.totalRounds}`;
  els.streakChip.textContent = `Streak ${s.streak}`;
  els.bestChip.textContent = `Best ${s.bestStreak}`;
  els.guessesChip.textContent = `Guesses ${s.guessesLeft}`;
  els.skipsChip.textContent = s.maxSkips >= 10
    ? 'Skip available'
    : `Skips ${s.skipsLeft}`;
  els.skipsChip.classList.toggle('chip--depleted', s.skipsLeft === 0);
}

function updateSkipButton() {
  const s = game.snapshot();
  const canSkip = !s.revealed && !s.finished && s.skipsLeft > 0;
  els.skip.hidden = !canSkip;
  els.skip.disabled = !canSkip;
  // Drop the "X of Y left" suffix when skips are effectively unlimited — the
  // count would just read as noise (e.g. "Skip (998 of 999)").
  els.skip.textContent = s.maxSkips >= 10
    ? 'Skip'
    : `Skip (${s.skipsLeft} of ${s.maxSkips} left)`;
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

function performSkip(viaSwipe = false) {
  const result = game.skip();
  if (result.kind === 'no-skips' || result.kind === 'noop') return false;
  if (viaSwipe) {
    // Swipe is the "fast" path — just advance, no reveal pause.
    advanceRound();
  } else {
    // Button is the "deliberate" path — reveal so the player learns the
    // answer, then they tap or swipe to advance. If skipping was the
    // final unfinished round, auto-roll into the share screen.
    renderRound();
    if (game.snapshot().finished) {
      setTimeout(showFinished, 1100);
    }
  }
  return true;
}

els.next.addEventListener('click', advanceRound);
els.skip.addEventListener('click', () => performSkip(false));

// Swipe-to-advance / swipe-to-skip. Once a round is revealed, a horizontal
// swipe advances to the next round. While a round is still in progress, a
// swipe consumes a skip and advances. If skips are exhausted we snap back.
attachSwipeToAdvance(els.photoFrame);

function attachSwipeToAdvance(target) {
  if (!target) return;
  // Touch needs a much higher commit threshold than mouse — a phone-edge
  // thumb-flick crosses 60px easily while reading, and the swipe should feel
  // intentional, not incidental.
  const COMMIT_TOUCH = 110;
  const COMMIT_MOUSE = 60;
  // Don't lock direction (or hijack the gesture) until the pointer has moved
  // this far. Below this we can't reliably tell scroll from swipe.
  const DIRECTION_LOCK_DISTANCE = 16;
  // Once we have enough motion to decide, dx must exceed dy by this ratio to
  // count as a horizontal swipe. Anything flatter is treated as a scroll and
  // the gesture is released for the rest of this touch.
  const HORIZONTAL_RATIO = 1.5;

  let active = false;
  let locked = null; // null | 'horizontal' | 'vertical'
  let startX = 0;
  let startY = 0;
  let pointerId = null;
  let pointerType = 'mouse';

  const swipeMode = () => {
    const s = game?.snapshot();
    if (!s || s.finished) return 'none';
    if (s.revealed) return 'next';
    if (s.skipsLeft > 0) return 'skip';
    return 'none';
  };

  const reset = (animate) => {
    target.style.transition = animate ? 'transform 220ms cubic-bezier(0.2, 0.7, 0.2, 1), opacity 220ms ease' : '';
    target.style.transform = '';
    target.style.opacity = '';
    if (animate) {
      setTimeout(() => { target.style.transition = ''; }, 240);
    }
  };

  target.addEventListener('pointerdown', (e) => {
    if (swipeMode() === 'none') return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    active = true;
    locked = null;
    pointerId = e.pointerId;
    pointerType = e.pointerType || 'mouse';
    startX = e.clientX;
    startY = e.clientY;
    target.style.transition = '';
  });

  target.addEventListener('pointermove', (e) => {
    if (!active || e.pointerId !== pointerId) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    const adx = Math.abs(dx);
    const ady = Math.abs(dy);

    if (locked === null) {
      // Wait for enough motion to make a confident decision. Below the lock
      // distance, do nothing — no transform, no pointer capture, so vertical
      // scrolling stays smooth.
      if (Math.hypot(dx, dy) < DIRECTION_LOCK_DISTANCE) return;
      if (adx > ady * HORIZONTAL_RATIO) {
        locked = 'horizontal';
        try { target.setPointerCapture(pointerId); } catch { /* ignore */ }
      } else {
        // Page scroll wins — bail out for the rest of this touch.
        locked = 'vertical';
        active = false;
        return;
      }
    }

    if (locked !== 'horizontal') return;
    e.preventDefault();
    // Slight non-linear curve — feels softer near the start, firmer past the threshold.
    const eased = dx * (1 - Math.min(0.25, adx / 1200));
    target.style.transform = `translateX(${eased}px) rotate(${eased * 0.018}deg)`;
    const commit = pointerType === 'mouse' ? COMMIT_MOUSE : COMMIT_TOUCH;
    const fade = Math.min(1, adx / (commit * 2.2));
    target.style.opacity = String(1 - fade * 0.4);
  });

  const finish = (e) => {
    if (!active || e.pointerId !== pointerId) return;
    active = false;
    const wasHorizontal = locked === 'horizontal';
    locked = null;
    const dx = e.clientX - startX;
    try { target.releasePointerCapture(pointerId); } catch { /* ignore */ }
    const m = swipeMode();
    const commit = pointerType === 'mouse' ? COMMIT_MOUSE : COMMIT_TOUCH;
    if (wasHorizontal && m !== 'none' && Math.abs(dx) >= commit) {
      const dir = dx > 0 ? 1 : -1;
      target.style.transition = 'transform 220ms cubic-bezier(0.2, 0.7, 0.2, 1), opacity 220ms ease';
      target.style.transform = `translateX(${dir * window.innerWidth}px) rotate(${dir * 8}deg)`;
      target.style.opacity = '0';
      setTimeout(() => {
        reset(false);
        if (m === 'skip') {
          performSkip(true);
        } else {
          advanceRound();
        }
      }, 220);
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
      const result = await shareCanvas(cachedShareCanvas, game.snapshot());
      if (result?.kind === 'shared') {
        toast('Shared!');
      } else if (result?.kind === 'downloaded') {
        toast('Image saved');
      }
    } catch (err) {
      toast(`Could not share: ${err.message}`);
    } finally {
      els.share.disabled = false;
    }
  });
}

if (els.link) {
  els.link.addEventListener('click', async () => {
    const url = shareLinkUrl(game.snapshot());
    // Prefer the native share sheet so users on phones can fling the URL
    // straight into Messages / Mail. Falls back to clipboard otherwise.
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'Color Guesser',
          text: shareText(game.snapshot()),
          url,
        });
        return;
      } catch (err) {
        if (err?.name === 'AbortError') return;
        // fall through to clipboard
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      flashLabel(els.link, 'Link copied!', 'Copy link');
    } catch {
      flashLabel(els.link, 'Copy failed', 'Copy link');
    }
  });
}

if (els.copyResult) {
  els.copyResult.addEventListener('click', async () => {
    const text = shareText(game.snapshot());
    try {
      await navigator.clipboard.writeText(text);
      flashLabel(els.copyResult, 'Copied!', 'Copy emoji');
    } catch {
      flashLabel(els.copyResult, 'Copy failed', 'Copy emoji');
    }
  });
}

function flashLabel(btn, hot, cool) {
  btn.textContent = hot;
  setTimeout(() => { btn.textContent = cool; }, 1800);
}

async function showFinished() {
  const s = game.snapshot();
  els.characterCard.hidden = true;
  els.board.hidden = true;
  els.quad.hidden = true;
  els.next.hidden = true;
  els.skip.hidden = true;
  els.status.textContent = '';

  const wins = s.rounds.filter(r => r.won).length;
  const skipped = s.rounds.filter(r => r.skipped).length;
  let summary = `${wins} of ${s.totalRounds} solved today.`;
  if (skipped > 0) summary += ` (${skipped} skipped)`;
  els.status.textContent = summary;
  updateChips();

  els.shareSlot.hidden = false;
  els.shareSlot.innerHTML = '';
  cachedShareCanvas = await renderShareCard(s);
  cachedShareCanvas.classList.add('share-card');
  els.shareSlot.appendChild(cachedShareCanvas);

  els.shareActions.hidden = false;
  els.share.hidden = false;
  els.share.disabled = false;
  els.share.textContent = 'Save image';
  els.link.hidden = false;
  els.link.textContent = 'Copy link';
  els.copyResult.hidden = false;
  els.copyResult.textContent = 'Copy emoji';
  startCountdown();
}

function hideShareSlot() {
  if (els.shareSlot) {
    els.shareSlot.hidden = true;
    els.shareSlot.innerHTML = '';
  }
  if (els.shareActions) els.shareActions.hidden = true;
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

// Temporary hard-reset button for testing. Clears the per-day game state
// and best-streak record (covers streaks, characters, items, and skips —
// everything game.js writes to localStorage) so a fresh run starts on
// reload. Remove once testing is finished.
const restartBtn = document.getElementById('restart-btn');
if (restartBtn) {
  restartBtn.addEventListener('click', () => {
    try {
      localStorage.removeItem('wcat:daily');
      localStorage.removeItem('wcat:bestStreak');
    } catch { /* private mode — nothing to clear */ }
    const url = new URL(window.location.href);
    url.search = '';
    url.hash = '';
    window.location.replace(url.toString());
  });
}

let toastTimer = null;
function toast(message) {
  let host = document.getElementById('toast');
  if (!host) {
    host = document.createElement('div');
    host.id = 'toast';
    host.className = 'toast';
    host.setAttribute('role', 'status');
    host.setAttribute('aria-live', 'polite');
    document.body.appendChild(host);
  }
  host.textContent = message;
  host.classList.add('toast--visible');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    host.classList.remove('toast--visible');
  }, 3200);
}

