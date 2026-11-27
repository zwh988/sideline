// Learning a course (task 6.2): the course's lines for a coach, the order a
// lesson walks one line in, and how the player's answer is checked. Pure
// logic over the course file (`CourseTree`, task 6.1); the screen is in
// ui.ts and the words in opening-words.ts.
//
// A line is one path from the start to the end of a branch at the coach's
// tier. A lesson = one line: the defining moves and the moves already learned
// play by themselves; the player's other moves are asked. A line whose moves
// are all learned is practice: every player move after the defining ones is
// asked again (and a miss there does not unlearn it).
import { Chess } from 'chess.js';
import type { CourseNode, CourseTree } from './opening-tree';
import { PREFER_SLACK_CP } from './opening-tree';

export interface CourseLine {
  /** The nodes from the first move to the end of the branch (the root is left out). */
  nodes: CourseNode[];
  /** How often the line is reached at the tier's band: the product of the opponent replies' shares. */
  reach: number;
  /** The line has a trap in it (a reply that loses material; the line ends with its punishment). */
  trap: boolean;
  /** The path key of the last node (`pathKey`): names the line. */
  key: string;
}

/** A node's place in the course, robust to rebuilds that renumber nodes: the UCI moves from the start. */
export function pathKey(tree: CourseTree, node: CourseNode): string {
  const ucis: string[] = [];
  for (let n = node; n.parent >= 0; n = tree.nodes[n.parent]) ucis.push(n.uci);
  return ucis.reverse().join(' ');
}

/** The share of an opponent reply at this tier (null when the build did not count it). */
export const shareAt = (node: CourseNode, tier: number): number | null => node.share?.[tier - 1] ?? null;

/** The children of a node that the course teaches at this tier. */
export const childrenAt = (tree: CourseTree, node: CourseNode, tier: number): CourseNode[] =>
  node.children.map((id) => tree.nodes[id]).filter((c) => c.tier <= tier);

/** Every line of the course at this tier, most common first (traps, at the same reach, after plain lines). */
export function courseLines(tree: CourseTree, tier: number): CourseLine[] {
  const out: CourseLine[] = [];
  const walk = (node: CourseNode, path: CourseNode[], reach: number) => {
    const kids = childrenAt(tree, node, tier);
    if (!kids.length) {
      if (path.length) out.push({ nodes: path, reach, trap: path.some((n) => n.trap), key: pathKey(tree, node) });
      return;
    }
    for (const k of kids) walk(k, [...path, k], k.who === 'opponent' && !k.defining ? reach * (shareAt(k, tier) ?? 0) : reach);
  };
  walk(tree.nodes[0], [], 1);
  return out.sort((a, b) => b.reach - a.reach || Number(a.trap) - Number(b.trap) || a.key.localeCompare(b.key));
}

/** The player's moves a line teaches (not the defining ones). */
export const quizNodes = (line: CourseLine): CourseNode[] => line.nodes.filter((n) => n.who === 'player' && !n.defining);

/** All player moves of the course at a tier (the "12 / 25 moves learned" total). */
export const playerNodes = (tree: CourseTree, tier: number): CourseNode[] =>
  tree.nodes.filter((n) => n.tier <= tier && n.who === 'player' && !n.defining);

export type StepKind =
  /** A defining move, a move of theirs, or one of yours already learned: shown, not asked. */
  | 'auto'
  /** Your move, asked. */
  | 'quiz';

export interface LessonStep {
  node: CourseNode;
  kind: StepKind;
  /** Their move where they have more than one reply at this tier: the coach gives the shares first. */
  branch?: CourseNode[];
  /** Their move is a trap: it gets its own beat, and the next step is its punishment. */
  trap?: boolean;
}

/**
 * The steps of a lesson on `line`. `learned` holds path keys of player moves learned before. When every move of
 * the line is learned, the lesson is practice and asks them all again.
 */
export function lessonSteps(tree: CourseTree, line: CourseLine, tier: number, learned: (key: string) => boolean): { steps: LessonStep[]; practice: boolean } {
  const quiz = quizNodes(line);
  const practice = quiz.every((n) => learned(pathKey(tree, n)));
  const steps = line.nodes.map((node): LessonStep => {
    if (node.who === 'opponent') {
      const step: LessonStep = { node, kind: 'auto' };
      if (!node.defining) {
        const kids = childrenAt(tree, tree.nodes[node.parent], tier);
        if (kids.length > 1) step.branch = kids;
        if (node.trap) step.trap = true;
      }
      return step;
    }
    const asked = !node.defining && (practice || !learned(pathKey(tree, node)));
    return { node, kind: asked ? 'quiz' : 'auto' };
  });
  return { steps, practice };
}

/** The status of a line on the course page. */
export type LineStatus = 'learned' | 'next' | 'new';

/** Each line's status: learned when all its moves are; the most common line not learned yet is "next". */
export function lineStatuses(tree: CourseTree, lines: CourseLine[], learned: (key: string) => boolean): LineStatus[] {
  let next = false;
  return lines.map((l) => {
    if (quizNodes(l).every((n) => learned(pathKey(tree, n)))) return 'learned';
    if (!next) {
      next = true;
      return 'next';
    }
    return 'new';
  });
}

/** The move the player made, as SAN in the position before (undefined if illegal). */
export function sanOf(fen: string, uci: string): string | undefined {
  try {
    return new Chess(fen).move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }).san;
  } catch {
    return undefined;
  }
}

/** Is this the course's move? Compared as SAN, so castling written either way matches. */
export const isCourseMove = (fenBefore: string, uci: string, node: CourseNode): boolean => sanOf(fenBefore, uci) === node.san;

/** A move this much worse than the best is a mistake (the Lines chart's Other lane, linecheck's "refuted"). */
export const LESSON_MISTAKE_CP = 150;

/**
 * Another move than the course's, judged by the engine at runtime (losses against the best move, centipawns):
 * fine when within the course's slack (as close to the best as the build allowed a system move, or no worse
 * than the course's own move), a mistake past `LESSON_MISTAKE_CP`, else weaker (playable, try again).
 */
export function judgeAlternative(altLossCp: number, courseLossCp: number): 'fine' | 'weaker' | 'mistake' {
  if (altLossCp <= Math.max(PREFER_SLACK_CP, courseLossCp)) return 'fine';
  if (altLossCp > LESSON_MISTAKE_CP) return 'mistake';
  return 'weaker';
}

/** The first line a lesson should take: the "next" one, else (all learned) the most common. */
export function nextLine(tree: CourseTree, lines: CourseLine[], learned: (key: string) => boolean): CourseLine | undefined {
  const st = lineStatuses(tree, lines, learned);
  const i = st.indexOf('next');
  return lines[i >= 0 ? i : 0];
}
