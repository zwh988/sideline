// Opening progress on this device (task 6.2): which player moves of each
// course are learned, and the lesson in progress (the Continue card). Kept in
// localStorage and in the backup file; Drill (6.3) builds its cards on it.
//
// A move is keyed by its path from the start (UCI moves), not its node id, so
// a rebuilt course file keeps the progress of the moves it still has. A move
// is the same move with every coach (the trees nest), so progress is per
// course; the tier it was learned with is kept for Drill's cards.
import type { StorageLike } from './store';

export interface LearnedMove {
  /** The coach tier it was learned with. */
  tier: number;
  /** The move's own tier in the course (the lowest coach that teaches it), so the tab counts without the file. */
  node: number;
  at: number;
}

/** A lesson started and not finished: Continue starts that line again (its learned moves play by themselves). */
export interface CurrentLesson {
  course: string;
  tier: number;
  /** The line's key (`CourseLine.key`). */
  line: string;
  at: number;
}

interface Saved {
  version: 1;
  learned: Record<string, Record<string, LearnedMove>>;
  current?: CurrentLesson;
}

const KEY = 'sideline.openings';

export class OpeningProgress {
  private cache?: Saved;

  constructor(private storage: StorageLike | undefined = browserStorage()) {}

  private load(): Saved {
    if (this.cache) return this.cache;
    let s: Saved = { version: 1, learned: {} };
    try {
      const raw = JSON.parse(this.storage?.getItem(KEY) ?? 'null');
      if (raw && typeof raw === 'object' && raw.learned && typeof raw.learned === 'object') s = { version: 1, learned: raw.learned, current: raw.current };
    } catch {
      /* damaged or blocked: start empty */
    }
    return (this.cache = s);
  }

  private write(): void {
    try {
      this.storage?.setItem(KEY, JSON.stringify(this.load()));
    } catch {
      /* full or blocked: kept for this visit only */
    }
  }

  isLearned(course: string, key: string): boolean {
    return !!this.load().learned[course]?.[key];
  }

  /** Marks a move learned (the first time only: the tier and date it was first learned stay). */
  learn(course: string, key: string, tier: number, nodeTier: number, at = Date.now()): void {
    const all = this.load().learned;
    const c = (all[course] ??= {});
    if (c[key]) return;
    c[key] = { tier, node: nodeTier, at };
    this.write();
  }

  /** Learned moves of a course that a coach of this tier teaches. */
  countFor(course: string, tier: number): number {
    return Object.values(this.learned(course)).filter((m) => m.node <= tier).length;
  }

  /** The learned moves of a course (path key → when and with which coach). */
  learned(course: string): Record<string, LearnedMove> {
    return this.load().learned[course] ?? {};
  }

  get current(): CurrentLesson | undefined {
    return this.load().current;
  }

  setCurrent(c: CurrentLesson | undefined): void {
    this.load().current = c;
    this.write();
  }

  /** For the backup file. */
  all(): Saved['learned'] {
    return this.load().learned;
  }

  /** Merges a backup's progress in (a move learned in either is learned; the earlier date wins). Returns moves added. */
  importAll(data: unknown): number {
    if (!data || typeof data !== 'object') return 0;
    let added = 0;
    const all = this.load().learned;
    for (const [course, moves] of Object.entries(data as Record<string, unknown>)) {
      if (!moves || typeof moves !== 'object') continue;
      const c = (all[course] ??= {});
      for (const [key, v] of Object.entries(moves as Record<string, unknown>)) {
        const m = v as Partial<LearnedMove>;
        if (typeof m?.tier !== 'number' || typeof m.node !== 'number' || typeof m.at !== 'number') continue;
        if (!c[key]) added++;
        if (!c[key] || m.at < c[key].at) c[key] = { tier: m.tier, node: m.node, at: m.at };
      }
    }
    this.write();
    return added;
  }
}

function browserStorage(): StorageLike | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}
