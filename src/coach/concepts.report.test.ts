// Scores the concept detectors against Lichess's labelled puzzles. Runs only
// through `npm run concepts` (needs public/puzzles/sample.json from
// scripts/build-puzzles.mjs); a normal `npm test` skips it.
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DETECTABLE, NOT_YET, detectConcepts, puzzleStart, type PuzzleRecord } from './concepts';

const FILE = 'public/puzzles/sample.json';
const run = !!process.env.CONCEPTS_REPORT && existsSync(FILE);

describe.skipIf(!run)('concept detectors vs Lichess puzzle labels', () => {
  it('prints agreement per theme', () => {
    const { puzzles, perBucket } = JSON.parse(readFileSync(FILE, 'utf8')) as { puzzles: PuzzleRecord[]; perBucket: number };
    const detected = new Map<string, Set<string>>();
    let crashed = 0;
    for (const p of puzzles) {
      try {
        const s = puzzleStart(p);
        detected.set(p.id, detectConcepts(s.fen, s.solution));
      } catch {
        crashed++;
      }
    }
    const rows: Record<string, string | number>[] = [];
    for (const theme of [...DETECTABLE, ...NOT_YET]) {
      let labelled = 0;
      let tp = 0;
      let fp = 0;
      for (const p of puzzles) {
        const d = detected.get(p.id);
        if (!d) continue;
        const has = p.themes.includes(theme);
        const found = d.has(theme as never);
        if (has) labelled++;
        if (has && found) tp++;
        if (!has && found) fp++;
      }
      const detectable = (DETECTABLE as readonly string[]).includes(theme);
      rows.push({
        theme,
        detector: detectable ? 'yes' : 'not yet',
        labelled,
        recall: detectable && labelled ? `${Math.round((100 * tp) / labelled)}%` : '-',
        precision: detectable && tp + fp ? `${Math.round((100 * tp) / (tp + fp))}%` : '-',
        falsePositives: detectable ? fp : '-',
      });
    }
    // How many puzzles get any named concept at all (the honest "can't name a reason" share is the rest).
    const share = (set: PuzzleRecord[]) => {
      const n = set.filter((p) => (detected.get(p.id)?.size ?? 0) > 0).length;
      return `${n}/${set.length} (${Math.round((100 * n) / (set.length || 1))}%)`;
    };
    const mates = puzzles.filter((p) => p.themes.includes('mate'));
    const others = puzzles.filter((p) => !p.themes.includes('mate'));
    console.log(`Puzzles with at least one named concept: all ${share(puzzles)}; mate puzzles ${share(mates)}; other puzzles ${share(others)}. Crashed: ${crashed}.`);
    expect(crashed).toBe(0);
  });
});
