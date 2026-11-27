// Choosing the next puzzle of a coach's set (task 3.2): unseen puzzles first,
// a little harder after a run of clean solves and easier after misses, always
// within the coach's band.
import type { PuzzleResult } from './puzzlestore';
import type { Puzzle } from './puzzlepool';

/** Where in the band a session starts (0 = the band's bottom, 1 = its top). */
export const START_AT = 0.3;
/** Rating points up per clean solve in a row (up to `MAX_STREAK`), and down per miss among the last five tries. */
export const STEP_UP = 40;
export const STEP_DOWN = 60;
const MAX_STREAK = 5;
/** The next puzzle is picked at random among this many closest to the target. */
const NEAREST = 8;

/** The rating to aim at, from this session's tries (true = clean, newest last). */
export function targetRating(band: [number, number], recent: boolean[]): number {
  const [lo, hi] = band;
  let streak = 0;
  for (let i = recent.length - 1; i >= 0 && recent[i]; i--) streak++;
  const misses = recent.slice(-5).filter((c) => !c).length;
  const t = lo + START_AT * (hi - lo) + STEP_UP * Math.min(streak, MAX_STREAK) - STEP_DOWN * misses;
  return Math.max(lo, Math.min(hi - 1, t));
}

/**
 * The next puzzle from `set`: never one played this session (`exclude`); first those never tried, then
 * those not yet solved cleanly, then any. Among them, one of the closest to the target rating.
 */
export function choosePuzzle(
  set: Puzzle[],
  result: (id: string) => PuzzleResult | undefined,
  opts: { band: [number, number]; recent: boolean[]; exclude: Set<string>; rand?: () => number },
): Puzzle | undefined {
  const rand = opts.rand ?? Math.random;
  const open = set.filter((p) => !opts.exclude.has(p.id));
  const tiers = [
    open.filter((p) => !result(p.id)),
    open.filter((p) => !result(p.id)?.clean),
    open,
  ];
  const pool = tiers.find((t) => t.length);
  if (!pool) return undefined;
  const target = targetRating(opts.band, opts.recent);
  const nearest = [...pool].sort((a, b) => Math.abs(a.rating - target) - Math.abs(b.rating - target) || (a.id < b.id ? -1 : 1)).slice(0, NEAREST);
  return nearest[Math.floor(rand() * nearest.length)];
}
