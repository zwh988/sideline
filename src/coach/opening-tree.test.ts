import { Chess } from 'chess.js';
import { describe, expect, it } from 'vitest';
import type { CourseDef } from './opening-courses';
import { buildCourse, mainLine, nodesForTier, type EngineEval, type TierRule, type TreeProviders } from './opening-tree';

/** Two tiers: a shallow, picky one and a deeper one at another rating band. */
const RULES: TierRule[] = [
  { tier: 1, band: 0, maiaElo: 600, minShare: 0.1, minReach: 0.05, depth: 2 },
  { tier: 2, band: 1800, maiaElo: 1850, minShare: 0.05, minReach: 0.01, depth: 3 },
];

const fenAfter = (sans: string[]) => {
  const c = new Chess();
  for (const s of sans) c.move(s);
  return c.fen();
};

/**
 * Scripted sources. `replies[path][band]` = SAN → share; `values[path]` = SAN → score
 * of that move for the side that plays it (default 0). Positions are keyed by the SAN path.
 */
function providers(replies: Record<string, Record<number, Record<string, number>>>, values: Record<string, Record<string, number>> = {}): TreeProviders & { asked: string[] } {
  const byFen = <T,>(table: Record<string, T>) => new Map(Object.entries(table).map(([path, v]) => [fenAfter(path ? path.split(' ') : []), v]));
  const rep = byFen(replies);
  const val = byFen(values);
  const asked: string[] = [];
  return {
    asked,
    async replies(fen, _h, rule) {
      asked.push(`${rule.band} ${fen}`);
      const table = rep.get(fen)?.[rule.band] ?? {};
      const c = new Chess(fen);
      const shares = new Map(Object.entries(table).map(([san, s]) => {
        const m = c.move(san);
        c.undo();
        return [m.from + m.to + (m.promotion ?? ''), s];
      }));
      return { source: 'maia', shares };
    },
    async popularity() {
      return new Map();
    },
    async evaluate(fen): Promise<EngineEval> {
      const c = new Chess(fen);
      // A move's score: its scripted value, else minus the best scripted reply to it (one move deep).
      const bestScripted = (f: string) => Math.max(0, ...Object.values(val.get(f) ?? {}));
      const lines = c
        .moves({ verbose: true })
        .map((m) => ({ uci: m.from + m.to + (m.promotion ?? ''), cp: val.get(fen)?.[m.san] ?? -bestScripted(m.after), pv: [m.from + m.to + (m.promotion ?? '')] }))
        .sort((a, b) => b.cp - a.cp);
      return { bestCp: lines[0]?.cp ?? 0, lines };
    },
  };
}

const VIENNA: CourseDef = { id: 'test', opening: 'Vienna Game', side: 'w', role: 'play', defining: ['e4', 'e5', 'Nc3'], moves: { 'e4 e5 Nc3 Nf6': 'f4' } };

const scripted = () =>
  providers(
    {
      'e4 e5 Nc3': {
        0: { Nf6: 0.5, Nc6: 0.3, Ba3: 0.04, Qh4: 0.04 },
        1800: { Nf6: 0.4, Nc6: 0.3, Bc5: 0.2, Ba3: 0.01, Qh4: 0.02 },
      },
      'e4 e5 Nc3 Nf6 f4': { 0: { exf4: 0.6, d5: 0.3 }, 1800: { d5: 0.7, exf4: 0.2 } },
    },
    {
      // 2…Ba3?? drops the bishop to bxa3; the default (0) for everything else.
      'e4 e5 Nc3 Ba3': { bxa3: 300 },
    },
  );

