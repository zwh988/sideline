// Lines: the sideline as a tree of moves (task 1.9). Pure state over chess.js, no DOM.
//
// A Line is a path of moves from a fork; the chart draws every opened move at a column (its
// depth) and in a lane (how good it was compared with the engine's best move in its own
// position: Best / Excellent / Good / Other). The tree holds only opened moves. The options for the
// next move at the cursor (the engine's top moves, the move played in the game, ...) are not
// nodes until the player opens one; `rateOptions` ranks them from the engine's lines.
import { Chess, SQUARES, type Square } from 'chess.js';
import { scoreToCp, type Score } from '../engine/stockfish';
import { resultOf, type Color, type Result } from './game';
import { plyLabel } from './navigation';
import { brilliantSacrifice, isOnlyMove, labelOfLoss, type MoveLabel } from '../coach/movelabels';
import { offeredMaterial } from '../coach/explain';

export type Lane = 'best' | 'great' | 'good' | 'other';
export const LANES: Lane[] = ['best', 'great', 'good', 'other'];
/** The lane `great` is shown as Excellent: "Great" is the move label for the only move that holds (`movelabels.ts`). */
export const LANE_NAME: Record<Lane, string> = { best: 'Best', great: 'Excellent', good: 'Good', other: 'Other' };

/** Who proposed a move: the game itself, the engine (an engine option the player opened), or the player. */
export type Author = 'game' | 'engine' | 'you';

/** A move worth this much less than the engine's best (centipawns) is still "Best": ties and noise. */
export const BEST_CP = 10;
/** Up to this much less: Excellent (the lane `great`). */
export const GREAT_CP = 60;
/** Up to this much less: Good (the same size as `linecheck`'s "refuted" line). Beyond it: Other. */
export const GOOD_CP = 150;

/** The lane for a move that is worth `lossCp` less than the best move in its position. */
export function laneOf(lossCp: number): Lane {
  if (lossCp <= BEST_CP) return 'best';
  if (lossCp <= GREAT_CP) return 'great';
  if (lossCp <= GOOD_CP) return 'good';
  return 'other';
}

/** Who is better after a move, in words (from the engine's score for the player). */
export function verdictOf(evalCp: number): { side: 'you' | 'them' | 'level'; text: string } {
  const abs = Math.abs(evalCp);
  if (abs >= 90000) return evalCp > 0 ? { side: 'you', text: 'A forced mate for you' } : { side: 'them', text: 'A forced mate for them' };
  if (abs < 30) return { side: 'level', text: 'About level' };
  const side = evalCp > 0 ? 'you' : 'them';
  const how = abs < 100 ? 'Slightly better' : abs < 300 ? 'Better' : 'Clearly better';
  return { side, text: `${how} for ${side}` };
}

/** What the engine says about a move, from its parent position. */
export interface Rating {
  lane: Lane;
  /** How much worse than the engine's best move in that position (centipawns, never negative). */
  lossCp: number;
  /** The engine's score after the move, for the player (centipawns; mates are large values). */
  evalCp: number;
  /** The engine's best move there, in words ("Bb5"), when this move is not it. */
  bestSan?: string;
  /** The best move is the only good one: the next-best is much worse (`isOnlyMove`). */
  onlyMove?: boolean;
  /** It offers material, holds up (close to the best, not behind after it) and the side wasn't already far ahead. */
  brilliant?: boolean;
  /** Players at the level often choose it (Maia), though the engine may rate it lower. */
  common?: boolean;
}

/** Maia must give a move at least this probability for it to count as "common at your level". */
export const COMMON_P = 0.15;

/** Whether Maia's likely moves (move and probability) include `uci` as a common choice. */
export function isCommon(likely: { uci: string; p: number }[], uci: string): boolean {
  return likely.some((l) => l.uci === uci && l.p >= COMMON_P);
}

/** A mark for a notable move (the labels of `movelabels.ts`): Brilliant, Great, Inaccuracy, Mistake, Blunder. The lane says the rest. */
export function badgeOf(r: Rating | undefined): MoveLabel | undefined {
  if (!r) return undefined;
  if (r.brilliant) return 'brilliant';
  if (r.onlyMove) return 'great';
  const l = labelOfLoss(r.lossCp);
  return l === 'inaccuracy' || l === 'mistake' || l === 'blunder' ? l : undefined;
}

