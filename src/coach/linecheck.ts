// Checks a line the player entered ("my knight goes here, their king must
// move, then I take the queen") move by move. Every claim comes from Stockfish
// scores (one search per position along the line) and board facts; nothing
// here is worded. The coach's voice for the verdicts is in templates.ts.
//
// Scores are from the side to move, so the value of a move is the negated
// score of the position it leads to. A move is a problem when it is worth
// clearly less than the engine's best move there; the first problem decides.
import { Chess, type Color, type Square } from 'chess.js';
import type { PositionEval } from './analyst';
import { materialBalance, playAndDescribe, type MoveFacts } from './facts';
import { cutLine, type TaughtLine } from './lines';

/** One move of a line (a sideline, or one the player wants checked). */
export interface LineMove {
  from: Square;
  to: Square;
  promotion?: string;
  uci: string;
  san: string;
  /** True for the player's own moves, false for the opponent's replies. */
  mine: boolean;
}

/** A line from a position. */
export interface Line {
  rootFen: string;
  moves: LineMove[];
}

/** The part of the analyst this module needs (tests script it). */
export interface LineEvaluator {
  evaluate(fen: string, multiPv?: number, depth?: number): Promise<PositionEval>;
}

/** A move worth this much less than the best one is a problem (centipawns). */
export const LINE_LOSS_CP = 150;
/** At or above this a side is plainly winning: smaller differences don't change the story. */
const WINNING_CP = 500;
/**
 * A player's move that is worth less than the best one is only "refuted" if
 * it leaves them no clearly better (this much ahead or less). Otherwise the
 * line holds up, and the coach just mentions the stronger move.
 */
const STILL_AHEAD_CP = 100;
/** A move worth this much less than the best one is mentioned, even though the line holds up. */
const NOTE_CP = 60;
/** A mate score. */
const MATE_CP = 90000;

export interface LineCheckOptions {
  /** How far the refutation may be taught (the level's limit). */
  maxPlies: number;
  /** Cut a move's loss at this size to count (default LINE_LOSS_CP). */
  lossCp?: number;
}

/** What the engine and board code say about one move of the line. */
export interface MoveCheck {
  facts: MoveFacts;
  mine: boolean;
  /** Worth this much less than the best move, for the side that played it (0 if it is the best). */
  lossCp: number;
  top: boolean;
  /** What the move is worth to the side that played it, by the engine (centipawns). */
  valueCp: number;
}

interface Base {
  /** Facts for each move of the line, with its loss against the engine's best. */
  checks: MoveCheck[];
}

export type LineVerdict =
  | { kind: 'empty' }
  | (Base & {
      kind: 'good';
      mate: boolean;
      /** Net material change for the player along the line, in pawns. */
      gain: number;
      /** The captures of the line, for naming what it wins. */
      won?: TaughtLine;
      /** Engine score at the end of the line, for the player. */
      endCp: number;
      /** Every one of the player's moves is the engine's first choice. */
      allTop: boolean;
      /** The first move that keeps an edge but isn't the engine's choice, and what the engine prefers. */
      weaker?: { index: number; best: MoveFacts };
    })
  | (Base & {
      kind: 'refuted';
      /** Index of the move in the line that doesn't hold up (0 = first arrow). */
      index: number;
      lossCp: number;
      /** The opponent's best answer to it, with its facts. */
      reply?: MoveFacts;
      /** What that answer wins, when it is a teachable material win or mate. */
      refutation?: TaughtLine;
      /** Engine score after the move, for the opponent. */
      replyCp: number;
    })
  | (Base & {
      kind: 'better-reply';
      /** Index of the opponent's move in the line that isn't their best. */
      index: number;
      lossCp: number;
      /** Their better move. */
      best: MoveFacts;
      /** Engine score for the player after the opponent's move in the line, and after their best move. */
      lineCp: number;
      bestCp: number;
    });

/** "13.Nxe5" / "13…Qd4" for move `index` of a line from `rootFen`. */
export function lineMoveLabel(rootFen: string, index: number, san: string): string {
  const [, turn, , , , full] = rootFen.split(' ');
  const blackFirst = turn === 'b';
  const ply = index + (blackFirst ? 1 : 0);
  const number = (Number(full) || 1) + Math.floor(ply / 2);
  return ply % 2 === 0 ? `${number}.${san}` : `${number}…${san}`;
}

/**
 * The engine's view of a position after the line's moves: scripted for a
 * finished game (a mated side is lost, anything else drawn).
 */
async function evaluateAt(analyst: LineEvaluator, fen: string): Promise<PositionEval> {
  const chess = new Chess(fen);
  if (chess.isCheckmate()) return { fen, bestCp: -(MATE_CP + 10000), lines: [] };
  if (chess.isGameOver()) return { fen, bestCp: 0, lines: [] };
  return analyst.evaluate(fen, 1);
}