describe('buildCourse', () => {
  it('keeps the defining moves, common replies and a trap; drops a rare non-trap', async () => {
    const tree = await buildCourse(VIENNA, scripted(), RULES);
    const replies = tree.nodes.filter((n) => n.parent === 3 && n.who === 'opponent');
    expect(replies.map((r) => `${r.san}:${r.tier}`)).toEqual(['Nf6:1', 'Nc6:1', 'Ba3:1', 'Bc5:2']);
    expect(tree.nodes.slice(1, 4).every((n) => n.defining && n.tier === 1)).toBe(true);
    // Qh4 is played 4%, under both tiers' bar, and loses nothing: not taught.
    expect(tree.nodes.some((n) => n.san === 'Qh4')).toBe(false);
  });

  it('a trap is flagged and answered with the punishment, which ends its line', async () => {
    const tree = await buildCourse(VIENNA, scripted(), RULES);
    const trap = tree.nodes.find((n) => n.san === 'Ba3')!;
    expect(trap.trap).toBe(true);
    expect(trap.loss).toBe(300);
    const answer = tree.nodes[trap.children[0]];
    expect(answer.san).toBe('bxa3');
    expect(answer.children).toEqual([]);
    expect(trap.line?.pv[0]).toBe('bxa3');
  });

  it('the course move is played where given, and the tree grows with the tier', async () => {
    const tree = await buildCourse(VIENNA, scripted(), RULES);
    // The main line follows each tier's band: under 1000 most play 3…exf4, at 1800 3…d5.
    expect(mainLine(tree, 1).map((n) => n.san)).toEqual(['e4', 'e5', 'Nc3', 'Nf6', 'f4', 'exf4', expect.any(String)]);
    expect(mainLine(tree, 2).map((n) => n.san).slice(0, 6)).toEqual(['e4', 'e5', 'Nc3', 'Nf6', 'f4', 'd5']);
    // After 3.f4, 3…d5 is common at both bands; 3…exf4 too. At tier 2 the line can go one move deeper.
    const f4 = tree.nodes.find((n) => n.san === 'f4')!;
    expect(f4.children.map((id) => tree.nodes[id].san)).toEqual(['exf4', 'd5']);
    expect(nodesForTier(tree, 1).length).toBeLessThan(nodesForTier(tree, 2).length);
  });

  it('tiers nest: no node has a lower tier than its parent, and every line ends with a player move', async () => {
    const tree = await buildCourse(VIENNA, scripted(), RULES);
    for (const n of tree.nodes.slice(1)) {
      expect(n.tier).toBeGreaterThanOrEqual(tree.nodes[n.parent].tier);
      if (n.who === 'opponent' && !n.defining) {
        expect(n.children.some((id) => tree.nodes[id].tier === n.tier && tree.nodes[id].who === 'player')).toBe(true);
      }
    }
  });

  it('a share is recorded per tier, and positions past a tier depth are not asked about for it', async () => {
    const p = scripted();
    const tree = await buildCourse(VIENNA, p, RULES);
    const nc6 = tree.nodes.find((n) => n.san === 'Nc6')!;
    expect(nc6.share).toEqual([0.3, 0.3]);
    expect(nc6.src).toEqual(['m', 'm']);
    // Tier 1 teaches 2 player moves after the defining ones; its band is not asked after the 2nd.
    const deep = tree.nodes.filter((n) => n.who === 'player' && !n.defining && countPlayer(tree, n) === 2);
    for (const d of deep) expect(p.asked).not.toContain(`0 ${d.fen}`);
  });

  it('fails the build when a course move is a mistake', async () => {
    const p = providers({}, { 'e4 e5': { Qh5: -400 } });
    await expect(buildCourse({ ...VIENNA, defining: ['e4', 'e5', 'Qh5'] }, p, RULES)).rejects.toThrow(/Qh5 loses 400/);
  });

  it('a system move (prefer) is chosen when near the best', async () => {
    const p = providers({ 'd4 d5 Bf4': { 0: { Nf6: 0.5 }, 1800: { Nf6: 0.5 } } }, { 'd4 d5': { c4: 40 } });
    const tree = await buildCourse({ id: 'l', opening: 'London', side: 'w', role: 'play', defining: ['d4', 'd5'], prefer: ['Bf4', 'e3'] }, p, RULES);
    expect(mainLine(tree).map((n) => n.san).slice(0, 5)).toEqual(['d4', 'd5', 'Bf4', 'Nf6', 'e3']);
  });
});

function countPlayer(tree: Awaited<ReturnType<typeof buildCourse>>, node: { id: number }): number {
  let k = 0;
  for (let n = tree.nodes[node.id]; n.parent >= 0; n = tree.nodes[n.parent]) if (n.who === 'player' && !n.defining) k++;
  return k;
}