/** Brilliant: offers material, close to the best move, the side not already far ahead and not behind after it. */
function brilliantOf(fen: string, uci: string, lossCp: number, bestCp: number, valueCp: number): true | undefined {
  return brilliantSacrifice(lossCp, bestCp, valueCp) && !!offeredMaterial(fen, uci) ? true : undefined;
}

/** A move that can be opened next: rated, with where it came from. */
export interface Option extends Rating {
  uci: string;
  san: string;
}

/** An engine line as the options need it (a `Line` from stockfish.ts has more). */
export interface EngineLine {
  pv: string[];
  score: Score;
}

/**
 * Ranks the engine's lines for the position `fen` (the side to move's scores, best first) into
 * options: each move's loss against the best, its lane, and the score after it for the player.
 */
export function rateOptions(fen: string, lines: EngineLine[], me: Color | 'w' | 'b'): Option[] {
  const mover = new Chess(fen).turn();
  const first = lines.find((l) => l.pv.length);
  if (!first) return [];
  const best = scoreToCp(first.score);
  const bestSan = sanOf(fen, first.pv[0]);
  const out: Option[] = [];
  const second = lines.find((l) => l.pv.length && l.pv[0] !== first.pv[0]);
  const only = isOnlyMove(best, second ? scoreToCp(second.score) : undefined);
  for (const l of lines) {
    const uci = l.pv[0];
    if (!uci || out.some((o) => o.uci === uci)) continue;
    const cp = scoreToCp(l.score);
    const lossCp = Math.max(0, best - cp);
    const lane = laneOf(lossCp);
    out.push({
      uci,
      san: sanOf(fen, uci),
      lane,
      lossCp,
      evalCp: mover === me[0] ? cp : -cp,
      bestSan: lane === 'best' ? undefined : bestSan,
      onlyMove: l === first && only ? true : undefined,
      brilliant: brilliantOf(fen, uci, lossCp, best, cp),
    });
  }
  return out;
}

/** The rating of a move that is not among the engine's lines: its loss is the best score minus what it is worth. */
export function rateOther(fen: string, bestCp: number, scoreAfter: Score, me: Color | 'w' | 'b', bestSan?: string, uci?: string): Rating {
  const mover = new Chess(fen).turn();
  const value = -scoreToCp(scoreAfter); // the score after the move is the opponent's
  const lossCp = Math.max(0, bestCp - value);
  const lane = laneOf(lossCp);
  return { lane, lossCp, evalCp: mover === me[0] ? value : -value, bestSan: lane === 'best' ? undefined : bestSan, brilliant: uci ? brilliantOf(fen, uci, lossCp, bestCp, value) : undefined };
}

export function sanOf(fen: string, uci: string): string {
  return new Chess(fen).move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }).san;
}

export interface LineNode {
  id: number;
  /** Undefined only for the root, the fork the lines leave from. */
  parent?: LineNode;
  uci: string;
  san: string;
  /** "5.Bb5" or "5…Bd7". */
  label: string;
  color: 'w' | 'b';
  /** Moves from the root (1 for the first move after the fork); the chart's column. */
  depth: number;
  /** The position after this move. */
  fen: string;
  author: Author;
  rating?: Rating;
  /** What the coach said about this move (shown only while it is the cursor). */
  notes: string[];
  /** What stands out in the position after this move, with the squares to light up. */
  reason?: { text: string; squares: string[] };
  kids: LineNode[];
}

/** At most this many forks per sideline, so the chart stays readable. */
export const MAX_FORKS = 5;

export class LineTree {
  readonly root: LineNode;
  cursor: LineNode;
  private nextId = 1;
  /** The kid the player last visited under a node: › goes there. */
  private preferred = new Map<number, LineNode>();

  constructor(
    readonly rootFen: string,
    readonly playerColor: Color,
  ) {
    this.root = { id: 0, uci: '', san: '', label: '', color: new Chess(rootFen).turn() === 'w' ? 'b' : 'w', depth: 0, fen: rootFen, author: 'game', notes: [], kids: [] };
    this.cursor = this.root;
  }

  get fen(): string {
    return this.cursor.fen;
  }

  get turn(): Color {
    return this.chess().turn() === 'w' ? 'white' : 'black';
  }

