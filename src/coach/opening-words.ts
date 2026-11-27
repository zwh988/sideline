// The coach's words in a course (task 6.2). Rule 1: every sentence words a
// fact from the course file: the idea tags (board code, opening-ideas.ts),
// the reply shares (Lichess explorer or Maia), the stored Stockfish lines and
// scores. Nothing is added here; a deeper coach only shows more of the facts.
import { Chess, type PieceSymbol, type Square } from 'chess.js';
import { PIECE_NAME, VALUE } from './facts';
import type { IdeaTag } from './opening-ideas';
import type { CourseNode, CourseTree } from './opening-tree';
import { childrenAt, shareAt } from './opening-lesson';
import { evalPhrase, listAnd, MOTIF_NAME } from './templates';

/** "3.f4" or "2…Nf6", from the position before the move. */
export function moveLabel(fenBefore: string, san: string): string {
  const [, turn, , , , full] = fenBefore.split(' ');
  return turn === 'w' ? `${full}.${san}` : `${full}…${san}`;
}

/** A node's move with its number. */
export const nodeLabel = (tree: CourseTree, node: CourseNode): string => moveLabel(tree.nodes[node.parent].fen, node.san);

/** The course's defining moves, numbered: "1.e4 e5 2.Nc3". */
export function definingText(tree: CourseTree): string {
  const out: string[] = [];
  const c = new Chess();
  for (const san of tree.defining) {
    const white = c.turn() === 'w';
    const n = c.moveNumber();
    c.move(san);
    out.push(white ? `${n}.${san}` : out.length ? san : `${n}…${san}`);
  }
  return out.join(' ');
}

const pct = (s: number) => `${Math.round(s * 100)}%`;
const piece = (p: PieceSymbol) => PIECE_NAME[p];
const on = (p: { piece: PieceSymbol; square: Square }) => `the ${piece(p.piece)} on ${p.square}`;

/** How many idea tags a coach names per move: the deeper the coach, the more (PLAN 6.2). */
export const tagsShown = (tier: number): number => (tier <= 2 ? 1 : tier <= 4 ? 2 : 3);

/** The most telling ideas first. */
const PRIORITY: IdeaTag['k'][] = ['threatens-mate', 'captures', 'takes-back', 'castles', 'pins', 'offers', 'attacks', 'develops', 'centre', 'prepares-castling', 'opens-line', 'check'];
/**
 * A pin against the king or queen comes first, one against a smaller piece (a pawn to a knight) last; an attack
 * only on defended pawns comes after developing and the centre (it is rarely the point of the move).
 */
function rankOf(t: IdeaTag): number {
  if (t.k === 'pins' && t.back.piece !== 'k' && t.back.piece !== 'q') return PRIORITY.length;
  if (t.k === 'attacks' && t.targets.every((x) => x.piece === 'p' && x.defended)) return PRIORITY.indexOf('centre') + 0.5;
  return PRIORITY.indexOf(t.k);
}
export const rankTags = (tags: IdeaTag[]): IdeaTag[] => [...tags].sort((a, b) => rankOf(a) - rankOf(b));

/** One idea tag as a phrase after "It …" ("develops the knight"). */
export function ideaPhrase(t: IdeaTag): string {
  switch (t.k) {
    case 'develops':
      return `develops the ${piece(t.piece)}`;
    case 'centre':
      return `fights for the centre (${listAnd(t.squares)})`;
    case 'castles':
      return `castles ${t.side === 'k' ? 'kingside' : 'queenside'}`;
    case 'prepares-castling':
      return `clears the way to castle ${t.side === 'k' ? 'kingside' : 'queenside'}`;
    case 'opens-line':
      return `opens a line for ${listAnd(t.pieces.map(on))}`;
    case 'attacks': {
      const ts = [...t.targets].sort((a, b) => VALUE[b.piece] - VALUE[a.piece]);
      if (ts.length === 1 && !ts[0].defended) return `attacks the undefended ${piece(ts[0].piece)} on ${ts[0].square}`;
      return `attacks ${listAnd(ts.map(on))}`;
    }
    case 'pins':
      return `pins ${on(t.front)} to the ${piece(t.back.piece)} behind it`;
    case 'threatens-mate':
      return `threatens mate with ${t.san}`;
    case 'offers':
      return `offers a ${piece(t.piece)}`;
    case 'takes-back':
      return `takes back the ${piece(t.piece)}`;
    case 'captures':
      return `takes the ${piece(t.piece)}`;
    case 'check':
      return 'gives check';
  }
}

