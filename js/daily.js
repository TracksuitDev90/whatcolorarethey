// Daily-puzzle helpers. The set of three characters and each round's grid
// seed are derived from the UTC date, so every player worldwide sees the
// same puzzle until UTC midnight rolls over to the next day.

const CHARACTERS_PER_DAY = 3;

// Day 0 of the rotation. Day index 0 picks the first slice of the pool;
// each subsequent day advances by CHARACTERS_PER_DAY so every entry surfaces
// once before any repeat. New characters appended later don't disturb the
// already-played schedule — they only show up on later days.
const ROTATION_EPOCH = '2026-05-09';

export function getUtcDateKey(now = new Date()) {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// FNV-1a — small, stable, plenty for seeding.
export function hashString(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function parseUtcDateKey(key) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) return Date.UTC(2026, 4, 9);
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function daysBetween(fromKey, toKey) {
  const ms = parseUtcDateKey(toKey) - parseUtcDateKey(fromKey);
  return Math.floor(ms / 86400000);
}

function shuffleSeeded(items, seed) {
  const out = items.slice();
  const rng = mulberry32(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// Walks deterministically through the pool, `count` per day starting from
// ROTATION_EPOCH. Within a single cycle every entry appears exactly once
// before any repeat. Each subsequent cycle uses a different seeded shuffle
// so re-runs of the deck don't feel identical.
export function pickDailyCharacters(allCharacters, dateKey, count = CHARACTERS_PER_DAY) {
  if (!allCharacters?.length) return [];
  const len = allCharacters.length;
  const dayIndex = Math.max(0, daysBetween(ROTATION_EPOCH, dateKey));
  let offset = dayIndex * count;
  const baseOrder = allCharacters.slice();

  const result = [];
  while (result.length < Math.min(count, len)) {
    const cycle = Math.floor(offset / len);
    const within = offset % len;
    const ordered = cycle === 0
      ? baseOrder
      : shuffleSeeded(baseOrder, hashString(`rotation:cycle:${cycle}`));
    result.push(ordered[within]);
    offset += 1;
  }
  return result;
}

// Non-deterministic Fisher-Yates. Used for the live game so every visit
// reshuffles the round order rather than locking everyone to the same daily
// sequence.
export function shuffleCharacters(allCharacters) {
  if (!allCharacters?.length) return [];
  const pool = allCharacters.slice();
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool;
}

export function msUntilNextUtcDay(now = new Date()) {
  const next = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
  );
  return Math.max(0, next - now.getTime());
}

export function formatCountdown(ms) {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
