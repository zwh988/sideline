// Checks the built pool (public/puzzles/pool/, from `npm run puzzle-pool`).
import { Chess } from 'chess.js';
import { describe, expect, it } from 'vitest';
import { LEVELS } from './levels';
import { POOL_BANDS, POOL_THEMES, bandFile, coachSet, decodeBand, type BandFile, type Puzzle } from './puzzlepool';

const files = import.meta.glob<{ default: BandFile }>('/public/puzzles/pool/*-*.json', { eager: true });
const index = import.meta.glob<{ default: { files: { file: string; gzipBytes: number; bytes: number }[] } }>('/public/puzzles/pool/index.json', { eager: true });
const fileOf = (band: [number, number]) => files[`/public/${bandFile(band)}`]?.default;

describe('the built puzzle pool', () => {
  it('has one file per band, each holding only that band', () => {
    expect(Object.keys(files)).toHaveLength(POOL_BANDS.length);
    for (const band of POOL_BANDS) {
      const f = fileOf(band);
      expect(f, band.join('-')).toBeDefined();
      expect(f.band).toEqual(band);
      expect(f.puzzles.length).toBeGreaterThan(1000);
      for (const p of decodeBand(f)) expect(p.rating >= band[0] && p.rating < band[1], p.id).toBe(true);
    }
  });

  const all: Puzzle[] = POOL_BANDS.flatMap((b) => decodeBand(fileOf(b)));

  it('stores every puzzle once, and each has a pool theme', () => {
    expect(new Set(all.map((p) => p.id)).size).toBe(all.length);
    const pool = new Set<string>(POOL_THEMES);
    expect(all.every((p) => p.themes.some((t) => pool.has(t)))).toBe(true);
  });

  it("has every theme of every coach's set in that coach's band (at least 100 each)", () => {
    for (const l of LEVELS) {
      for (const t of l.specialty.puzzleThemes) {
        const n = coachSet(all, { specialty: { puzzleThemes: [t] }, puzzleBand: l.puzzleBand }).length;
        expect(n, `${l.coach.name}: ${t} in ${l.puzzleBand.join('-')}`).toBeGreaterThanOrEqual(100);
      }
    }
  });

  it('holds legal puzzles (every 20th checked move by move)', () => {
    for (let i = 0; i < all.length; i += 20) {
      const p = all[i];
      const chess = new Chess(p.fen);
      for (const m of p.moves) expect(() => chess.move({ from: m.slice(0, 2), to: m.slice(2, 4), promotion: m[4] }), `${p.id} ${m}`).not.toThrow();
      expect(p.moves.length % 2, p.id).toBe(0); // the opponent's move, then the solver's moves and replies
    }
  });

  it('stays a few MB compressed (the server gzips it)', () => {
    const info = Object.values(index)[0].default.files;
    const gz = info.reduce((s, f) => s + f.gzipBytes, 0);
    expect(gz).toBeLessThan(5 * 1024 * 1024);
    for (const f of info) expect(f.gzipBytes, f.file).toBeLessThan(700 * 1024);
  });
});
