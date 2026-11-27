import { describe, expect, it } from 'vitest';
import { DETECTABLE, NOT_YET } from '../coach/concepts';
import { LEVELS } from './levels';
import { FIXTURE_ROWS } from './puzzlepool-fixture';
import { PoolBuilder, POOL_OPTIONS, sampleKey, type PoolOptions } from './puzzlepool-build';
import { POOL_BANDS, POOL_THEMES, bandFile, bandsFor, byTheme, coachSet, decodeBand, encodeBand } from './puzzlepool';

const OPTS: PoolOptions = {
  themes: ['advancedPawn', 'quietMove', 'defensiveMove', 'mateIn1', 'mateIn2', 'mateIn3', 'fork', 'pawnEndgame', 'discoveredAttack'],
  bands: [[0, 1000], [1000, 1500]],
  perBucket: 2,
  minPopularity: 85,
  minPlays: 100,
  maxDeviation: 90,
  seed: 1,
};

const build = (opts: PoolOptions, rows = FIXTURE_ROWS) => {
  const b = new PoolBuilder(opts);
  for (const r of rows) b.add(r);
  return b;
};
const ids = (list: { id: string }[]) => list.map((p) => p.id).sort();

describe('puzzle pool: choosing from the database (task 3.1)', () => {
  it('keeps only well-liked, often-played puzzles with a settled rating', () => {
    const b = build(OPTS);
    const kept = new Set(b.result().flat().map((p) => p.id));
    expect(kept.has('U2aN7')).toBe(false); // popularity 66
    expect(kept.has('U2upj')).toBe(false); // popularity 82
    expect(kept.has('U2xn1')).toBe(false); // 65 plays
    expect(kept.has('U2ejK')).toBe(false); // rating deviation 106
    expect(b.passed).toBe(11);
    expect(b.rows).toBe(FIXTURE_ROWS.length);
  });

  it('files each puzzle under its rating band and drops ratings outside every band', () => {
    const [low, high] = build(OPTS).result();
    expect(ids(low)).toEqual(['U2YyE', 'U2dEB', 'U2tFf']);
    expect(ids(high)).toEqual(['U2MZc', 'U2PG5', 'U2Qb0', 'U2gbk', 'U2ksJ', 'U2oI6', 'U2pdQ', 'U2zKt']);
    expect(low.every((p) => p.rating < 1000) && high.every((p) => p.rating >= 1000 && p.rating < 1500)).toBe(true);
    expect([...low, ...high].some((p) => p.id === 'U2TaL')).toBe(false); // 1887
  });

  it('samples by theme: a puzzle with none of the themes is not kept', () => {
    const b = build({ ...OPTS, themes: ['fork'] });
    expect(ids(b.result().flat())).toEqual(['U2Qb0']);
  });

  it('stores a puzzle once even when several of its themes chose it, and keeps all its themes', () => {
    const b = build(OPTS);
    const high = b.result()[1];
    expect(high.filter((p) => p.id === 'U2pdQ')).toHaveLength(1);
    expect(b.counts().advancedPawn).toEqual([1, 2]);
    expect(b.counts().quietMove).toEqual([1, 1]);
    const p = high.find((x) => x.id === 'U2pdQ')!;
    expect(p.themes).toEqual(['advancedPawn', 'crushing', 'endgame', 'long', 'quietMove']);
    expect(p.moves).toEqual(['g6h5', 'a4a3', 'h5f7', 'c5e6', 'e3d2', 'a3a2']);
    expect(high.find((x) => x.id === 'U2gbk')!.openings).toEqual(['Reti_Opening', 'Reti_Opening_Reti_Accepted']);
  });

  it('keeps at most perBucket puzzles per theme and band: the ones with the smallest keys', () => {
    const b = build({ ...OPTS, themes: ['crushing'] });
    const low = b.result()[0];
    expect(b.buckets.get('crushing|0')!.seen).toBe(3);
    expect(low).toHaveLength(2);
    const byKey = ['U2YyE', 'U2dEB', 'U2tFf'].sort((x, y) => sampleKey(x, OPTS.seed) - sampleKey(y, OPTS.seed));
    expect(ids(low)).toEqual(byKey.slice(0, 2).sort());
  });

  it('is reproducible: the same rows in any order give the same pool', () => {
    const a = build({ ...OPTS, themes: ['crushing', ...OPTS.themes], perBucket: 1 }).result();
    const b = build({ ...OPTS, themes: ['crushing', ...OPTS.themes], perBucket: 1 }, [...FIXTURE_ROWS].reverse()).result();
    expect(b).toEqual(a);
    expect(sampleKey('U2YyE', 7)).toBe(sampleKey('U2YyE', 7));
    expect(sampleKey('U2YyE', 7)).not.toBe(sampleKey('U2YyE', 8));
  });

  it('writes a band compactly and reads it back unchanged', () => {
    const high = build(OPTS).result()[1];
    const file = encodeBand([1000, 1500], high);
    expect(new Set(file.themes).size).toBe(file.themes.length);
    expect(file.puzzles[0][2]).toBe(high[0].moves.join(' '));
    expect(decodeBand(JSON.parse(JSON.stringify(file)))).toEqual(high);
  });
});

