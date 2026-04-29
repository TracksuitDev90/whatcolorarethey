// Daily-mode game state. Three rounds locked to the UTC date, with
// per-round guess history persisted to localStorage so refreshing
// preserves progress until the next UTC day.

import { buildGrid } from './grid.js';
import { gridSeedFor } from './daily.js';

const STORAGE_KEYS = {
  bestStreak: 'wcat:bestStreak',
  daily: (date) => `wcat:daily:${date}`,
};

const MAX_GUESSES = 3;
const GRID_SIZE = 5;

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
    grid: null,
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
    state.grid = buildGrid(c.color.hex, {
      rows: GRID_SIZE,
      cols: GRID_SIZE,
      seed: gridSeedFor(state.date, c.id),
    });
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

  function guess(row, col) {
    if (state.revealed || isComplete()) return { kind: 'noop' };
    const round = state.rounds[state.currentIndex];
    const cell = state.grid.cells[row][col];
    round.guesses.push({ row, col, correct: cell.isCorrect });
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
    if (round.guesses.length >= MAX_GUESSES) {
      round.lost = true;
      state.revealed = true;
      state.streak = 0;
      persist();
      return { kind: 'exhausted', correctCell: correctCell() };
    }
    persist();
    return { kind: 'wrong', cell, guessesLeft: MAX_GUESSES - round.guesses.length };
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

  function correctCell() {
    return state.grid.cells[state.grid.correctRow][state.grid.correctCol];
  }

  function isComplete() {
    return state.rounds.every(isRoundDone);
  }

  function snapshot() {
    const round = state.rounds[state.currentIndex];
    return {
      date: state.date,
      characters: state.characters,
      character: state.characters[state.currentIndex],
      rounds: state.rounds,
      roundIndex: state.currentIndex,
      totalRounds: state.characters.length,
      streak: state.streak,
      bestStreak: state.bestStreak,
      guessesLeft: MAX_GUESSES - round.guesses.length,
      revealed: state.revealed,
      finished: isComplete(),
      wrongCells: round.guesses.filter(g => !g.correct).map(g => ({ row: g.row, col: g.col })),
      grid: state.grid,
      maxGuesses: MAX_GUESSES,
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
    const guesses = Array.isArray(match.guesses) ? match.guesses.filter(isValidGuess) : [];
    return {
      charId: r.charId,
      guesses: guesses.slice(0, MAX_GUESSES),
      won: !!match.won && guesses.some(g => g.correct),
      lost: !!match.lost && guesses.length >= MAX_GUESSES && !guesses.some(g => g.correct),
    };
  });
}

function isValidGuess(g) {
  return g
    && Number.isInteger(g.row)
    && Number.isInteger(g.col)
    && typeof g.correct === 'boolean';
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
