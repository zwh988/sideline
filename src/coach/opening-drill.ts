// Drilling a course (task 6.3): spaced repetition of the player moves learned
// in 6.2. A card is one learned player move (a position: the course and its
// path from the start). A drill plays the course from the start: the player
// plays their side, the opponent picks its replies weighted by their share at
// the coach's tier and steered toward branches with due cards. The run ends at
// the end of the branch, or before a move the player has not learned yet.
//
// Pure logic over the course file; the scheduler is app/practice.ts, the
// screen is in ui.ts (it reuses the lesson's walk).
import type { CourseNode, CourseTree } from './opening-tree';
import type { IdeaTag } from './opening-ideas';
import { childrenAt, pathKey, shareAt, type LessonStep } from './opening-lesson';
import { rankTags } from './opening-words';

/** The scheduler id of a learned move's card. */
export const openingCardId = (course: string, key: string): string => `opening:${course}:${key}`;

/** A reply's weight is its share, never below this (so a rare reply with due cards can still be steered to). */
export const MIN_SHARE = 0.02;
/** How much a due card below a reply adds to its weight, per card, relative to a reply with none. */
export const DUE_BOOST = 20;

export interface DrillCounts {
  /** Learned player moves reachable below (and at) the node: a drill only follows learned moves. */
  known: number;
  /** Of those, the due ones. */
  due: number;
}

/**
 * Cards reachable from `node` at this tier: learned player moves, counted until the first unlearned player move on
 * each branch (a drill stops there). `node` itself counts when it is a learned player move.
 */
export function drillCounts(tree: CourseTree, node: CourseNode, tier: number, known: (key: string) => boolean, due: (key: string) => boolean): DrillCounts {
  const out = { known: 0, due: 0 };
  const walk = (n: CourseNode) => {
    if (n.who === 'player' && !n.defining) {
      const k = pathKey(tree, n);
      if (!known(k)) return;
      out.known++;
      if (due(k)) out.due++;
    }
    for (const c of childrenAt(tree, n, tier)) walk(c);
  };
  walk(node);
  return out;
}

/**
 * The weights of the opponent's replies at `node`: the share at the tier (at least `MIN_SHARE`), times
 * `1 + DUE_BOOST × due cards below it`. A reply with no learned move below it gets 0, unless no reply has one.
 */
export function replyWeights(tree: CourseTree, node: CourseNode, tier: number, known: (key: string) => boolean, due: (key: string) => boolean): { node: CourseNode; weight: number; counts: DrillCounts }[] {
  const kids = childrenAt(tree, node, tier).filter((c) => c.who === 'opponent');
  const rows = kids.map((c) => ({ node: c, counts: drillCounts(tree, c, tier, known, due), share: Math.max(MIN_SHARE, shareAt(c, tier) ?? 0) }));
  const anyKnown = rows.some((r) => r.counts.known > 0);
  return rows.map((r) => ({ node: r.node, counts: r.counts, weight: anyKnown && !r.counts.known ? 0 : r.share * (1 + DUE_BOOST * r.counts.due) }));
}

/** Picks by weight with `rand` in [0, 1). */
function pick<T extends { weight: number }>(rows: T[], rand: number): T | undefined {
  const total = rows.reduce((s, r) => s + r.weight, 0);
  if (!(total > 0)) return rows[0];
  let x = rand * total;
  for (const r of rows) {
    x -= r.weight;
    if (x < 0) return r;
  }
  return rows.at(-1);
}

/**
 * One drill run: the nodes from the first move to where it stops (the end of the branch, or before the first
 * player move not learned yet). `rand` is called once per choice of reply.
 */