describe('puzzle pool: a coach set over the pool', () => {
  const pool = build(OPTS).result().flat();

  it("picks the coach's themes at the coach's band", () => {
    const set = coachSet(pool, { specialty: { puzzleThemes: ['mateIn3', 'pawnEndgame'] }, puzzleBand: [1000, 1200] });
    expect(ids(set)).toEqual(['U2PG5', 'U2oI6']); // U2tFf (pawnEndgame) is 991, under the band
  });

  it('indexes every theme a puzzle carries', () => {
    const index = byTheme(pool);
    expect(ids(index.get('endgame')!)).toContain('U2tFf');
    expect(ids(index.get('quietMove')!)).toEqual(['U2dEB', 'U2pdQ']);
  });

  it('knows which band files a range of ratings needs', () => {
    expect(bandsFor([0, 800])).toEqual([[0, 600], [600, 800]]);
    expect(bandsFor([1200, 1600])).toEqual([[1200, 1400], [1400, 1600]]);
    expect(bandFile([600, 800])).toBe('puzzles/pool/600-800.json');
  });
});

describe('puzzle pool: themes and bands', () => {
  it('names only Lichess themes the pool samples, for every coach and every detector', () => {
    const pool = new Set<string>(POOL_THEMES);
    for (const l of LEVELS) for (const t of l.specialty.puzzleThemes) expect(pool.has(t), `${l.coach.name} ${t}`).toBe(true);
    // 'mate' is on every mate puzzle; it is a broad label, not a bucket.
    for (const t of [...DETECTABLE, ...NOT_YET].filter((t) => t !== 'mate')) expect(pool.has(t), t).toBe(true);
    expect(POOL_OPTIONS.themes).toBe(POOL_THEMES);
  });

  it('bands run in steps of 200 without gaps, and every coach band starts and ends on a band edge', () => {
    POOL_BANDS.forEach(([lo, hi], i) => {
      if (i) expect(lo).toBe(POOL_BANDS[i - 1][1]);
      if (i) expect(hi - lo).toBe(200);
    });
    const edges = new Set(POOL_BANDS.flat());
    LEVELS.forEach((l, i) => {
      expect(edges.has(l.puzzleBand[0]) && edges.has(l.puzzleBand[1]), l.coach.name).toBe(true);
      if (i) expect(l.puzzleBand[0]).toBeGreaterThanOrEqual(LEVELS[i - 1].puzzleBand[0]);
    });
    expect(LEVELS[0].puzzleBand[1]).toBeLessThanOrEqual(800); // the first coach's puzzles stay easy
  });
});
