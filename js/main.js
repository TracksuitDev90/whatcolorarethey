import { loadCharacters } from './characters.js';
import { createGame } from './game.js';

const COL_LABELS = ['A', 'B', 'C', 'D'];
const GRID_SIZE = 4;

const els = {
  img: document.getElementById('character-img'),
  name: document.getElementById('character-name'),
  photoFrame: document.getElementById('photo-frame'),
  grid: document.getElementById('grid'),
  colHeaders: document.getElementById('col-headers'),
  rowHeaders: document.getElementById('row-headers'),
  status: document.getElementById('status'),
  next: document.getElementById('next-btn'),
  restart: document.getElementById('restart-btn'),
  roundChip: document.getElementById('round-chip'),
  streakChip: document.getElementById('streak-chip'),
  bestChip: document.getElementById('best-chip'),
  guessesChip: document.getElementById('guesses-chip'),
};

let game;
let focusRow = 0;
let focusCol = 0;

init();

async function init() {
  try {
    const chars = await loadCharacters();
    game = createGame(chars);
    renderHeaders();
    renderRound();
  } catch (err) {
    console.error(err);
    els.status.textContent = `Failed to start: ${err.message}`;
  }
}

function renderHeaders() {
  els.colHeaders.innerHTML = COL_LABELS
    .map(l => `<span class="hdr">${l}</span>`).join('');
  els.rowHeaders.innerHTML = Array.from({ length: GRID_SIZE }, (_, i) =>
    `<span class="hdr">${i + 1}</span>`).join('');
}

function renderRound() {
  const s = game.snapshot();
  const c = s.character;

  els.img.src = c.imageSrc;
  els.img.alt = `Cartoon character (grayscale until revealed)`;
  els.name.innerHTML = '&nbsp;';
  els.photoFrame.classList.remove('revealed');
  els.next.hidden = true;
  els.restart.hidden = true;
  els.status.textContent = 'What color are they? Pick a swatch.';

  // Build grid cells
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
      btn.setAttribute('aria-label',
        `Row ${r + 1} column ${COL_LABELS[col]}`);
      btn.tabIndex = (r === 0 && col === 0) ? 0 : -1;
      btn.addEventListener('pointerdown', onPointerDown);
      btn.addEventListener('keydown', onKeyDown);
      els.grid.appendChild(btn);
    }
  }
  focusRow = 0;
  focusCol = 0;
  updateChips();

  // For dev: confirm correct cell carries exact hex.
  if (typeof window !== 'undefined' && window.location?.search?.includes('debug')) {
    const cc = s.grid.cells[s.grid.correctRow][s.grid.correctCol];
    console.log(`[round ${s.roundIndex}] ${c.name} expects ${c.color.hex}; correct cell @ r${s.grid.correctRow}c${s.grid.correctCol} = ${cc.hex}`);
  }
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
  const target = els.grid.querySelector(`.cell[data-row="${r}"][data-col="${c}"]`);
  target?.focus();
}

function submitGuess(r, c, btn) {
  if (btn.classList.contains('cell--wrong') || btn.classList.contains('cell--correct')) return;
  const result = game.guess(r, c);
  if (result.kind === 'correct') {
    btn.classList.add('cell--correct');
    revealRound(result.cell, /*lost*/ false);
  } else if (result.kind === 'wrong') {
    btn.classList.add('cell--wrong');
    flash(els.photoFrame, 'shake');
    els.status.textContent = `Not quite. ${result.guessesLeft} guess${result.guessesLeft === 1 ? '' : 'es'} left.`;
    updateChips();
  } else if (result.kind === 'exhausted') {
    btn.classList.add('cell--wrong');
    revealRound(result.correctCell, /*lost*/ true);
  }
}

function revealRound(correctCell, lost) {
  const s = game.snapshot();
  els.photoFrame.classList.add('revealed');
  els.name.textContent = s.character.name;
  // Mark the correct cell
  const correctBtn = els.grid.querySelector(
    `.cell[data-row="${correctCell.row}"][data-col="${correctCell.col}"]`);
  correctBtn?.classList.add('cell--correct');
  // Disable interactions
  for (const btn of els.grid.querySelectorAll('.cell')) {
    if (!btn.classList.contains('cell--wrong') && !btn.classList.contains('cell--correct')) {
      btn.classList.add('cell--dim');
    }
  }
  els.status.textContent = lost
    ? `Out of guesses. ${s.character.name}'s color is ${s.character.color.name || s.character.color.hex}.`
    : `Correct! ${s.character.name} — ${s.character.color.name || s.character.color.hex}.`;
  els.next.hidden = false;
  els.next.focus();
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
  if (r.kind === 'finished') {
    showFinished();
  } else {
    renderRound();
  }
});

els.restart.addEventListener('click', () => {
  game.restart();
  renderRound();
});

function showFinished() {
  const s = game.snapshot();
  els.status.textContent = `All ${s.totalRounds} rounds complete. Best streak this run: ${s.bestStreak}.`;
  els.grid.innerHTML = '';
  els.next.hidden = true;
  els.restart.hidden = false;
  els.restart.focus();
  els.photoFrame.classList.add('revealed');
}

function flash(el, cls) {
  el.classList.remove(cls);
  // force reflow so animation re-fires
  void el.offsetWidth;
  el.classList.add(cls);
  setTimeout(() => el.classList.remove(cls), 500);
}
