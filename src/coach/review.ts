// Review: the coach looks at a whole game that was already played. Unlike the
// live coach, it was asked to look, so rule 3 ("mostly stays quiet") shows up
// differently here: it always gives the fullest review, whatever coach or level
// the game was played with (`REVIEW_DEPTH`): every pattern, for BOTH sides,
// every swing of about a pawn or more, and every win of a pawn or more counts
// as a tactic. It keeps the moments up to the cap, most costly first.
//
// One engine search per position (n + 1 for n moves), which also gives the
// evaluation curve. The caller decides how to keep the page responsive: the
// engine runs in a worker, this loop awaits one move at a time, reports
// progress after each and stops at the next move when the signal is aborted.
import { cueForMoment } from './voices';
import { Chess, type Color } from 'chess.js';
import type { SavedMoment } from '../app/store';
import type { Analyst, PositionEval } from './analyst';
import { lineConceptOf } from './explain';
import { materialBalance } from './facts';
import { isMereRecapture, type TaughtLine } from './lines';
import { moveLoss } from './linecheck';
import type { Moment, Remark } from './coach';
import type { NoteConcept } from './explain';
import type { OpeningBook } from './openings';
import { momentWords } from './reviewwords';
import { LEVELS, type Level } from '../app/levels';
import { classifyMove, isOnlyMove, type MoveLabel } from './movelabels';
import { offeredMaterial } from './explain';
import { scoreToCp } from '../engine/stockfish';

export interface ReviewedGame {
  /** The coach's remarks that carry a moment, with the ply (moves played) they belong to. */
  remarks: { ply: number; remark: Remark }[];
  moments: SavedMoment[];
  /** White's evaluation after 0..n moves, in centipawns, clamped to ±CURVE_CAP. */
  curve: number[];
  /** Every move's label, both sides, by ply - 1 (`movelabels.ts`). */
  labels: MoveLabel[];
}

export interface ReviewOptions {
  signal?: AbortSignal;
  /** Known openings: a move inside theory is not flagged. */
  book?: OpeningBook;
  /** Called after each move of the game has been handled (`done` of `total` plies). */
  onProgress?: (done: number, total: number) => void;
}

/** How far a line is read for a tactic (all patterns, whatever the level). */
const TACTIC_PLIES = 10;
/**
 * What Review looks for, the same for every game: the shortest line shown first (`maxPlies`, a longer
 * reading up to `TACTIC_PLIES` when that finds nothing), a pawn or more counts as a win, a move that drops
 * about a pawn or more is listed, and every pattern the detectors know counts (nothing is tagged as beyond a level).
 */
export const REVIEW_DEPTH = { maxPlies: 6, minGain: 1, mistakeCp: 100 };

/**
 * The coach that talks in Review (and judges its sidelines) at the same full depth, whatever level the game
 * was played or imported at: every pattern, the longest reading, a pawn counts. Only the face and name stay
 * the game's coach.
 */
export function reviewCoachLevel(base: Level): Level {
  return { ...base, maxPlies: TACTIC_PLIES, minGain: REVIEW_DEPTH.minGain, mistakeCp: REVIEW_DEPTH.mistakeCp, motifs: LEVELS[LEVELS.length - 1].motifs };
}
/** Moments kept per game, most costly first: in practice every moment the analysis flags. */
export const MAX_MOMENTS = 40;
export const CURVE_CAP = 1000;
/** Raised when the moment-finding changes, so saved games are analysed again the next time they are opened. */
export const REVIEW_VERSION = 5;
const MATE_CP = 90000;

type Draft = Moment & { ply: number };

/** The engine's view of a position; a finished game is scripted (a mated side is lost, a draw is level). */
async function evalAt(analyst: Analyst, fen: string): Promise<PositionEval> {
  const chess = new Chess(fen);
  if (chess.isCheckmate()) return { fen, bestCp: -(MATE_CP + 10000), lines: [] };
  if (chess.isGameOver()) return { fen, bestCp: 0, lines: [] };
  return analyst.evaluate(fen, 2); // two lines: the second tells whether the best move is the only one
}

/**
 * Finds the moments of a game, both sides' moves. Returns undefined when cancelled
 * (nothing half-finished is returned).
 */
