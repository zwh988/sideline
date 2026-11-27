// The coach's words in a course (task 6.2). Rule 1: every sentence words a
// fact from the course file: the idea tags (board code, opening-ideas.ts),
// the reply shares (Lichess explorer or Maia), the stored Stockfish lines and
// scores. Nothing is added here; a deeper coach only shows more of the facts.
import { Chess, type PieceSymbol, type Square } from 'chess.js';
import { PIECE_NAME, VALUE } from './facts';
import { defends, openingIdeas, type IdeaTag, type Placed } from './opening-ideas';
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

/** One idea tag as a phrase in the base form, after "to" or "doesn't" ("develop the knight"). */
export function ideaBase(t: IdeaTag): string {
  switch (t.k) {
    case 'develops':
      return `develop the ${piece(t.piece)}`;
    case 'centre':
      return `fight for the centre (${listAnd(t.squares)})`;
    case 'castles':
      return `castle ${t.side === 'k' ? 'kingside' : 'queenside'}`;
    case 'prepares-castling':
      return `clear the way to castle ${t.side === 'k' ? 'kingside' : 'queenside'}`;
    case 'opens-line':
      return `open a line for ${listAnd(t.pieces.map(on))}`;
    case 'attacks': {
      const ts = [...t.targets].sort((a, b) => VALUE[b.piece] - VALUE[a.piece]);
      if (ts.length === 1 && !ts[0].defended) return `attack the undefended ${piece(ts[0].piece)} on ${ts[0].square}`;
      return `attack ${listAnd(ts.map(on))}`;
    }
    case 'pins':
      return `pin ${on(t.front)} to the ${piece(t.back.piece)} behind it`;
    case 'threatens-mate':
      return `threaten mate with ${t.san}`;
    case 'offers':
      return `offer a ${piece(t.piece)}`;
    case 'takes-back':
      return `take back the ${piece(t.piece)}`;
    case 'captures':
      return `take the ${piece(t.piece)}`;
    case 'check':
      return 'give check';
  }
}

/** One idea tag as a phrase after "It …" ("develops the knight"): the base form with its first verb in -s. */
export function ideaPhrase(t: IdeaTag): string {
  const base = ideaBase(t);
  const i = base.indexOf(' ');
  return i < 0 ? `${base}s` : `${base.slice(0, i)}s${base.slice(i)}`;
}

/** "It develops the knight and fights for the centre (d5 and e4)." — the coach's top ideas of a move. */
export function ideaSentence(tags: IdeaTag[], tier: number, subject = 'It'): string {
  const shown = rankTags(tags).slice(0, tagsShown(tier)).map(ideaPhrase);
  return shown.length ? `${subject} ${listAnd(shown)}.` : '';
}

/** The course move once found or shown: its goal first (as the question put it), then its other ideas, a gambit's offer last. */
export function foundSentence(tags: IdeaTag[], tier: number): string {
  const shown = foundTags(tags, tier).map(ideaPhrase);
  return shown.length ? `It ${listAnd(shown)}.` : '';
}

/** The ideas `foundSentence` names, in its order (the board draws the same ones). */
export function foundTags(tags: IdeaTag[], tier: number): IdeaTag[] {
  const ordered = [...rankTags(tags.filter((t) => t.k !== 'offers' && t.k !== 'check')), ...tags.filter((t) => t.k === 'offers' || t.k === 'check')];
  return ordered.slice(0, tagsShown(Math.max(tier, 5)));
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
  return replies.length > 1 ? `${list} This lesson follows ${nodeLabel(tree, step.node)}.` : list;
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

// --- Goal first (the Learn rework, agreed with the user Nov 27) ----------------
// A lesson says what is needed before it asks, words every move it shows, and
// answers a wrong move with what that move does against what was needed.

const yours = (p: Placed) => `your ${piece(p.piece)} on ${p.square}`;

/**
 * The question before the player's move, goal first: what their last move did to the player (a piece of theirs
 * that is now attacked and that the course move defends), then the course move's main idea as a goal. Every part
 * is board code on the course move; the move itself is not named.
 */
export function goalQuestion(fenBefore: string, node: CourseNode): string {
  const def = defends(fenBefore, node.uci);
  // Offering material is what a gambit costs, not its goal: the goal is the move's next idea.
  const goals = node.tags.filter((t) => t.k !== 'offers' && t.k !== 'check');
  const top = rankTags(goals)[0];
  if (def.length) {
    const what = listAnd(def.map(yours));
    const also = top?.k === 'develops' ? ' while bringing out a piece' : top?.k === 'centre' ? ' while fighting for the centre' : '';
    return `${capital(what)} ${def.length > 1 ? 'are' : 'is'} attacked. Defend ${def.length > 1 ? 'them' : 'it'}${also}: which move does that?`;
  }
  return `${ideaHint(goals.length ? goals : node.tags)} Which move does that?`;
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * A move that is not the course's: what it does (its own tags, board code) and what the course move does that it
 * doesn't. `previous` is the other side's last move, for "takes back".
 */
export function compareWords(fenBefore: string, uci: string, node: CourseNode, tier: number, previous?: { to: Square; captured: boolean }): string {
  const c = new Chess(fenBefore);
  let san: string;
  try {
    san = c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }).san;
  } catch {
    return '';
  }
  const theirs = openingIdeas(fenBefore, uci, previous);
  const what = ideaSentence(theirs, Math.max(tier, 2), san);
  // What the course move does that this move doesn't: the same kind of idea on the same squares counts as done.
  const covered = (t: IdeaTag) =>
    theirs.some((x) => {
      if (x.k !== t.k) return false;
      if (t.k === 'attacks' && x.k === 'attacks') return t.targets.every((a) => x.targets.some((b) => b.square === a.square));
      if (t.k === 'centre' && x.k === 'centre') return t.squares.every((q) => x.squares.includes(q));
      return true;
    });
  const missing = rankTags(node.tags.filter((t) => t.k !== 'offers' && t.k !== 'check')).filter((t) => !covered(t)).slice(0, 2).map(ideaBase);
  const safe = new Set(defends(fenBefore, uci).map((p) => p.square));
  const unguarded = defends(fenBefore, node.uci).filter((p) => !safe.has(p.square));
  if (unguarded.length) missing.unshift(`defend ${listAnd(unguarded.map(yours))}`);
  if (!missing.length) return `${what || `${san}.`} It does the same kind of job as this course's move, but it is not the move this course plays.`.trim();
  return `${what ? `${what} But it` : `${san}`} doesn't ${listAnd(missing)}, and that is what this course does here.`;
}

