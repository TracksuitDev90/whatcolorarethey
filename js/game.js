// Game state machine. Pure-ish: no DOM access. Persists best streak +
// resume index via localStorage so a refresh mid-game picks up where left off.

import { buildGrid } from './grid.js';

const STORAGE_KEYS = {
  bestStreak: 'wcat:bestStreak',
  resumeRound: 'wcat:lastRoundIndex',
};

const MAX_GUESSES = 3;

export function createGame(characters) {
  if (!characters?.length) throw new Error('createGame: no characters');

  const state = {
    characters,
    roundIndex: clampInt(readStorage(STORAGE_KEYS.resumeRound, 0), 0, characters.length - 1),
    streak: 0,
    bestStreak: clampInt(readStorage(STORAGE_KEYS.bestStreak, 0), 0, 9999),
    guessesLeft: MAX_GUESSES,
    revealed: false,
    finished: false,
    wrongCells: [], // [{row, col}]
    grid: null,
    character: null,
  };

  function loadRound(i) {
    state.roundIndex = i;
    state.guessesLeft = MAX_GUESSES;
    state.revealed = false;
    state.wrongCells = [];
    state.character = state.characters[i];
    state.grid = buildGrid(state.character.color.hex, {
      rows: 6,
      cols: 6,
      seed: i + 1,
    });
    writeStorage(STORAGE_KEYS.resumeRound, i);
  }

  function guess(row, col) {
    if (state.revealed || state.finished) return { kind: 'noop' };
    const cell = state.grid.cells[row][col];
    if (cell.isCorrect) {
      state.revealed = true;
      state.streak += 1;
      if (state.streak > state.bestStreak) {
        state.bestStreak = state.streak;
        writeStorage(STORAGE_KEYS.bestStreak, state.bestStreak);
      }
      return { kind: 'correct', cell };
    }
    state.wrongCells.push({ row, col });
    state.guessesLeft -= 1;
    if (state.guessesLeft <= 0) {
      state.revealed = true;
      state.streak = 0;
      return { kind: 'exhausted', correctCell: correctCell() };
    }
    return { kind: 'wrong', cell, guessesLeft: state.guessesLeft };
  }

  function next() {
    const last = state.characters.length - 1;
    if (state.roundIndex >= last) {
      state.finished = true;
      writeStorage(STORAGE_KEYS.resumeRound, 0);
      return { kind: 'finished' };
    }
    loadRound(state.roundIndex + 1);
    return { kind: 'round', round: state.roundIndex };
  }

  function restart() {
    state.streak = 0;
    state.finished = false;
    loadRound(0);
  }

  function correctCell() {
    return state.grid.cells[state.grid.correctRow][state.grid.correctCol];
  }

  function snapshot() {
    return {
      roundIndex: state.roundIndex,
      totalRounds: state.characters.length,
      streak: state.streak,
      bestStreak: state.bestStreak,
      guessesLeft: state.guessesLeft,
      revealed: state.revealed,
      finished: state.finished,
      wrongCells: state.wrongCells.slice(),
      grid: state.grid,
      character: state.character,
    };
  }

  loadRound(state.roundIndex);
  return { guess, next, restart, snapshot };
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

function clampInt(n, lo, hi) {
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, Math.trunc(n)));
}