/** "It develops the knight and fights for the centre (d5 and e4)." — the coach's top ideas of a move. */
export function ideaSentence(tags: IdeaTag[], tier: number, subject = 'It'): string {
  const shown = rankTags(tags).slice(0, tagsShown(tier)).map(ideaPhrase);
  return shown.length ? `${subject} ${listAnd(shown)}.` : '';
}

/** Hint step 1: the idea of the course move, without the move. */
export function ideaHint(tags: IdeaTag[]): string {
  const t = rankTags(tags)[0];
  if (!t) return 'Look for a useful move: develop a piece, or fight for the centre.';
  switch (t.k) {
    case 'develops':
      return `Develop a piece: your ${piece(t.piece)}.`;
    case 'centre':
      return `Fight for the centre: think about ${listAnd(t.squares)}.`;
    case 'castles':
      return 'Think about your king: it is time to castle.';
    case 'prepares-castling':
      return 'Get ready to castle.';
    case 'opens-line':
      return `Open a line for one of your pieces.`;
    case 'attacks':
      return `Attack something of theirs: look at ${listAnd(t.targets.map(on))}.`;
    case 'pins':
      return `Look for a pin against ${on(t.front)}.`;
    case 'threatens-mate':
      return 'Look for a move that threatens mate.';
    case 'offers':
      return `This course offers material here: a gambit.`;
    case 'takes-back':
      return 'Take back.';
    case 'captures':
      return `Something of theirs can be taken: the ${piece(t.piece)}.`;
    case 'check':
      return 'Look at checks.';
  }
}

/** The replies taught at a node, most played first, with their shares at this tier. */
export function repliesAt(tree: CourseTree, node: CourseNode, tier: number): { node: CourseNode; share: number }[] {
  return childrenAt(tree, node, tier)
    .filter((c) => c.who === 'opponent')
    .map((c) => ({ node: c, share: shareAt(c, tier) ?? 0 }))
    .sort((a, b) => b.share - a.share);
}

/** "most players reply 2…Nf6 (35%); some play 2…Nc6 (25%) or 2…Bc5 (10%)" (the plain replies only). */
function replyList(tree: CourseTree, replies: { node: CourseNode; share: number }[]): string {
  const [first, ...rest] = replies;
  if (!first) return '';
  const head = `${first.share >= 0.5 ? 'most players reply' : 'the most common reply is'} ${nodeLabel(tree, first.node)} (${pct(first.share)})`;
  if (!rest.length) return head;
  const others = rest.map((r) => `${nodeLabel(tree, r.node)} (${pct(r.share)})`);
  const tail = others.length === 1 ? others[0] : `${others.slice(0, -1).join(', ')} or ${others.at(-1)}`;
  return `${head}; some play ${tail}`;
}


/**
 * Their move at a branch: the shares at this tier, which reply this lesson follows. A trap gets its own words
 * (`trapWords`), so it is left out of the list here.
 */
export function branchWords(tree: CourseTree, step: { node: CourseNode }, tier: number): string {
  const replies = repliesAt(tree, tree.nodes[step.node.parent], tier).filter((r) => !r.node.trap);
  if (!replies.length) return '';
  const list = `At this level, ${replyList(tree, replies)}.`;
  if (step.node.trap) return list;
  const others = replies.length > 1 ? ' The others are their own lines.' : '';
  return `${list} This lesson follows ${nodeLabel(tree, step.node)}.${others}`;
}

/** A trap: "Some players play 4…Ng4? (4%). It's a mistake; here is how to punish it." */
export function trapWords(tree: CourseTree, node: CourseNode, tier: number): string {
  const s = shareAt(node, tier);
  return `Some players play ${nodeLabel(tree, node)}?${s ? ` (${pct(s)} at this level)` : ''}. The engine calls it a mistake: find how to punish it.`;
}

