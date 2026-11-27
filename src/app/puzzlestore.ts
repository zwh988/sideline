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
const LEVELS_KEY = 'sideline.puzzleLevels';
/** Clean solves of a theme that count as mastering it (task 3.2b). */
export const MASTERY_GOAL = 10;

/** The player's level in a theme (task 3.2b), with when it last changed (a backup merge keeps the later one). */
export interface ThemeLevel {
  level: number;
  at: number;
}
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

  /** Per theme: how many of its puzzles were solved cleanly at least once (any rating), toward `MASTERY_GOAL`. */
  mastery(themes: readonly string[]): Map<string, number> {
    const out = new Map(themes.map((t) => [t, 0]));
    for (const r of this.load().values()) {
      if (!r.clean) continue;
      for (const t of r.themes) if (out.has(t)) out.set(t, out.get(t)! + 1);
    }
    return out;
  }

  private levelCache?: Record<string, ThemeLevel>;

  private levels(): Record<string, ThemeLevel> {
    if (this.levelCache) return this.levelCache;
    let raw: unknown;
    try {
      raw = JSON.parse(this.storage?.getItem(LEVELS_KEY) ?? '{}');
    } catch {
      raw = {};
    }
    const out: Record<string, ThemeLevel> = {};
    if (raw && typeof raw === 'object') {
      for (const [t, v] of Object.entries(raw as Record<string, unknown>)) {
        const l = v as Partial<ThemeLevel> | null;
        if (l && typeof l.level === 'number' && typeof l.at === 'number') out[t] = { level: l.level, at: l.at };
      }
    }
    return (this.levelCache = out);
  }

  /** The player's level in a theme, or `start` when it was never played. */
  levelOf(theme: string, start: number): number {
    return this.levels()[theme]?.level ?? start;
  }

  setLevel(theme: string, level: number, now = Date.now()): void {
    this.levels()[theme] = { level, at: now };
    try {
      this.storage?.setItem(LEVELS_KEY, JSON.stringify(this.levels()));
    } catch {
      /* the level of this session stays in memory */
    }
  }

  allLevels(): Record<string, ThemeLevel> {
    return { ...this.levels() };
  }

  /** Adds the levels of a backup: per theme, the one changed last wins. */
  importLevels(data: unknown): void {
    if (!data || typeof data !== 'object') return;
    const mine = this.levels();
    for (const [t, v] of Object.entries(data as Record<string, unknown>)) {
      const l = v as Partial<ThemeLevel> | null;
      if (!l || typeof l.level !== 'number' || typeof l.at !== 'number') continue;
      if (!mine[t] || mine[t].at < l.at) this.setLevel(t, l.level, l.at);
    }
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
