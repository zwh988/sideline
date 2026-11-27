// Choosing the puzzle pool from the Lichess database rows (build time only;
// scripts/build-puzzle-pool.mjs feeds it the CSV). Pure, so the filters are
// tested on a small fixture (puzzlepool.test.ts).
import { POOL_BANDS, POOL_THEMES, type Puzzle } from './puzzlepool';

export interface PoolOptions {
  themes: readonly string[];
  bands: [number, number][];
  /** Puzzles kept per theme × band. */
  perBucket: number;
  /** Quality: Lichess popularity (−100…100) at least this. */
  minPopularity: number;
  /** Quality: played at least this many times. */
  minPlays: number;
  /** Quality: rating deviation at most this (a settled rating). */
  maxDeviation: number;
  seed: number;
}

export const POOL_OPTIONS: PoolOptions = {
  themes: POOL_THEMES,
  bands: POOL_BANDS,
  perBucket: 300,
  minPopularity: 85,
  minPlays: 300,
  maxDeviation: 90,
  seed: 20261127,
};

/** The database's CSV columns: PuzzleId,FEN,Moves,Rating,RatingDeviation,Popularity,NbPlays,Themes,GameUrl,OpeningTags. */
export type CsvRow = string[];

/**
 * A puzzle's sampling key: a seeded hash of its id (FNV-1a, then a murmur3 finaliser), in [0, 1).
 * Every bucket keeps its puzzles with the smallest keys, so each bucket is a uniform sample,
 * the result does not depend on the row order, and a puzzle that wins in one of its themes
 * tends to win in the others too (stored once: a smaller pool).
 */
export function sampleKey(id: string, seed: number): number {
  let h = (0x811c9dc5 ^ seed) >>> 0;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 0x01000193);
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

interface Bucket { seen: number; items: Puzzle[]; keys: number[]; maxAt: number }

/**
 * Bottom-k sampling per theme × band over the quality-filtered rows (`sampleKey`): every passing
 * puzzle of a bucket is equally likely to stay. A puzzle in several buckets is one object, stored once.
 */
export class PoolBuilder {
  readonly buckets = new Map<string, Bucket>();
  rows = 0;
  passed = 0;
  private readonly wanted: Set<string>;

  constructor(readonly opts: PoolOptions = POOL_OPTIONS) {
    this.wanted = new Set(opts.themes);
  }

  bandOf(rating: number): number {
    return this.opts.bands.findIndex(([lo, hi]) => rating >= lo && rating < hi);
  }

  add(row: CsvRow): void {
    this.rows++;
    const [id, fen, moves, rating, rd, popularity, plays, themes, , openingTags] = row;
    if (!id || !fen || !moves || !themes) return;
    const r = Number(rating);
    if (Number(rd) > this.opts.maxDeviation || Number(popularity) < this.opts.minPopularity || Number(plays) < this.opts.minPlays) return;
    const band = this.bandOf(r);
    if (band < 0) return;
    const list = themes.split(' ');
    let rec: Puzzle | undefined;
    let key = -1;
    for (const theme of list) {
      if (!this.wanted.has(theme)) continue;
      if (key < 0) { this.passed++; key = sampleKey(id, this.opts.seed); }
      const name = `${theme}|${band}`;
      let b = this.buckets.get(name);
      if (!b) this.buckets.set(name, (b = { seen: 0, items: [], keys: [], maxAt: 0 }));
      b.seen++;
      const full = b.items.length >= this.opts.perBucket;
      if (full && key >= b.keys[b.maxAt]) continue;
      rec ??= { id, fen, moves: moves.split(' '), rating: r, themes: list, openings: openingTags ? openingTags.split(' ') : [] };
      if (full) {
        b.items[b.maxAt] = rec;
        b.keys[b.maxAt] = key;
      } else {
        b.items.push(rec);
        b.keys.push(key);
      }
      if (b.items.length >= this.opts.perBucket) {
        let m = 0;
        for (let i = 1; i < b.keys.length; i++) if (b.keys[i] > b.keys[m]) m = i;
        b.maxAt = m;
      }
    }
  }

  /** The kept puzzles per band (index into `opts.bands`), each once, in a stable order (rating, then id). */
  result(): Puzzle[][] {
    const out = this.opts.bands.map(() => new Map<string, Puzzle>());
    for (const [key, b] of this.buckets) {
      const band = Number(key.slice(key.indexOf('|') + 1));
      for (const p of b.items) out[band].set(p.id, p);
    }
    return out.map((m) => [...m.values()].sort((a, b) => a.rating - b.rating || (a.id < b.id ? -1 : 1)));
  }

  /** Kept / passing per theme and band, for the build log and the index file. */
  counts(): Record<string, number[]> {
    const counts: Record<string, number[]> = {};
    for (const t of this.opts.themes) counts[t] = this.opts.bands.map((_, i) => this.buckets.get(`${t}|${i}`)?.items.length ?? 0);
    return counts;
  }
}
