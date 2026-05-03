// Daily-mode game state. Plays through every character locked to the UTC
// date. State is in-memory only — refreshing starts a fresh game with the
// correct color rerolled to a new spot. Once we cap players at 3 a day,
// we'll layer per-day persistence back on top to remember solved rounds.
//
// Two board kinds, mixed within the same daily run:
//   grid — 5x5 shade picker, 3 guesses, axis hints after the 2nd miss
//   quad — 4 distinct color swatches, 1 guess, no hints

import { buildGrid } from './grid.js';
import { buildQuad } from './quad.js';

const STORAGE_KEYS = {
  bestStreak: 'wcat:bestStreak',
};

const GRID_MAX_GUESSES = 3;
const QUAD_MAX_GUESSES = 1;
const GRID_SIZE = 5;

export function maxGuessesFor(character) {
  return character?.type === 'item' ? QUAD_MAX_GUESSES : GRID_MAX_GUESSES;
}

export function createDailyGame(dailyCharacters, dateKey) {
  if (!dailyCharacters?.length) throw new Error('createDailyGame: no characters');

  const state = {
    date: dateKey,
    characters: dailyCharacters,
    rounds: dailyCharacters.map(c => ({
      charId: c.id,
      guesses: [],
      won: false,
      lost: false,
    })),
    currentIndex: 0,
    streak: 0,
    bestStreak: clampInt(readStorage(STORAGE_KEYS.bestStreak, 0), 0, 9999),
    board: null,
    revealed: false,
  };

  loadCurrent();

  function loadCurrent() {
    const c = state.characters[state.currentIndex];
    // Fresh seed every load so the correct cell rotates around the grid
    // instead of being pinned to the same row/column for a character.
    const seed = Math.floor(Math.random() * 0x100000000);
    if (c.type === 'item') {
      state.board = buildQuad(c.color.hex, { seed });
    } else {
      state.board = {
        kind: 'grid',
        ...buildGrid(c.color.hex, { rows: GRID_SIZE, cols: GRID_SIZE, seed }),
      };
    }
    state.revealed = false;
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
      return { kind: 'correct', cell };
    }
    if (round.guesses.length >= currentMaxGuesses()) {
      round.lost = true;
      state.revealed = true;
      state.streak = 0;
      return { kind: 'exhausted', correctCell: correctCell() };
    }
    return { kind: 'wrong', cell, guessesLeft: currentMaxGuesses() - round.guesses.length };
  }

  function next() {
    if (state.currentIndex >= state.characters.length - 1) {
      return { kind: 'finished' };
    }
    state.currentIndex += 1;
    loadCurrent();
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

function clampInt(n, lo, hi) {
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, Math.trunc(n)));
}
