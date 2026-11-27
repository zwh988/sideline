// Puzzle results on this device (task 3.2): one record per puzzle tried, kept
// in localStorage and in the backup file. Progress per theme and the choice of
// the next puzzle read it.
import type { StorageLike } from './store';
import { POOL_THEMES, type Puzzle } from './puzzlepool';

export interface PuzzleResult {
  id: string;
  rating: number;
  /** The puzzle's pool themes (so progress per theme needs no pool file). */
  themes: string[];
  /** Times started (a skip counts). */
  tries: number;
  /** Times solved. */
  solved: number;
  /** Times solved with no wrong move and fewer than 3 hints (spec: solved after hint 3 is not mastered). */
  clean: number;
  /** Wrong moves, over all tries. */
  misses: number;
  /** The most hint steps used in one try. */
  hintsMax: number;
  lastAt: number;
  /** How the latest try went. */
  last: 'clean' | 'solved' | 'skipped';
}

/** What happened in one try of a puzzle. */
export interface Attempt {
  solved: boolean;
  misses: number;
  hints: number;
}

export const isClean = (a: Attempt): boolean => a.solved && a.misses === 0 && a.hints < 3;

const KEY = 'sideline.puzzles';
const POOL = new Set<string>(POOL_THEMES);

export class PuzzleResults {
  private cache?: Map<string, PuzzleResult>;

  constructor(private storage: StorageLike | undefined = browserStorage()) {}

  private load(): Map<string, PuzzleResult> {
    if (this.cache) return this.cache;
    let list: unknown = [];
    try {
      list = JSON.parse(this.storage?.getItem(KEY) ?? '[]');
    } catch {
      /* damaged or blocked: start empty */
    }
    this.cache = new Map((Array.isArray(list) ? list : []).filter(isResult).map((r) => [r.id, r]));
    return this.cache;
  }

  private write(): void {
    try {
      this.storage?.setItem(KEY, JSON.stringify([...this.load().values()]));
    } catch {
      /* full or blocked: the results of this session stay in memory */
    }
  }

  get(id: string): PuzzleResult | undefined {
    return this.load().get(id);
  }

  all(): PuzzleResult[] {
    return [...this.load().values()];
  }

  /** Adds one try of `p`. */
  record(p: Puzzle, a: Attempt, now = Date.now()): PuzzleResult {
    const map = this.load();
    const r = map.get(p.id) ?? { id: p.id, rating: p.rating, themes: p.themes.filter((t) => POOL.has(t)), tries: 0, solved: 0, clean: 0, misses: 0, hintsMax: 0, lastAt: now, last: 'skipped' as const };
    r.tries++;
    if (a.solved) r.solved++;
    if (isClean(a)) r.clean++;
    r.misses += a.misses;
    r.hintsMax = Math.max(r.hintsMax, a.hints);
    r.lastAt = now;
    r.last = isClean(a) ? 'clean' : a.solved ? 'solved' : 'skipped';
    map.set(p.id, r);
    this.write();
    return r;
  }

  /** Per theme, within a rating band: puzzles solved, and puzzles missed at least once. */
  progress(themes: readonly string[], band: [number, number]): Map<string, { solved: number; missed: number }> {
    const out = new Map(themes.map((t) => [t, { solved: 0, missed: 0 }]));
    for (const r of this.load().values()) {
      if (r.rating < band[0] || r.rating >= band[1]) continue;
      for (const t of r.themes) {
        const c = out.get(t);
        if (!c) continue;
        if (r.solved) c.solved++;
        if (r.misses) c.missed++;
      }
    }
    return out;
  }

  /** Adds the results of a backup: a puzzle tried in both keeps the one tried last. Returns how many were taken. */
  importAll(list: unknown): number {
    if (!Array.isArray(list)) return 0;
    const map = this.load();
    let n = 0;
    for (const r of list) {
      if (!isResult(r)) continue;
      const have = map.get(r.id);
      if (have && have.lastAt >= r.lastAt) continue;
      map.set(r.id, r);
      n++;
    }
    if (n) this.write();
    return n;
  }
}

function isResult(x: unknown): x is PuzzleResult {
  const r = x as Partial<PuzzleResult> | null;
  return !!r && typeof r.id === 'string' && typeof r.rating === 'number' && Array.isArray(r.themes) && typeof r.tries === 'number' && typeof r.solved === 'number' && typeof r.misses === 'number';
}

function browserStorage(): StorageLike | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}
