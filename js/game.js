// Daily-mode game state. Plays N rounds locked to the UTC date, with
// per-round guess history persisted to localStorage so refreshing
// preserves progress until the next UTC day.
//
// Two board kinds, mixed within the same daily run:
//   grid — 5x5 shade picker, 3 guesses, axis hints after the 2nd miss
//   quad — 4 distinct color swatches, 1 guess, no hints

import { buildGrid } from './grid.js';
import { buildQuad } from './quad.js';
import { gridSeedFor } from './daily.js';

const STORAGE_KEYS = {
  bestStreak: 'wcat:bestStreak',
  daily: (date) => `wcat:daily:${date}`,
};

const GRID_MAX_GUESSES = 3;
const QUAD_MAX_GUESSES = 1;
const GRID_SIZE = 5;

export function maxGuessesFor(character) {
  return character?.type === 'item' ? QUAD_MAX_GUESSES : GRID_MAX_GUESSES;
}

export function createDailyGame(dailyCharacters, dateKey) {
  if (!dailyCharacters?.length) throw new Error('createDailyGame: no characters');

  const persisted = loadDailyState(dateKey);

  const state = {
    date: dateKey,
    characters: dailyCharacters,
    rounds: hydrateRounds(persisted?.rounds, dailyCharacters),
    currentIndex: clampInt(persisted?.currentIndex ?? 0, 0, dailyCharacters.length - 1),
    streak: clampInt(persisted?.streak ?? 0, 0, 9999),
    bestStreak: clampInt(readStorage(STORAGE_KEYS.bestStreak, 0), 0, 9999),
    board: null,
    revealed: false,
  };

  // If the saved currentIndex points at a finished round but later rounds
  // exist, advance to the next unfinished one. Keeps hydration sensible.
  while (
    state.currentIndex < state.characters.length - 1 &&
    isRoundDone(state.rounds[state.currentIndex])
  ) {
    state.currentIndex += 1;
  }

  loadCurrent();

  function loadCurrent() {
    const c = state.characters[state.currentIndex];
    const seed = gridSeedFor(state.date, c.id);
    if (c.type === 'item') {
      state.board = buildQuad(c.color.hex, { seed });
    } else {
      state.board = {
        kind: 'grid',
        ...buildGrid(c.color.hex, { rows: GRID_SIZE, cols: GRID_SIZE, seed }),
      };
    }
    const round = state.rounds[state.currentIndex];
    state.revealed = isRoundDone(round);
  }

  function persist() {
    saveDailyState(state.date, {
      rounds: state.rounds,
      currentIndex: state.currentIndex,
      streak: state.streak,
    });
  }

  function currentMaxGuesses() {
    return maxGuessesFor(state.characters[state.currentIndex]);
  }

  function guess(pos) {
    if (state.revealed || isComplete()) return { kind: 'noop' };
    const round = state.rounds[state.currentIndex];
    const cell = cellAt(pos);
    if (!cell) return { kind: 'noop' };
    round.guesses.push({ ...pos, correct: cell.isCorrect });
    if (cell.isCorrect) {
      round.won = true;
      state.revealed = true;
      state.streak += 1;
      if (state.streak > state.bestStreak) {
        state.bestStreak = state.streak;
        writeStorage(STORAGE_KEYS.bestStreak, state.bestStreak);
      }
      persist();
      return { kind: 'correct', cell };
    }
    if (round.guesses.length >= currentMaxGuesses()) {
      round.lost = true;
      state.revealed = true;
      state.streak = 0;
      persist();
      return { kind: 'exhausted', correctCell: correctCell() };
    }
    persist();
    return { kind: 'wrong', cell, guessesLeft: currentMaxGuesses() - round.guesses.length };
  }

  function next() {
    if (state.currentIndex >= state.characters.length - 1) {
      return { kind: 'finished' };
    }
    state.currentIndex += 1;
    loadCurrent();
    persist();
    return { kind: 'round', round: state.currentIndex };
  }

  function cellAt(pos) {
    if (state.board.kind === 'quad') {
      return state.board.boxes[pos.index];
    }
    return state.board.cells[pos.row]?.[pos.col];
  }

  function correctCell() {
    if (state.board.kind === 'quad') {
      return state.board.boxes[state.board.correctIndex];
    }
    return state.board.cells[state.board.correctRow][state.board.correctCol];
  }

  function isComplete() {
    return state.rounds.every(isRoundDone);
  }

  function snapshot() {
    const round = state.rounds[state.currentIndex];
    const max = currentMaxGuesses();
    return {
      date: state.date,
      characters: state.characters,
      character: state.characters[state.currentIndex],
      rounds: state.rounds,
      roundIndex: state.currentIndex,
      totalRounds: state.characters.length,
      streak: state.streak,
      bestStreak: state.bestStreak,
      guessesLeft: max - round.guesses.length,
      revealed: state.revealed,
      finished: isComplete(),
      wrongGuesses: round.guesses.filter(g => !g.correct),
      board: state.board,
      maxGuesses: max,
    };
  }

  return { guess, next, snapshot };
}

function hydrateRounds(saved, dailyCharacters) {
  const fresh = dailyCharacters.map(c => ({
    charId: c.id,
    guesses: [],
    won: false,
    lost: false,
  }));
  if (!Array.isArray(saved)) return fresh;
  // Match saved entries by charId so a mid-day data tweak doesn't poison
  // someone's session, but order is taken from today's daily list.
  return fresh.map(r => {
    const match = saved.find(s => s?.charId === r.charId);
    if (!match) return r;
    const character = dailyCharacters.find(c => c.id === r.charId);
    const max = maxGuessesFor(character);
    const guesses = Array.isArray(match.guesses) ? match.guesses.filter(isValidGuess) : [];
    return {
      charId: r.charId,
      guesses: guesses.slice(0, max),
      won: !!match.won && guesses.some(g => g.correct),
      lost: !!match.lost && guesses.length >= max && !guesses.some(g => g.correct),
    };
  });
}

function isValidGuess(g) {
  if (!g || typeof g.correct !== 'boolean') return false;
  // grid guess: row + col integers; quad guess: index integer
  if (Number.isInteger(g.index)) return true;
  return Number.isInteger(g.row) && Number.isInteger(g.col);
}

function isRoundDone(round) {
  return !!(round && (round.won || round.lost));
}

function readStorage(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v == null ? fallback : Number(v);
  } catch {
    return fallback;
  }
}

function writeStorage(key, value) {
  try { localStorage.setItem(key, String(value)); } catch { /* private mode */ }
}

function loadDailyState(date) {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.daily(date));
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function saveDailyState(date, data) {
  try {
    localStorage.setItem(STORAGE_KEYS.daily(date), JSON.stringify(data));
  } catch { /* private mode */ }
}

function clampInt(n, lo, hi) {
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, Math.trunc(n)));
}
