// Choosing the next puzzle (tasks 3.2, 3.2b): each theme keeps the player's own level, which starts in the
// coach's band and moves with the results, anywhere from 400 to 2200 (the coach's band is only the start).
// The next puzzle of a theme is one near that level: unseen first, then one not yet solved cleanly.
import { isClean, type Attempt, type PuzzleResult } from './puzzlestore';
import type { Puzzle } from './puzzlepool';

export const LEVEL_MIN = 400;
export const LEVEL_MAX = 2199;
/** Where in the coach's band a theme's level starts (0 = the band's bottom, 1 = its top). */
export const START_AT = 0.3;
/** How a try moves the theme's level: a clean solve, a solve with a miss or 3+ hints, not solved (skipped). */
export const LEVEL_STEP = { clean: 50, solved: -20, unsolved: -50 } as const;
/** The next puzzle is picked at random among this many closest to the level. */
const NEAREST = 8;

const clamp = (n: number) => Math.max(LEVEL_MIN, Math.min(LEVEL_MAX, Math.round(n)));

/** A theme's first level with a coach: 30% into the coach's band (never under 400). */
export function startLevel(band: [number, number]): number {
  const lo = Math.max(band[0], LEVEL_MIN);
  return clamp(lo + START_AT * (band[1] - lo));
}

/** The theme's level after a try. */
export function nextLevel(level: number, a: Attempt): number {
  return clamp(level + (isClean(a) ? LEVEL_STEP.clean : a.solved ? LEVEL_STEP.solved : LEVEL_STEP.unsolved));
}

/** In a mixed session: the coach's theme played least so far this session (ties at random). */
export function pickTheme(themes: readonly string[], played: Map<string, number>, rand = Math.random): string {
  const fewest = Math.min(...themes.map((t) => played.get(t) ?? 0));
  const open = themes.filter((t) => (played.get(t) ?? 0) === fewest);
  return open[Math.floor(rand() * open.length)];
}

/**
 * The next puzzle from `set` (one theme's puzzles): never one played this session (`exclude`); first those
 * never tried, then those not yet solved cleanly, then any. Among them, one of the closest to `target`.
 */
export function choosePuzzle(
  set: Puzzle[],
  result: (id: string) => PuzzleResult | undefined,
  opts: { target: number; exclude: Set<string>; rand?: () => number },
): Puzzle | undefined {
  const rand = opts.rand ?? Math.random;
  const open = set.filter((p) => !opts.exclude.has(p.id));
  const tiers = [open.filter((p) => !result(p.id)), open.filter((p) => !result(p.id)?.clean), open];
  const pool = tiers.find((t) => t.length);
  if (!pool) return undefined;
  const nearest = [...pool].sort((a, b) => Math.abs(a.rating - opts.target) - Math.abs(b.rating - opts.target) || (a.id < b.id ? -1 : 1)).slice(0, NEAREST);
  return nearest[Math.floor(rand() * nearest.length)];
}