export function drillPath(tree: CourseTree, tier: number, known: (key: string) => boolean, due: (key: string) => boolean, rand: () => number = Math.random): CourseNode[] {
  const path: CourseNode[] = [];
  let node = tree.nodes[0];
  for (;;) {
    const kids = childrenAt(tree, node, tier);
    if (!kids.length) break;
    let next: CourseNode | undefined;
    const defining = kids.find((k) => k.defining);
    if (defining) next = defining;
    else if (kids[0].who === 'player') {
      next = kids[0];
      if (!known(pathKey(tree, next))) break;
    } else next = pick(replyWeights(tree, node, tier, known, due), rand())?.node;
    if (!next) break;
    path.push(next);
    node = next;
  }
  // A run ends with a move of the player's to ask (a reply with nothing asked after it teaches nothing).
  while (path.length && (path.at(-1)!.who !== 'player' || path.at(-1)!.defining)) path.pop();
  return path;
}

/** The run as lesson steps: the defining moves and their moves are shown, every learned move of yours is asked. */
export function drillSteps(path: CourseNode[]): LessonStep[] {
  return path.map((node): LessonStep => {
    if (node.who === 'player' && !node.defining) return { node, kind: 'quiz' };
    return node.trap && !node.defining ? { node, kind: 'auto', trap: true } : { node, kind: 'auto' };
  });
}

/** Learned moves of the course that this tier's coach teaches (the drill's deck), with their path keys. */
export function deckKeys(learned: Record<string, { node: number }>, tier: number): string[] {
  return Object.entries(learned)
    .filter(([, m]) => m.node <= tier)
    .map(([k]) => k);
}

// --- "Why this move?" ------------------------------------------------------
// Choices worded per kind of idea tag. The wrong choices are only kinds whose sentence is exactly what the board
// code checks (it castles, it takes something, it gives check, …), and only when the move has no tag of that kind,
// so a wrong choice is false for the move by code. Kinds whose plain sentence could still be true without the tag
// (the centre, attacks, pins, opening a line: the tags only count new ones) are never offered as wrong.

type Kind = IdeaTag['k'];
const GROUP: Partial<Record<Kind, string>> = { 'takes-back': 'captures' };
const kindOf = (k: Kind): string => GROUP[k] ?? k;

const CHOICE: Record<string, string> = {
  develops: 'It brings a knight or bishop out for the first time.',
  centre: 'It fights for the centre.',
  castles: 'It castles.',
  'prepares-castling': 'It clears the way to castle.',
  'opens-line': 'It opens a line for a piece.',
  attacks: 'It attacks a piece or pawn of theirs.',
  pins: 'It pins a piece.',
  'threatens-mate': 'It threatens mate.',
  offers: 'It offers material: a gambit.',
  captures: 'It takes a piece or pawn.',
  check: 'It gives check.',
};
/** Kinds that may be offered as a wrong choice (the sentence is false exactly when the tag is missing). */
export const FALSE_SAFE = ['develops', 'castles', 'prepares-castling', 'threatens-mate', 'offers', 'captures', 'check'] as const;

export interface WhyQuestion {
  choices: { text: string; right: boolean; kind: string }[];
}

/** "Why this move?" for a node: the right choice is its top idea; two wrong ones the code shows are false. */
export function whyChoices(tags: IdeaTag[], rand: () => number = Math.random): WhyQuestion | undefined {
  const top = rankTags(tags)[0];
  if (!top) return undefined;
  const has = new Set(tags.map((t) => kindOf(t.k)));
  const wrong = FALSE_SAFE.filter((k) => !has.has(k));
  if (wrong.length < 2) return undefined;
  // Two wrong kinds at random, then the three in a random order.
  const pool = [...wrong];
  const picked: string[] = [];
  while (picked.length < 2) picked.push(pool.splice(Math.floor(rand() * pool.length), 1)[0]);
  const choices = [{ text: CHOICE[kindOf(top.k)], right: true, kind: kindOf(top.k) }, ...picked.map((k) => ({ text: CHOICE[k], right: false, kind: k }))];
  for (let i = choices.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [choices[i], choices[j]] = [choices[j], choices[i]];
  }
  return { choices };
}
