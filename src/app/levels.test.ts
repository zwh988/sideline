import { describe, expect, it } from 'vitest';
import { LEVELS, levelInfo, levelLabel } from './levels';

const MOODS = ['neutral', 'thinking', 'pleased', 'concerned', 'surprised'];
// The theme packs on disk, read through Vite (the tests run without Node's types).
const packs = import.meta.glob<{ default: { board: { light: string; dark: string }; coach: { accent: string }; pieces: { folder: string; format: string }; portraits: { folder: string; format: string } } }>('/public/themes/*/theme.json', { eager: true });
const files = new Set(Object.keys(import.meta.glob('/public/themes/**/*.{svg,png}')).map((f) => f.replace(/\/[^/]+\/\.\.\//g, '/')));
const exists = (path: string) => files.has(path.replace(/\/[^/]+\/\.\.\//g, '/'));

describe('tiers: coach, rating and theme (task 1.14)', () => {
  it('has six tiers, each with its own coach and its own theme', () => {
    expect(LEVELS.map((l) => l.level)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(new Set(LEVELS.map((l) => l.coach.id)).size).toBe(6);
    expect(new Set(LEVELS.map((l) => l.coach.name)).size).toBe(6);
    expect(new Set(LEVELS.map((l) => l.theme)).size).toBe(6);
  });

  it('shows ratings that rise with the tier and sit inside the old Chess.com bands', () => {
    const bands: [number, number][] = [[0, 400], [400, 700], [700, 1000], [1000, 1300], [1300, 1600], [1600, 2000]];
    LEVELS.forEach((l, i) => {
      expect(l.shownRating).toBeGreaterThanOrEqual(bands[i][0]);
      expect(l.shownRating).toBeLessThan(bands[i][1]);
      if (i) expect(l.shownRating).toBeGreaterThan(LEVELS[i - 1].shownRating);
    });
  });

  it('names a tier by number, coach and rating', () => {
    expect(levelLabel(levelInfo(3))).toBe(`Tier 3 · ${levelInfo(3).coach.name} · about 850`);
  });

  it("points every tier at a theme pack with a board, an accent, pieces and a face for each mood", () => {
    for (const l of LEVELS) {
      const dir = `/public/themes/${l.theme}`;
      const t = packs[`${dir}/theme.json`]?.default;
      expect(t, l.theme).toBeDefined();
      expect(t.board.light).toMatch(/^#[0-9a-f]{6}$/i);
      expect(t.board.dark).toMatch(/^#[0-9a-f]{6}$/i);
      expect(t.coach.accent).toMatch(/^#[0-9a-f]{6}$/i);
      for (const p of ['wK', 'bK', 'wP', 'bQ']) expect(exists(`${dir}/${t.pieces.folder}/${p}.${t.pieces.format}`), `${l.theme} ${p}`).toBe(true);
      for (const m of MOODS) expect(exists(`${dir}/${t.portraits.folder}/${m}.${t.portraits.format}`), `${l.theme} ${m}`).toBe(true);
    }
  });
});