/** What the stored line after a reply wins in its taught part: "a knight", "checkmate" (from the pieces captured). */
export function taughtGain(fen: string, node: CourseNode): string | undefined {
  const t = node.line?.taught;
  if (!t) return undefined;
  if (t.mate) return 'checkmate';
  const c = new Chess(fen);
  const me = c.turn();
  const won: PieceSymbol[] = [];
  const lost: PieceSymbol[] = [];
  for (const san of node.line!.pv.slice(0, t.plies)) {
    let m;
    try {
      m = c.move(san);
    } catch {
      return undefined;
    }
    if (m.captured) (m.color === me ? won : lost).push(m.captured as PieceSymbol);
  }
  for (let i = won.length - 1; i >= 0; i--) {
    const j = lost.indexOf(won[i]);
    if (j >= 0) {
      lost.splice(j, 1);
      won.splice(i, 1);
    }
  }
  if (!won.length) return undefined;
  const a = (p: PieceSymbol) => (p === 'p' ? 'a pawn' : `a ${piece(p)}`);
  const w = listAnd(won.sort((x, y) => VALUE[y] - VALUE[x]).map(a));
  const l = listAnd(lost.sort((x, y) => VALUE[y] - VALUE[x]).map(a));
  return l ? `${w} for ${l}` : w;
}

/** The engine's line as numbered moves from `fen`: "5.Qxg4 d6 6.Qg3". */
export function lineText(fen: string, sans: string[]): string {
  const c = new Chess(fen);
  const out: string[] = [];
  for (const san of sans) {
    const white = c.turn() === 'w';
    const n = c.moveNumber();
    try {
      c.move(san);
    } catch {
      break;
    }
    out.push(white ? `${n}.${san}` : out.length ? san : `${n}…${san}`);
  }
  return out.join(' ');
}

/** After the punishment of a trap is found: what the engine's line wins, or its score. */
export function punishWords(tree: CourseTree, trap: CourseNode, punish: CourseNode): string {
  const gain = taughtGain(trap.fen, trap);
  const t = trap.line?.taught;
  if (gain && t) {
    const motif = t.motif !== 'winning-material' && t.motif !== 'hanging-piece' && !t.mate ? ` That's a ${MOTIF_NAME[t.motif]}.` : '';
    const how = t.mate ? 'ends in checkmate' : `wins ${gain}`;
    // One capture: the idea ("It takes the knight.") already says it.
    if (t.plies <= 1) return punish.tags.some((x) => x.k === 'captures' || x.k === 'takes-back') && !t.mate ? '' : `That ${how}.${motif}`;
    return `The engine's line ${lineText(trap.fen, trap.line!.pv.slice(0, t.plies))} ${how}.${motif}`;
  }
  return `The engine gives ${evalPhrase(punish.eval, 'you')} after ${nodeLabel(tree, punish)}.`;
}

/**
 * The course intro (one or two sentences from the data): the opening, its defining moves, and the most
 * common replies at this coach's band. No plans until 6.4.
 */
export function introWords(tree: CourseTree, tier: number): string {
  const side = tree.side === 'w' ? 'White' : 'Black';
  const head =
    tree.role === 'play'
      ? `The ${tree.opening}: ${definingText(tree)}. You play it as ${side}.`
      : `Meeting the ${tree.opening} as ${side}: ${definingText(tree)}.`;
  // The first position after the defining moves where they choose: the shares there.
  let node = tree.nodes[0];
  for (let i = 0; i < tree.defining.length; i++) node = tree.nodes[node.children.find((id) => tree.nodes[id].defining) ?? node.children[0]];
  let at = node;
  while (at && repliesAt(tree, at, tier).length === 0) {
    const next = childrenAt(tree, at, tier)[0];
    if (!next) break;
    at = next;
  }
  const replies = repliesAt(tree, at, tier).filter((r) => !r.node.trap);
  if (!replies.length) return head;
  return `${head} At this level, ${replyList(tree, replies)}.`;
}

/**
 * How the engine's line goes on after the course move (stored after the reply), as a deeper coach shows it:
 * "3…exf4 4.e5". Only when the line starts with the course move; `plies` counts the moves after it.
 */
export function lineAfterReply(reply: CourseNode, courseMove: CourseNode, plies: number): string | undefined {
  const pv = reply.line?.pv;
  if (!pv || pv[0] !== courseMove.san || plies < 1 || pv.length < 2) return undefined;
  return lineText(courseMove.fen, pv.slice(1, 1 + plies));
}
