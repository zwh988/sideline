// Checks the committed course files (public/openings/, built by
// `npm run openings`): every course is there, every move is legal and its
// position right, the trees nest by tier, and no player move is a mistake by
// the build's Stockfish scores.
import { Chess } from 'chess.js';
import { describe, expect, it } from 'vitest';
import { LEVELS } from '../app/levels';
import { COURSES } from './opening-courses';
import { MAX_PLAYER_LOSS_CP, TIER_RULES, type CourseTree } from './opening-tree';

const RAW = import.meta.glob('../../public/openings/*.json', { eager: true, query: '?raw', import: 'default' }) as Record<string, string>;
const file = (id: string): string | undefined => RAW[`../../public/openings/${id}.json`];
const read = (id: string): CourseTree => JSON.parse(file(id) ?? '{"nodes":[]}');

// Skipped only until the first build (`npm run openings`) has written the index.
describe.skipIf(!file('index'))('opening course files', () => {
  it('every course is built and listed in the index', () => {
    const index = JSON.parse(file('index') ?? '{}');
    expect(index.courses.map((c: { id: string }) => c.id)).toEqual(COURSES.map((c) => c.id));
    for (const c of COURSES) expect(file(c.id), c.id).toBeDefined();
  });

  it('the strictest mistake threshold is the one the build checks against', () => {
    expect(MAX_PLAYER_LOSS_CP).toBe(Math.min(...LEVELS.map((l) => l.mistakeCp)));
  });

  for (const def of COURSES) {
    describe(def.id, () => {
      const tree = read(def.id);

      it('starts with the defining moves and replays legally', () => {
        expect(tree.nodes.slice(1, def.defining.length + 1).map((n) => n.san)).toEqual(def.defining);
        for (const n of tree.nodes.slice(1)) {
          const parent = tree.nodes[n.parent];
          expect(parent.children).toContain(n.id);
          const c = new Chess(parent.fen);
          const m = c.move({ from: n.uci.slice(0, 2), to: n.uci.slice(2, 4), promotion: n.uci[4] });
          expect(m.san).toBe(n.san);
          expect(c.fen()).toBe(n.fen);
          expect(n.who).toBe(parent.fen.split(' ')[1] === def.side ? 'player' : 'opponent');
        }
      });

      it('tiers nest and every taught line ends with a player move', () => {
        for (const n of tree.nodes.slice(1)) {
          expect(n.tier).toBeGreaterThanOrEqual(tree.nodes[n.parent].tier);
          if (n.who === 'opponent' && !n.defining) {
            expect(n.children.map((id) => tree.nodes[id]).some((c) => c.who === 'player' && c.tier === n.tier), `${n.id} ${n.san}`).toBe(true);
          }
        }
        // One player move per position.
        for (const n of tree.nodes) expect(n.children.filter((id) => tree.nodes[id].who === 'player').length).toBeLessThanOrEqual(1);
      });

      it('no player move is a mistake (Stockfish at build time)', () => {
        for (const n of tree.nodes) if (n.who === 'player') expect(n.loss, `${n.id} ${n.san}`).toBeLessThan(MAX_PLAYER_LOSS_CP);
      });

      it('replies carry their shares and sources; traps have a stored punishment', () => {
        for (const n of tree.nodes) {
          if (n.who !== 'opponent' || n.defining) continue;
          expect(n.share).toHaveLength(TIER_RULES.length);
          expect(n.share![n.tier - 1] ?? n.share!.some((s) => s !== null)).toBeTruthy();
          if (n.trap) expect(n.line?.pv.length).toBeGreaterThan(0);
        }
      });
    });
  }

  it('the course files stay small (each loads on its own)', () => {
    let total = 0;
    for (const c of COURSES) {
      const size = new TextEncoder().encode(file(c.id)).length;
      expect(size, c.id).toBeLessThan(400 * 1024);
      total += size;
    }
    expect(total).toBeLessThan(3 * 1024 * 1024);
  });
});