/** How much worse than the best move this move is, for the side that played it. */
export function moveLoss(best: PositionEval, played: string, after: PositionEval): { lossCp: number; top: boolean; valueCp: number } {
  const top = best.lines[0]?.pv[0] === played;
  const valueCp = -after.bestCp;
  if (top) return { lossCp: 0, top, valueCp };
  // Slower mates are still mates; being far ahead (or behind) either way is the same story.
  if (valueCp >= MATE_CP) return { lossCp: 0, top, valueCp };
  if (valueCp >= WINNING_CP && best.bestCp >= WINNING_CP) return { lossCp: 0, top, valueCp };
  if (best.bestCp <= -WINNING_CP && valueCp <= -WINNING_CP) return { lossCp: 0, top, valueCp };
  return { lossCp: Math.max(0, best.bestCp - valueCp), top, valueCp };
}

export async function checkLine(analyst: LineEvaluator, line: Line, opts: LineCheckOptions): Promise<LineVerdict> {
  if (!line.moves.length) return { kind: 'empty' };
  const threshold = opts.lossCp ?? LINE_LOSS_CP;
  const chess = new Chess(line.rootFen);
  const side: Color = chess.turn();
  const start = materialBalance(chess, side);

  // One evaluation per position: before the first move, and after each move.
  const evals: PositionEval[] = [await evaluateAt(analyst, line.rootFen)];
  const facts: MoveFacts[] = [];
  for (const m of line.moves) {
    facts.push(playAndDescribe(chess, m.uci));
    evals.push(await evaluateAt(analyst, chess.fen()));
  }

  const checks: MoveCheck[] = facts.map((f, k) => ({
    facts: f,
    mine: f.color === side,
    ...moveLoss(evals[k], f.uci, evals[k + 1]),
  }));

  let weaker: { index: number; best: MoveFacts } | undefined;
  for (let k = 0; k < checks.length; k++) {
    const c = checks[k];
    if (c.mine && !weaker && !c.top && c.lossCp >= NOTE_CP && c.lossCp < threshold) {
      const bestUci = evals[k].lines[0]?.pv[0];
      if (bestUci) weaker = { index: k, best: playAndDescribe(new Chess(evals[k].fen), bestUci) };
    }
    if (c.lossCp < threshold) continue;
    if (c.mine && c.valueCp >= STILL_AHEAD_CP) {
      // Weaker than the engine's move, but the edge is kept: the line holds up.
      const bestUci = evals[k].lines[0]?.pv[0];
      if (!weaker && bestUci) weaker = { index: k, best: playAndDescribe(new Chess(evals[k].fen), bestUci) };
      continue;
    }
    if (c.mine) {
      const after = evals[k + 1];
      const pv = after.lines[0]?.pv ?? [];
      const reply = pv.length ? playAndDescribe(new Chess(after.fen), pv[0]) : undefined;
      const cut = pv.length
        ? cutLine(after.fen, pv, {
            maxPlies: opts.maxPlies,
            minGain: 1,
            evalCp: after.bestCp,
            mateIn: after.lines[0]?.score.kind === 'mate' ? after.lines[0].score.value : undefined,
          })
        : undefined;
      return {
        kind: 'refuted',
        checks,
        index: k,
        lossCp: c.lossCp,
        reply,
        refutation: cut?.kind === 'line' ? cut.line : undefined,
        replyCp: after.bestCp,
      };
    }
    const bestUci = evals[k].lines[0]?.pv[0];
    if (!bestUci) continue;
    return {
      kind: 'better-reply',
      checks,
      index: k,
      lossCp: c.lossCp,
      best: playAndDescribe(new Chess(evals[k].fen), bestUci),
      lineCp: evals[k + 1].bestCp, // after the opponent's move the player is to move
      bestCp: -evals[k].bestCp,
    };
  }

  const last = facts[facts.length - 1];
  const gain = materialBalance(chess, side) - start;
  const lastEval = evals[evals.length - 1];
  // The score is from whoever moves next: the player when an even number of moves was played.
  const endCp = facts.length % 2 === 0 ? lastEval.bestCp : -lastEval.bestCp;
  const mate = last.mate && last.color === side;
  return {
    kind: 'good',
    checks,
    mate,
    gain,
    won:
      gain >= 1 && !mate
        ? { rootFen: line.rootFen, side, moves: facts, gain, mate: false, motif: 'winning-material', positionalRest: false, laterLoss: 0 }
        : undefined,
    endCp,
    allTop: checks.every((c) => !c.mine || c.top),
    weaker,
  };
}