  get isPlayerTurn(): boolean {
    return this.turn === this.playerColor;
  }

  get inCheck(): boolean {
    return this.chess().inCheck();
  }

  get result(): Result {
    return resultOf(this.chess());
  }

  private chess(): Chess {
    return new Chess(this.cursor.fen);
  }

  /** Legal destinations per square for the side to move at the cursor. */
  get dests(): Map<Square, Square[]> {
    const c = this.chess();
    const dests = new Map<Square, Square[]>();
    for (const from of SQUARES) {
      const targets = c.moves({ square: from, verbose: true }).map((m) => m.to);
      if (targets.length) dests.set(from, targets);
    }
    return dests;
  }

  isPromotion(from: Square, to: Square): boolean {
    return this.chess().moves({ square: from, verbose: true }).some((m) => m.to === to && m.promotion);
  }

  /** The number of forks so far (a move with a second way to go on counts once more). */
  get forks(): number {
    let n = 0;
    for (const node of this.all(true)) n += Math.max(0, node.kids.length - 1);
    return n;
  }

  /** Every opened move, parents before children (the root too when `withRoot`). */
  all(withRoot = false): LineNode[] {
    const out: LineNode[] = [];
    const walk = (n: LineNode) => {
      if (n !== this.root || withRoot) out.push(n);
      n.kids.forEach(walk);
    };
    walk(this.root);
    return out;
  }

  /** The moves from the fork down to `node` (not the fork itself). */
  path(node: LineNode = this.cursor): LineNode[] {
    const out: LineNode[] = [];
    for (let n: LineNode | undefined = node; n && n !== this.root; n = n.parent) out.unshift(n);
    return out;
  }

  ucis(node: LineNode = this.cursor): string[] {
    return this.path(node).map((n) => n.uci);
  }

  /** Whether a move from `parent` can be opened: it exists already, or it fits the fork cap (a Line may be as long as the game). */
  canOpen(parent: LineNode, uci: string): boolean {
    if (parent.kids.some((k) => k.uci === uci)) return true;
    return parent.kids.length === 0 || this.forks < MAX_FORKS;
  }

  /**
   * Opens the move `uci` from `parent` (the same move is not added twice) and returns its node.
   * Throws when the move is illegal there.
   */
  open(parent: LineNode, uci: string, author: Author, rating?: Rating): LineNode {
    const same = parent.kids.find((k) => k.uci === uci);
    if (same) {
      if (rating && !same.rating) same.rating = rating;
      return same;
    }
    const c = new Chess(parent.fen);
    const m = c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    const depth = parent.depth + 1;
    const node: LineNode = {
      id: this.nextId++,
      parent,
      uci: m.from + m.to + (m.promotion ?? ''),
      san: m.san,
      label: plyLabel(this.rootFen, depth, m.san),
      color: m.color,
      depth,
      fen: c.fen(),
      author,
      rating,
      notes: [],
      kids: [],
    };
    parent.kids.push(node);
    return node;
  }

  /** Moves the cursor to `node`. */
  goto(node: LineNode): void {
    if (node.parent) this.preferred.set(node.parent.id, node);
    this.cursor = node;
  }

  /** The kid › leads to from `node`: the last one visited, else the first. */
  nextOf(node: LineNode): LineNode | undefined {
    return this.preferred.get(node.id) ?? node.kids[0];
  }

  start(): void {
    this.cursor = this.root;
  }

  prev(): void {
    if (this.cursor.parent) this.cursor = this.cursor.parent;
  }

  /** To the end of the path › would follow through opened moves. */
  end(): void {
    let n = this.cursor;
    for (let k = this.nextOf(n); k; k = this.nextOf(n)) {
      this.goto(k);
      n = k;
    }
  }

  /** True when `node` is on the path from the fork to the cursor. */
  onCursorPath(node: LineNode): boolean {
    for (let n: LineNode | undefined = this.cursor; n; n = n.parent) if (n === node) return true;
    return false;
  }

  /** Removes `node` and everything below it; the cursor leaves it if it was inside. */
  removeFrom(node: LineNode): void {
    if (!node.parent) return;
    node.parent.kids = node.parent.kids.filter((k) => k !== node);
    if (this.onCursorPath(node)) this.cursor = node.parent;
  }
}
