/**
 * Deterministic helpers for demo data: a seeded PRNG and date-only arithmetic.
 *
 * Demo rows must be identical on every run (Convex seed, the in-browser demo
 * and gate scripts all build them), so nothing here reads Math.random. Seeds
 * are derived from stable string keys ("payroll:2025-07") so adding rows to one
 * stream or one month never reshuffles another.
 */

/** 32-bit FNV-1a hash of a string, used to turn a key into a PRNG seed. */
export function hashSeed(key: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export type Rng = {
  /** Uniform float in [0, 1). */
  next(): number;
  /** Integer in [min, max] inclusive. */
  int(min: number, max: number): number;
  /** Amount in cents between two dollar figures, rounded to the cent. */
  cents(minDollars: number, maxDollars: number): number;
  chance(probability: number): boolean;
  pick<T>(items: readonly T[]): T;
};

/** mulberry32: small, fast and good enough for demo data. */
export function createRng(key: string): Rng {
  let state = hashSeed(key) || 1;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    cents: (minDollars, maxDollars) => Math.round((minDollars + next() * (maxDollars - minDollars)) * 100),
    chance: (probability) => next() < probability,
    pick: (items) => items[Math.floor(next() * items.length)],
  };
}

const DAY_MS = 24 * 60 * 60 * 1000;

function toUtc(iso: string): number {
  return Date.parse(`${iso.slice(0, 10)}T00:00:00.000Z`);
}

/** Add whole days to a YYYY-MM-DD date. */
export function addDays(iso: string, days: number): string {
  return new Date(toUtc(iso) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  return Math.round((toUtc(to) - toUtc(from)) / DAY_MS);
}

/** YYYY-MM keys from the month of `start` through the month of `end`. */
export function monthKeys(start: string, end: string): string[] {
  const keys: string[] = [];
  let year = Number(start.slice(0, 4));
  let month = Number(start.slice(5, 7));
  const endKey = end.slice(0, 7);
  for (;;) {
    const key = `${year}-${String(month).padStart(2, "0")}`;
    if (key > endKey) break;
    keys.push(key);
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return keys;
}

export function daysInMonth(monthKey: string): number {
  const year = Number(monthKey.slice(0, 4));
  const month = Number(monthKey.slice(5, 7));
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** A day within a month, clamped to the month length. */
export function dayOfMonth(monthKey: string, day: number): string {
  return `${monthKey}-${String(Math.min(Math.max(1, day), daysInMonth(monthKey))).padStart(2, "0")}`;
}

/** 0 = Sunday … 6 = Saturday. */
export function weekday(iso: string): number {
  return new Date(toUtc(iso)).getUTCDay();
}

/** Move weekend dates to the following Monday (bank posting days). */
export function nextBusinessDay(iso: string): string {
  const day = weekday(iso);
  if (day === 6) return addDays(iso, 2);
  if (day === 0) return addDays(iso, 1);
  return iso;
}

/**
 * The demo story is written as of a fixed date; when the real clock is later
 * the story's "today" follows the clock, so recent activity (pending card
 * holds, this week's e-transfers) always sits in the last few days.
 */
export function demoAsOfDate(storyDate: string, today: string): string {
  return today > storyDate ? today : storyDate;
}
