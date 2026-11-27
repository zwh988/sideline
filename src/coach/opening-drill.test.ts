// Drill runs (task 6.3) on the real Vienna (White) and Caro-Kann (Black) course files.
import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import type { CourseNode, CourseTree } from './opening-tree';
import { courseLines, pathKey, quizNodes, shareAt } from './opening-lesson';
import { DUE_BOOST, FALSE_SAFE, MIN_SHARE, deckKeys, drillCounts, drillPath, drillSteps, openingCardId, replyWeights, whyChoices } from './opening-drill';
import { openingIdeas } from './opening-ideas';

const RAW = import.meta.glob('../../public/openings/*.json', { eager: true, query: '?raw', import: 'default' }) as Record<string, string>;
const load = (id: string): CourseTree => JSON.parse(RAW[`../../public/openings/${id}.json`]);
const vienna = load('vienna-white');
const caro = load('caro-kann-black');

/** Every player move of the lines at a tier, as path keys. */
const allKeys = (t: CourseTree, tier: number) => new Set(courseLines(t, tier).flatMap((l) => quizNodes(l).map((n) => pathKey(t, n))));
/** The position where the opponent first chooses (after the defining moves and any single replies). */
function firstBranch(t: CourseTree, tier: number): CourseNode {
  let n = t.nodes[0];
  for (;;) {
    const kids = n.children.map((i) => t.nodes[i]).filter((c) => c.tier <= tier);
    if (kids.filter((c) => c.who === 'opponent' && !c.defining).length > 1) return n;
    n = kids[0];
  }
}
const under = (t: CourseTree, reply: CourseNode, keys: Set<string>) => [...keys].filter((k) => k.startsWith(pathKey(t, reply) + ' '));
const never = () => false;

describe('reply weighting', () => {
  const tier = 1;
  const branch = firstBranch(vienna, tier);
  const known = allKeys(vienna, tier);
  const isKnown = (k: string) => known.has(k);

  it('with nothing due, replies are weighted by their share at the tier', () => {
    const rows = replyWeights(vienna, branch, tier, isKnown, never);
    expect(rows.length).toBeGreaterThan(1);
    for (const r of rows) expect(r.weight).toBeCloseTo(Math.max(MIN_SHARE, shareAt(r.node, tier) ?? 0));
  });

  it('a due card below a rare reply makes it more likely than the most common one', () => {
    const rows = replyWeights(vienna, branch, tier, isKnown, never);
    const common = rows.reduce((a, b) => ((shareAt(a.node, tier) ?? 0) >= (shareAt(b.node, tier) ?? 0) ? a : b));
    const rare = rows.reduce((a, b) => ((shareAt(a.node, tier) ?? 0) <= (shareAt(b.node, tier) ?? 0) ? a : b));
    expect(rare).not.toBe(common);
    const dueKey = under(vienna, rare.node, known)[0];
    const steered = replyWeights(vienna, branch, tier, isKnown, (k) => k === dueKey);
    const w = (r: { node: CourseNode }) => steered.find((s) => s.node === r.node)!.weight;
    expect(w(rare)).toBeGreaterThan(w(common));
    expect(w(rare)).toBeCloseTo(Math.max(MIN_SHARE, shareAt(rare.node, tier) ?? 0) * (1 + DUE_BOOST));
    expect(w(common)).toBeCloseTo(Math.max(MIN_SHARE, shareAt(common.node, tier) ?? 0));
    // Over many runs the drill reaches the due card far more often than its share would.
    let hits = 0;
    let seed = 1;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 400; i++) if (drillPath(vienna, tier, isKnown, (k) => k === dueKey, rand).some((n) => pathKey(vienna, n) === dueKey)) hits++;
    expect(hits / 400).toBeGreaterThan(0.4);
    expect(hits / 400).toBeGreaterThan(3 * (shareAt(rare.node, tier) ?? 0));
  });

  it('a reply with no learned move below it is not chosen while another has one', () => {
    const rows = replyWeights(vienna, branch, tier, isKnown, never);
    const keep = rows[0].node;
    const only = new Set(under(vienna, keep, known));
    const learnedOnlyThere = (k: string) => only.has(k) || !rows.some((r) => k.startsWith(pathKey(vienna, r.node)));
    const w = replyWeights(vienna, branch, tier, learnedOnlyThere, never);
    for (const r of w) expect(r.weight > 0).toBe(r.node === keep);
    // With nothing learned at all, the shares decide.
    expect(replyWeights(vienna, branch, tier, never, never).every((r) => r.weight > 0)).toBe(true);
  });

  it('counts only cards reachable through learned moves', () => {
    const line = courseLines(vienna, tier).find((l) => quizNodes(l).length >= 2)!;
    const [first, second] = quizNodes(line);
    const onlySecond = (k: string) => k === pathKey(vienna, second);
    expect(drillCounts(vienna, vienna.nodes[0], tier, onlySecond, never).known).toBe(0);
    const both = (k: string) => k === pathKey(vienna, first) || k === pathKey(vienna, second);
    expect(drillCounts(vienna, vienna.nodes[0], tier, both, onlySecond)).toEqual({ known: 2, due: 1 });
  });
});

