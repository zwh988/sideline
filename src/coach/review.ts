// Moment-finding over a whole game that was already played (an imported one).
// It runs the same Coach as a live game, position by position, so a mistake, a
// missed tactic or a found tactic is judged by exactly the same rules; only the
// mode differs (REVIEW: no prompts, no takebacks, no small talk).
//
// The caller decides how to keep the page responsive: the engine runs in a
// worker, this loop awaits one move at a time, reports progress after each move
// and stops at the next move when the signal is aborted.
import { Chess } from 'chess.js';
import type { Level } from '../app/levels';
import { REVIEW } from '../app/modes';
import type { SavedMoment } from '../app/store';
import type { Analyst } from './analyst';
import type { OpeningBook } from './openings';
import { Coach, type Remark } from './coach';

export interface ReviewedGame {
  /** The coach's remarks that carry a moment, with the ply (moves played) they belong to. */
  remarks: { ply: number; remark: Remark }[];
  moments: SavedMoment[];
}

export interface ReviewOptions {
  level: Level;
  signal?: AbortSignal;
  /** Known openings: a move inside theory is not flagged as hung material. */
  book?: OpeningBook;
  /** Called after each move of the game has been handled (`done` of `total` plies). */
  onProgress?: (done: number, total: number) => void;
}

/**
 * Finds the moments of one side's moves. Returns undefined when cancelled
 * (nothing half-finished is returned).
 */
export async function reviewGame(
  analyst: Analyst,
  game: { startFen: string; moves: string[]; playerColor: 'white' | 'black' },
  opts: ReviewOptions,
): Promise<ReviewedGame | undefined> {
  await analyst.newGame();
  const me = game.playerColor === 'white' ? 'w' : 'b';
  const coach = new Coach(analyst, opts.level, me, REVIEW, opts.book);
  const chess = new Chess(game.startFen);
  const out: ReviewedGame = { remarks: [], moments: [] };
  for (let i = 0; i < game.moves.length; i++) {
    if (opts.signal?.aborted) return undefined;
    const uci = game.moves[i];
    const fenBefore = chess.fen();
    if (chess.turn() === me) {
      // The same two calls as in a live game (the first keeps the combination state right).
      await coach.onPlayerTurn(fenBefore, i);
      const remark = await coach.onPlayerMove(fenBefore, uci, i + 1);
      if (remark?.moment) {
        out.remarks.push({ ply: i + 1, remark });
        out.moments.push({ ...remark.moment, ply: i + 1, text: remark.text });
      }
    }
    chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    opts.onProgress?.(i + 1, game.moves.length);
  }
  if (opts.signal?.aborted) return undefined;
  return out;
}