/** The ideas `shownWords` names for a shown move, in its order: for their move, what it does to you first. */
export function shownTags(n: CourseNode, tier: number): IdeaTag[] {
  if (n.who === 'player') return rankTags(n.tags).slice(0, tagsShown(Math.max(tier, 3)));
  const mine: IdeaTag[] = n.tags.filter((t) => t.k === 'attacks' || t.k === 'pins' || t.k === 'threatens-mate');
  const rest = rankTags(n.tags.filter((t) => !mine.includes(t)));
  return [...mine, ...rest].slice(0, tagsShown(Math.max(tier, 3)));
}

/** The sentence for a move the lesson shows (not asked): what it does, and for their move, how often it is played. */
export function shownWords(tree: CourseTree, step: { node: CourseNode; branch?: CourseNode[]; trap?: boolean }, tier: number): string {
  const n = step.node;
  const label = nodeLabel(tree, n);
  const shown = shownTags(n, tier).map(ideaPhrase);
  const idea = shown.length ? `${label} ${listAnd(shown)}.` : `${label}.`;
  if (n.who === 'player') return n.defining ? idea : `You know this one. ${idea}`;
  if (n.defining) return idea;
  if (step.trap) return trapWords(tree, n, tier);
  if (step.branch) return `${idea} ${branchWords(tree, step, tier)}`;
  const s = shareAt(n, tier);
  return s ? `${idea} At this level ${pct(s)} of players play it.` : idea;
}

// --- Arrows for the ideas (agreed with the user Nov 27) ------------------------
// The board draws what the words say, from the same tags: red for what their
// move does to you, green for what yours does, yellow for where the goal points.

export interface IdeaShape {
  orig: Square;
  dest?: Square;
  brush: 'green' | 'red' | 'yellow';
}

/** The same position with the other side to move (no en passant). */
function passTurn(fen: string): string {
  const parts = fen.split(' ');
  parts[1] = parts[1] === 'w' ? 'b' : 'w';
  parts[3] = '-';
  return parts.join(' ');
}

const dedupe = (shapes: IdeaShape[]): IdeaShape[] => {
  const seen = new Set<string>();
  return shapes.filter((x) => {
    const k = `${x.orig}${x.dest ?? ''}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
};

/**
 * Arrows and circles for a move's ideas (the tags the words named): an arrow from the moved piece (on `to`) to
 * each piece it attacks, a pin's line to the piece behind, the mating move it threatens, circles on the centre
 * squares it takes. `fenAfter` is the position after the move.
 */
export function tagShapes(tags: IdeaTag[], to: Square, fenAfter: string, brush: 'green' | 'red'): IdeaShape[] {
  const out: IdeaShape[] = [];
  for (const t of tags) {
    if (t.k === 'attacks') for (const x of [...t.targets].sort((a, b) => VALUE[b.piece] - VALUE[a.piece]).slice(0, 2)) out.push({ orig: to, dest: x.square, brush });
    else if (t.k === 'pins') out.push({ orig: t.by, dest: t.back.square, brush }, { orig: t.front.square, brush });
    else if (t.k === 'centre') {
      for (const q of t.squares) if (q !== to) out.push({ orig: q, brush });
    } else if (t.k === 'threatens-mate') {
      try {
        const m = new Chess(passTurn(fenAfter)).move(t.san);
        out.push({ orig: m.from, dest: m.to, brush });
      } catch {
        /* not legal as written: no arrow */
      }
    }
  }
  return dedupe(out);
}

/** The goal question's marks: red arrows onto your attacked piece the course move defends, else circles where the goal points. */
export function goalShapes(fenBefore: string, node: CourseNode): IdeaShape[] {
  const def = defends(fenBefore, node.uci);
  if (def.length) {
    const c = new Chess(fenBefore);
    const enemy = c.turn() === 'w' ? 'b' : 'w';
    return dedupe(def.flatMap((p) => c.attackers(p.square, enemy).slice(0, 2).map((a) => ({ orig: a, dest: p.square, brush: 'red' as const }))));
  }
  const top = rankTags(node.tags.filter((t) => t.k !== 'offers' && t.k !== 'check'))[0];
  if (top?.k === 'attacks') return top.targets.slice(0, 2).map((x) => ({ orig: x.square, brush: 'yellow' }));
  if (top?.k === 'centre') return top.squares.map((q) => ({ orig: q, brush: 'yellow' }));
  if (top?.k === 'pins') return [{ orig: top.front.square, brush: 'yellow' }];
  return [];
}
