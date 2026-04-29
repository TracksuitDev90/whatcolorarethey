import { loadCharacters } from './characters.js';
import { createDailyGame } from './game.js';
import {
  getUtcDateKey,
  pickDailyCharacters,
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
  grid: document.getElementById('grid'),
  colHeaders: document.getElementById('col-headers'),
  rowHeaders: document.getElementById('row-headers'),
  status: document.getElementById('status'),
  next: document.getElementById('next-btn'),
  share: document.getElementById('share-btn'),
  copyResult: document.getElementById('copy-btn'),
  shareSlot: document.getElementById('share-slot'),
  countdown: document.getElementById('countdown'),
  characterCard: document.getElementById('character-card'),
  board: document.getElementById('board'),
  roundChip: document.getElementById('round-chip'),
  streakChip: document.getElementById('streak-chip'),
  bestChip: document.getElementById('best-chip'),
  guessesChip: document.getElementById('guesses-chip'),
};

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
    const daily = pickDailyCharacters(chars, dateKey, chars.length);
    game = createDailyGame(daily, dateKey);
    renderHeaders();
    if (game.snapshot().finished) {
      showFinished();
    } else {
      renderRound();
    }
  } catch (err) {
    console.error(err);
    els.status.textContent = `Failed to start: ${err.message}`;
  }
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
  const { correctRow, correctCol } = s.grid;
  for (const w of s.wrongCells) {
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

function renderRound() {
  hideShareSlot();
  const s = game.snapshot();
  const c = s.character;
  const round = s.rounds[s.roundIndex];

  els.characterCard.hidden = false;
  els.board.hidden = false;
  els.img.src = c.imageSrc;
  els.img.alt = `Cartoon character (grayscale until revealed)`;
  els.name.innerHTML = '&nbsp;';
  els.photoFrame.classList.remove('revealed');
  els.next.hidden = true;
  els.share.hidden = true;
  if (els.copyResult) els.copyResult.hidden = true;
  els.status.textContent = 'What color are they? Pick a swatch.';
  clearHints();

  els.grid.innerHTML = '';
  for (let r = 0; r < s.grid.rows; r++) {
    for (let col = 0; col < s.grid.cols; col++) {
      const cell = s.grid.cells[r][col];
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'cell';
      btn.style.background = cell.hex;
      btn.dataset.row = r;
      btn.dataset.col = col;
      btn.setAttribute('role', 'gridcell');
      btn.setAttribute('aria-label', `Row ${r + 1} column ${COL_LABELS[col]}`);
      btn.tabIndex = (r === 0 && col === 0) ? 0 : -1;
      btn.addEventListener('pointerdown', onPointerDown);
      btn.addEventListener('keydown', onKeyDown);
      els.grid.appendChild(btn);
    }
  }
  focusRow = 0;
  focusCol = 0;

  // Replay any saved guesses for this round so refreshing mid-puzzle keeps state.
  for (const g of round.guesses) {
    const btn = cellButton(g.row, g.col);
    if (!btn) continue;
    btn.classList.add(g.correct ? 'cell--correct' : 'cell--wrong');
  }

  if (s.revealed) {
    revealRound(/*lost*/ round.lost === true, /*announce*/ false);
  } else if (s.wrongCells.length >= 2) {
    applyAxisHints();
  }

  updateChips();
}

function cellButton(row, col) {
  return els.grid.querySelector(`.cell[data-row="${row}"][data-col="${col}"]`);
}

function onPointerDown(e) {
  e.preventDefault();
  const btn = e.currentTarget;
  submitGuess(Number(btn.dataset.row), Number(btn.dataset.col), btn);
}

function onKeyDown(e) {
  const r = Number(e.currentTarget.dataset.row);
  const c = Number(e.currentTarget.dataset.col);
  switch (e.key) {
    case 'ArrowRight': moveFocus(r, Math.min(GRID_SIZE - 1, c + 1)); break;
    case 'ArrowLeft':  moveFocus(r, Math.max(0, c - 1)); break;
    case 'ArrowDown':  moveFocus(Math.min(GRID_SIZE - 1, r + 1), c); break;
    case 'ArrowUp':    moveFocus(Math.max(0, r - 1), c); break;
    case 'Enter':
    case ' ':
      e.preventDefault();
      submitGuess(r, c, e.currentTarget);
      break;
    case 'n':
    case 'N':
      if (!els.next.hidden) els.next.click();
      break;
    default: return;
  }
  e.preventDefault();
}

function moveFocus(r, c) {
  focusRow = r;
  focusCol = c;
  for (const btn of els.grid.querySelectorAll('.cell')) {
    const br = Number(btn.dataset.row);
    const bc = Number(btn.dataset.col);
    btn.tabIndex = (br === r && bc === c) ? 0 : -1;
  }
  cellButton(r, c)?.focus();
}

function submitGuess(r, c, btn) {
  if (btn.classList.contains('cell--wrong') || btn.classList.contains('cell--correct')) return;
  const result = game.guess(r, c);
  if (result.kind === 'correct') {
    btn.classList.add('cell--correct');
    revealRound(/*lost*/ false);
  } else if (result.kind === 'wrong') {
    btn.classList.add('cell--wrong');
    flash(els.photoFrame, 'shake');
    els.status.textContent = `Not quite. ${result.guessesLeft} guess${result.guessesLeft === 1 ? '' : 'es'} left.`;
    if (result.guessesLeft === 1) applyAxisHints();
    updateChips();
  } else if (result.kind === 'exhausted') {
    btn.classList.add('cell--wrong');
    revealRound(/*lost*/ true);
  }
}

function revealRound(lost, announce = true) {
  const s = game.snapshot();
  els.photoFrame.classList.add('revealed');
  els.name.textContent = s.character.name;
  const correctBtn = cellButton(s.grid.correctRow, s.grid.correctCol);
  correctBtn?.classList.add('cell--correct');
  for (const btn of els.grid.querySelectorAll('.cell')) {
    if (!btn.classList.contains('cell--wrong') && !btn.classList.contains('cell--correct')) {
      btn.classList.add('cell--dim');
    }
  }
  if (announce) {
    els.status.textContent = lost
      ? `Out of guesses. ${s.character.name}'s color is ${s.character.color.name || s.character.color.hex}.`
      : `Correct! ${s.character.name} — ${s.character.color.name || s.character.color.hex}.`;
  } else {
    els.status.textContent = lost
      ? `${s.character.name} — ${s.character.color.name || s.character.color.hex}.`
      : `${s.character.name} — ${s.character.color.name || s.character.color.hex}.`;
  }
  if (s.roundIndex >= s.totalRounds - 1) {
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

els.next.addEventListener('click', () => {
  const r = game.next();
  if (r.kind === 'finished' || game.snapshot().finished) {
    showFinished();
  } else {
    renderRound();
  }
});

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