describe('drill runs', () => {
  it('plays a legal line from the start, asks every learned move, and ends on a move of yours', () => {
    for (const [tree, tier] of [[vienna, 1], [vienna, 6], [caro, 1], [caro, 6]] as const) {
      const known = allKeys(tree, tier);
      let seed = 7;
      const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      for (let i = 0; i < 30; i++) {
        const path = drillPath(tree, tier, (k) => known.has(k), never, rand);
        const c = new Chess();
        for (const n of path) expect(c.move(n.san).san).toBe(n.san);
        expect(path.at(-1)!.who).toBe('player');
        const steps = drillSteps(path);
        expect(steps.filter((s) => s.kind === 'quiz').map((s) => s.node)).toEqual(path.filter((n) => n.who === 'player' && !n.defining));
        expect(steps.filter((s) => s.trap).every((s) => s.node.trap)).toBe(true);
      }
    }
  });

  it('stops before a move not learned yet', () => {
    const line = courseLines(vienna, 1).find((l) => quizNodes(l).length >= 2)!;
    const [first, second] = quizNodes(line);
    const onlyFirst = (k: string) => k === pathKey(vienna, first);
    const path = drillPath(vienna, 1, onlyFirst, never, () => 0.5);
    expect(path.at(-1)).toBe(first);
    expect(path).not.toContain(second);
    // Nothing learned: nothing to ask.
    expect(drillPath(vienna, 1, never, never)).toEqual([]);
  });

  it('the deck of a tier keeps the lower tiers\' moves and leaves out deeper ones', () => {
    const learned = { 'a': { node: 1 }, 'b': { node: 3 }, 'c': { node: 6 } };
    expect(deckKeys(learned, 3).sort()).toEqual(['a', 'b']);
    expect(deckKeys(learned, 6).length).toBe(3);
    expect(openingCardId('vienna-white', 'e2e4 e7e5')).toBe('opening:vienna-white:e2e4 e7e5');
  });
});

describe('"Why this move?"', () => {
  const players = (t: CourseTree) => t.nodes.filter((n) => n.who === 'player' && !n.defining);

  it('offers the top idea and two choices the board code says are false', () => {
    let asked = 0;
    for (const tree of [vienna, caro]) {
      for (const n of players(tree)) {
        const q = whyChoices(n.tags, () => 0.3);
        if (!q) continue;
        asked++;
        expect(q.choices.length).toBe(3);
        expect(q.choices.filter((c) => c.right).length).toBe(1);
        // Recomputed by board code from the position: no wrong choice's kind is among the move's ideas.
        const parent = tree.nodes[n.parent];
        const grand = tree.nodes[parent.parent];
        const prev = grand ? { to: parent.uci.slice(2, 4) as never, captured: !!new Chess(grand.fen).move(parent.san).captured } : undefined;
        const kinds = new Set(openingIdeas(parent.fen, n.uci, prev).map((t) => (t.k === 'takes-back' ? 'captures' : t.k)));
        for (const c of q.choices.filter((x) => !x.right)) {
          expect((FALSE_SAFE as readonly string[]).includes(c.kind)).toBe(true);
          expect(kinds.has(c.kind as never)).toBe(false);
        }
      }
    }
    expect(asked).toBeGreaterThan(50);
  });

  it('a castling move is asked with "It castles." as the answer', () => {
    const castle = players(vienna).find((n) => n.tags.some((t) => t.k === 'castles'))!;
    const q = whyChoices(castle.tags, () => 0)!;
    expect(q.choices.find((c) => c.right)!.text).toBe('It castles.');
    expect(q.choices.some((c) => !c.right && c.text === 'It castles.')).toBe(false);
  });

  it('no question for a move without tags', () => {
    expect(whyChoices([])).toBeUndefined();
  });
});