export async function reviewGame(
  analyst: Analyst,
  game: { startFen: string; moves: string[]; playerColor: 'white' | 'black'; opponent?: string },
  opts: ReviewOptions,
): Promise<ReviewedGame | undefined> {
  await analyst.newGame();
  const me: Color = game.playerColor === 'white' ? 'w' : 'b';
  const depth = REVIEW_DEPTH;
  const limits = { maxPlies: TACTIC_PLIES, minGain: depth.minGain };
  const cutoff = depth.mistakeCp;
  const n = game.moves.length;

  const chess = new Chess(game.startFen);
  const fens = [chess.fen()];
  for (const uci of game.moves) {
    chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    fens.push(chess.fen());
  }

  // Every pattern is looked for, but the shortest teachable version of a line is the one shown: a short
  // reading first, a longer one only when that finds nothing.
  const taught = (ev: PositionEval): TaughtLine | undefined => {
    const short = analyst.taughtLine(ev, { ...limits, maxPlies: depth.maxPlies });
    if (short.kind === 'line') return short.line;
    const cut = analyst.taughtLine(ev, limits);
    return cut.kind === 'line' ? cut.line : undefined;
  };
  const ucisOf = (line: TaughtLine) => line.moves.map((m) => m.uci);

  const evals: PositionEval[] = [await evalAt(analyst, fens[0])];
  const drafts: Draft[] = [];
  const score = new Map<Draft, number>();
  const labels: MoveLabel[] = [];

  for (let i = 0; i < n; i++) {
    if (opts.signal?.aborted) return undefined;
    const uci = game.moves[i];
    evals.push(await evalAt(analyst, fens[i + 1]));
    const fen = fens[i];
    const mover = fen.split(' ')[1] as Color;
    const best = evals[i];
    const after = evals[i + 1];
    const { lossCp, top } = moveLoss(best, uci, after);
    const previous = i > 0 ? { fen: fens[i - 1], uci: game.moves[i - 1] } : undefined;
    const inBook = !!opts.book?.has(fens[i + 1]);
    let tactic = taught(best);
    if (tactic && isMereRecapture(tactic, previous, depth.minGain)) tactic = undefined;
    const betterLine = tactic ? ucisOf(tactic) : (best.lines[0]?.pv ?? []).slice(0, 3);
    const add = (d: Omit<Draft, 'ply'>, s: number) => {
      const draft = { ...d, ply: i + 1 };
      drafts.push(draft);
      score.set(draft, s);
    };

    const played = tactic?.moves[0].uci === uci;
    // A mate or a win passed up is listed even when the side stays far ahead, where `moveLoss` counts no loss.
    const waived = lossCp === 0 && !top;
    const missedMate = !!tactic?.mate && !played && -after.bestCp < MATE_CP;
    const missedWin = !!tactic && !tactic.mate && !played && waived && materialAfter(fen, [uci, ...(after.lines[0]?.pv ?? [])], tactic.moves.length) < tactic.gain;

    // The move's label (both sides): engine facts and board code only.
    const second = best.lines.find((l) => l.pv.length && l.pv[0] !== best.lines[0]?.pv[0]);
    labels.push(
      classifyMove({
        lossCp,
        book: inBook,
        forced: new Chess(fen).moves().length === 1,
        onlyMove: top && isOnlyMove(best.bestCp, second ? scoreToCp(second.score) : undefined),
        sacrifice: !!offeredMaterial(fen, uci),
        beforeCp: best.bestCp,
        afterCp: -after.bestCp,
        chance: (!!tactic && !played) || (i > 0 && (labels[i - 1] === 'mistake' || labels[i - 1] === 'blunder' || labels[i - 1] === 'overlooked')),
        passedUp: missedMate || missedWin,
      }),
    );

    if (mover === me) {
      if (tactic && played) {
        add({ kind: 'found-tactic', fen, played: uci, line: ucisOf(tactic), concept: lineConceptOf(fen, ucisOf(tactic), previous, tactic.motif) }, 50 + tactic.gain * 20);
      } else if (tactic && (missedMate || missedWin)) {
        // A missed mate stays a missed mate when the move also blunders: what it allows is kept as the answer.
        const refutation = missedMate && lossCp >= cutoff ? taught(after) : undefined;
        add(
          {
            kind: 'missed-tactic',
            fen,
            played: uci,
            better: tactic.moves[0].uci,
            line: ucisOf(tactic),
            answer: refutation ? ucisOf(refutation) : undefined,
            concept: lineConceptOf(fen, ucisOf(tactic), previous, tactic.motif),
          },
          missedMate ? MATE_CP : 50 + tactic.gain * 20,
        );
      } else if (lossCp >= cutoff && !top && !inBook) {
        const refutation = taught(after);
        if (refutation) {
          add(
            {
              kind: 'mistake',
              fen,
              played: uci,
              better: betterLine[0],
              line: betterLine,
              answer: ucisOf(refutation),
              lossCp,
              concept: lineConceptOf(fens[i + 1], ucisOf(refutation), { fen, uci }, refutation.motif),
            },
            lossCp,
          );
        } else if (tactic) {
          add({ kind: 'missed-tactic', fen, played: uci, better: tactic.moves[0].uci, line: ucisOf(tactic), lossCp, concept: lineConceptOf(fen, ucisOf(tactic), previous, tactic.motif) }, lossCp);
        } else if (betterLine.length) {
          // A big drop with nothing the detectors can name (positional): the coach says so.
          add({ kind: 'mistake', fen, played: uci, better: betterLine[0], line: betterLine, lossCp }, lossCp);
        }
      }
    } else {
      const coveredByMistake = drafts.some((d) => d.ply === i && d.kind === 'mistake' && d.answer?.[0] === uci);
      if (tactic && uci === tactic.moves[0].uci && !coveredByMistake) {
        add({ kind: 'their-tactic', fen, played: uci, line: ucisOf(tactic), concept: lineConceptOf(fen, ucisOf(tactic), previous, tactic.motif) }, 50 + tactic.gain * 20);
      } else if (lossCp >= cutoff && !top && !inBook) {
        const punish = taught(after);
        add(
          {
            kind: 'their-blunder',
            fen,
            played: uci,
            better: betterLine[0],
            lossCp,
            line: punish ? ucisOf(punish) : undefined,
            concept: punish ? lineConceptOf(fens[i + 1], ucisOf(punish), { fen, uci }, punish.motif) : undefined,
          },
          lossCp,
        );
      }
    }
    opts.onProgress?.(i + 1, n);
  }
  if (opts.signal?.aborted) return undefined;

  // Their blunder and my answer to it are one moment: the answer says what was available.
  const kept = drafts.filter((d) => {
    if (d.kind !== 'their-blunder') return true;
    const reply = drafts.find((r) => r.ply === d.ply + 1 && (r.kind === 'found-tactic' || r.kind === 'missed-tactic' || r.kind === 'mistake'));
    if (reply) reply.prompted = true;
    return !reply;
  });
  const chosen = [...kept].sort((a, b) => (score.get(b) ?? 0) - (score.get(a) ?? 0)).slice(0, MAX_MOMENTS).sort((a, b) => a.ply - b.ply);

  const seen = new Set<NoteConcept>();
  const out: ReviewedGame = { remarks: [], moments: [], curve: evals.map((e, k) => curveValue(fens[k], e)), labels };
  for (const d of chosen) {
    const { ply, ...moment } = d;
    const words = momentWords(moment, ply, { startFen: game.startFen, me, opponent: game.opponent, seen });
    const remark: Remark = {
      kind: moment.kind === 'mistake' ? 'mistake' : moment.kind === 'missed-tactic' ? 'missed-tactic' : moment.kind === 'found-tactic' ? 'praise' : 'narration',
      text: words.text,
      mood: moment.kind === 'mistake' || moment.kind === 'missed-tactic' ? 'concerned' : moment.kind === 'found-tactic' ? 'pleased' : 'thinking',
      moment,
      // The phrase is picked when the moment is shown (the screen's budget), from this.
      cue: cueForMoment(moment.kind, moment.lossCp),
    };
    out.remarks.push({ ply, remark });
    out.moments.push({ ...moment, ply, text: words.text });
  }
  return out;
}

/**
 * The material (pawns) the side to move at `fen` has gained after the first `plies` moves of `ucis`, read on
 * through any captures still pending, so a count is never taken in the middle of an exchange.
 */
function materialAfter(fen: string, ucis: string[], plies: number): number {
  const chess = new Chess(fen);
  const side = chess.turn();
  const start = materialBalance(chess, side);
  let gain = 0;
  for (let i = 0; i < ucis.length; i++) {
    let move;
    try {
      move = new Chess(chess.fen()).move({ from: ucis[i].slice(0, 2), to: ucis[i].slice(2, 4), promotion: ucis[i][4] });
    } catch {
      break;
    }
    if (i >= plies && !move.captured) break;
    chess.move(move.san);
    gain = materialBalance(chess, side) - start;
  }
  return gain;
}

/** White's evaluation of a position, in whole centipawns, clamped (mates count as the cap). */
function curveValue(fen: string, ev: PositionEval): number {
  const white = fen.split(' ')[1] === 'w' ? ev.bestCp : -ev.bestCp;
  return Math.max(-CURVE_CAP, Math.min(CURVE_CAP, Math.round(white)));
}
