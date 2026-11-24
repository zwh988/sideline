// Review: the coach looks at a whole game that was already played. Unlike the
// live coach, it was asked to look, so rule 3 ("mostly stays quiet") shows up
// differently here: it checks every pattern at every level, for BOTH sides, and
// keeps only the biggest moments (the cap), most costly first. The player's
// level decides only how big a swing is worth listing (`mistakeCp`), how big a
// win counts as a tactic (`minGain`), and that a pattern beyond the level is
// tagged as such; it never hides a pattern.
//
// One engine search per position (n + 1 for n moves), which also gives the
// evaluation curve. The caller decides how to keep the page responsive: the
// engine runs in a worker, this loop awaits one move at a time, reports
// progress after each and stops at the next move when the signal is aborted.
import { Chess, type Color } from 'chess.js';
import type { Level } from '../app/levels';
import type { SavedMoment } from '../app/store';
import type { Analyst, PositionEval } from './analyst';
import { lineConceptOf } from './explain';
import { isMereRecapture, type TaughtLine } from './lines';
import { moveLoss } from './linecheck';
import type { Moment, Remark } from './coach';
import type { NoteConcept } from './explain';
import type { OpeningBook } from './openings';
import { momentWords } from './reviewwords';

export interface ReviewedGame {
  /** The coach's remarks that carry a moment, with the ply (moves played) they belong to. */
  remarks: { ply: number; remark: Remark }[];
  moments: SavedMoment[];
  /** White's evaluation after 0..n moves, in centipawns, clamped to ±CURVE_CAP. */
  curve: number[];
}

export interface ReviewOptions {
  level: Level;
  signal?: AbortSignal;
  /** Known openings: a move inside theory is not flagged. */
  book?: OpeningBook;
  /** Called after each move of the game has been handled (`done` of `total` plies). */
  onProgress?: (done: number, total: number) => void;
}

/** How far a line is read for a tactic (all patterns, whatever the level). */
const TACTIC_PLIES = 10;
/** Moments kept per game, most costly first (Review is thorough, not endless). */
export const MAX_MOMENTS = 8;
export const CURVE_CAP = 1000;
const MATE_CP = 90000;

type Draft = Moment & { ply: number };

/** The engine's view of a position; a finished game is scripted (a mated side is lost, a draw is level). */
async function evalAt(analyst: Analyst, fen: string): Promise<PositionEval> {
  const chess = new Chess(fen);
  if (chess.isCheckmate()) return { fen, bestCp: -(MATE_CP + 10000), lines: [] };
  if (chess.isGameOver()) return { fen, bestCp: 0, lines: [] };
  return analyst.evaluate(fen, 1);
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
  const limits = { maxPlies: TACTIC_PLIES, minGain: opts.level.minGain };
  const cutoff = opts.level.mistakeCp;
  const n = game.moves.length;

  const chess = new Chess(game.startFen);
  const fens = [chess.fen()];
  for (const uci of game.moves) {
    chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    fens.push(chess.fen());
  }

  // Every pattern is looked for, but the shortest teachable version of a line is the one shown: the level's
  // own length first, a longer reading only when that finds nothing (then it is tagged as beyond the level).
  const taught = (ev: PositionEval): TaughtLine | undefined => {
    const short = analyst.taughtLine(ev, { ...limits, maxPlies: Math.max(opts.level.maxPlies, 3) });
    if (short.kind === 'line') return short.line;
    const cut = analyst.taughtLine(ev, limits);
    return cut.kind === 'line' ? cut.line : undefined;
  };
  const beyond = (line: TaughtLine) => !opts.level.motifs.includes(line.motif);
  const ucisOf = (line: TaughtLine) => line.moves.map((m) => m.uci);

  const evals: PositionEval[] = [await evalAt(analyst, fens[0])];
  const drafts: Draft[] = [];
  const score = new Map<Draft, number>();

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
    if (tactic && isMereRecapture(tactic, previous, opts.level.minGain)) tactic = undefined;
    const betterLine = tactic ? ucisOf(tactic) : (best.lines[0]?.pv ?? []).slice(0, 3);
    const add = (d: Omit<Draft, 'ply'>, s: number) => {
      const draft = { ...d, ply: i + 1 };
      drafts.push(draft);
      score.set(draft, s);
    };

    if (mover === me) {
      if (tactic && uci === tactic.moves[0].uci) {
        add({ kind: 'found-tactic', fen, played: uci, line: ucisOf(tactic), concept: lineConceptOf(fen, ucisOf(tactic), previous, tactic.motif), beyond: beyond(tactic) || undefined }, 50 + tactic.gain * 20);
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
              beyond: beyond(refutation) || undefined,
            },
            lossCp,
          );
        } else if (tactic) {
          add({ kind: 'missed-tactic', fen, played: uci, better: tactic.moves[0].uci, line: ucisOf(tactic), lossCp, concept: lineConceptOf(fen, ucisOf(tactic), previous, tactic.motif), beyond: beyond(tactic) || undefined }, lossCp);
        } else if (betterLine.length) {
          // A big drop with nothing the detectors can name (positional): the coach says so.
          add({ kind: 'mistake', fen, played: uci, better: betterLine[0], line: betterLine, lossCp }, lossCp);
        }
      }
    } else {
      const coveredByMistake = drafts.some((d) => d.ply === i && d.kind === 'mistake' && d.answer?.[0] === uci);
      if (tactic && uci === tactic.moves[0].uci && !coveredByMistake) {
        add({ kind: 'their-tactic', fen, played: uci, line: ucisOf(tactic), concept: lineConceptOf(fen, ucisOf(tactic), previous, tactic.motif), beyond: beyond(tactic) || undefined }, 50 + tactic.gain * 20);
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
            beyond: (punish && beyond(punish)) || undefined,
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
  const out: ReviewedGame = { remarks: [], moments: [], curve: evals.map((e, k) => curveValue(fens[k], e)) };
  for (const d of chosen) {
    const { ply, ...moment } = d;
    const words = momentWords(moment, ply, { startFen: game.startFen, me, opponent: game.opponent, seen });
    const remark: Remark = {
      kind: moment.kind === 'mistake' ? 'mistake' : moment.kind === 'missed-tactic' ? 'missed-tactic' : moment.kind === 'found-tactic' ? 'praise' : 'narration',
      text: words.text,
      mood: moment.kind === 'mistake' || moment.kind === 'missed-tactic' ? 'concerned' : moment.kind === 'found-tactic' ? 'pleased' : 'thinking',
      shapes: words.shapes,
      moment,
    };
    out.remarks.push({ ply, remark });
    out.moments.push({ ...moment, ply, text: words.text });
  }
  return out;
}

/** White's evaluation of a position, in whole centipawns, clamped (mates count as the cap). */
function curveValue(fen: string, ev: PositionEval): number {
  const white = fen.split(' ')[1] === 'w' ? ev.bestCp : -ev.bestCp;
  return Math.max(-CURVE_CAP, Math.min(CURVE_CAP, Math.round(white)));
}
