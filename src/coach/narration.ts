// Facts for the coach thinking aloud on its own moves (spec: "The coach's
// three jobs", job 2, and "Honest narration"). Everything here comes from
// the board (facts.ts) or from engine lines passed in by the coach; the
// templates only word it.
//
//   - what the player's last move threatened, and how the coach's move dealt with it,
//   - the coach's own captures, checks and promotions,
//   - why it chose a quiet move (castling, developing, a centre pawn).
//
// The coach's own new threats are not narrated: when they are within the
// player's level, the coach asks "what does my last move want?" instead of
// giving the answer away.
import { Chess, type Square } from 'chess.js';
import { playAndDescribe, VALUE, type MoveFacts, type Target } from './facts';
import type { TaughtLine } from './lines';

/** How the coach's move dealt with the player's threat. */
export type Handled =
  | 'moved' // the threatened piece moved
  | 'took-attacker' // the coach took the piece that would make the threat
  | 'defended' // the threatened piece gained a defender
  | 'blocked' // the threatening move is no longer legal
  | 'other'; // the engine finds the threat gone, for a reason not named here

export type Intent = 'castle' | 'develop' | 'centre-pawn';

/** Compared with Stockfish's best move, from the coach's side. */
export type Quality = 'best' | 'fine' | 'inaccuracy' | 'mistake';

export interface CoachMoveFacts {
  move: MoveFacts;
  /** The player's previous move, if any. */
  lastMove?: { san: string; to: Square };
  /** The player's threat before the coach moved, and how the coach's move answered it. */
  threat?: { line: TaughtLine; victim?: Target; handled: Handled };
  /** The coach captured on the square where the player just captured. */
  recapture: boolean;
  /** Where the captured piece stood (differs from the move's square only en passant). */
  capturedOn?: Square;
  intent?: Intent;
  /** Centipawns the move loses against Stockfish's best (0 or more). */
  lossCp: number;
  quality: Quality;
}

export interface CoachMoveInput {
  fenBefore: string;
  uci: string;
  lastMove?: { san: string; to: Square };
  /** What the player threatened before the coach moved (a teachable line, from the analyst). */
  playerThreat?: TaughtLine;
  /** The player's best teachable line after the coach's move, if any. */
  playerLineAfter?: TaughtLine;
  lossCp: number;
  /** A loss of this much counts as a mistake (the level's threshold). */
  mistakeCp: number;
  /** Plies played so far in the game (before this move), for "opening" intents. */
  ply: number;
}

/** Within this many centipawns of Stockfish's best counts as the best move. */
export const BEST_CP = 20;
/** Up to this many centipawns lost counts as fine. */
export const FINE_CP = 80;
/** Developing and centre-pawn reasons are only given this early. */
const OPENING_PLIES = 24;

export function qualityOf(lossCp: number, mistakeCp: number): Quality {
  if (lossCp <= BEST_CP) return 'best';
  if (lossCp <= FINE_CP) return 'fine';
  if (lossCp < mistakeCp) return 'inaccuracy';
  return 'mistake';
}

export function coachMoveFacts(input: CoachMoveInput): CoachMoveFacts {
  const before = new Chess(input.fenBefore);
  const chess = new Chess(input.fenBefore);
  const move = playAndDescribe(chess, input.uci);
  const coach = move.color;

  const capturedOn = move.captured ? (before.get(move.to) ? move.to : epSquare(move)) : undefined;
  const recapture = !!move.captured && !!input.lastMove && input.lastMove.san.includes('x') && input.lastMove.to === move.to;

  let threat: CoachMoveFacts['threat'];
  const t = input.playerThreat;
  if (t && isHandled(t, input.playerLineAfter)) {
    const victim = victimOf(t);
    threat = { line: t, victim, handled: howHandled(t, victim, move, before, chess) };
  }

  return {
    move,
    lastMove: input.lastMove,
    threat,
    recapture,
    capturedOn,
    intent: intentOf(move, coach, input.ply),
    lossCp: Math.max(0, input.lossCp),
    quality: qualityOf(input.lossCp, input.mistakeCp),
  };
}

/**
 * The player's threat is gone: after the coach's move the player has no
 * teachable line that starts the same way, and none that wins as much.
 */
function isHandled(threat: TaughtLine, after: TaughtLine | undefined): boolean {
  if (!after) return true;
  if (after.moves[0].uci === threat.moves[0].uci) return false;
  if (after.mate) return false;
  return !threat.mate && after.gain < threat.gain;
}

/** The coach's most valuable piece the threat would capture (none for a mate threat). */
function victimOf(line: TaughtLine): Target | undefined {
  if (line.mate) return undefined;
  const captures = line.moves.filter((m) => m.color === line.side && m.captured);
  captures.sort((x, y) => VALUE[y.captured!] - VALUE[x.captured!]);
  const m = captures[0];
  return m ? { square: m.to, piece: m.captured! } : undefined;
}

function howHandled(line: TaughtLine, victim: Target | undefined, move: MoveFacts, before: Chess, after: Chess): Handled {
  const first = line.moves[0];
  if (move.to === first.from) return 'took-attacker';
  if (victim && move.from === victim.square) return 'moved';
  if (victim) {
    const piece = after.get(victim.square);
    if (piece && piece.color === move.color && piece.type === victim.piece) {
      const was = before.attackers(victim.square, move.color).length;
      if (after.attackers(victim.square, move.color).length > was) return 'defended';
    }
  }
  // The threatening move can't be played any more (e.g. a piece now stands in the way).
  // It's the player's turn again, so their moves can be listed directly.
  const legal = after.moves({ verbose: true }).some((m) => m.from === first.from && m.to === first.to);
  return legal ? 'other' : 'blocked';
}

function intentOf(move: MoveFacts, coach: 'w' | 'b', ply: number): Intent | undefined {
  if (move.san.startsWith('O-O')) return 'castle';
  if (ply >= OPENING_PLIES || move.captured) return undefined;
  const homeRank = coach === 'w' ? '1' : '8';
  if ((move.piece === 'n' || move.piece === 'b') && move.from[1] === homeRank) return 'develop';
  if (move.piece === 'p' && ['d4', 'e4', 'd5', 'e5'].includes(move.to)) return 'centre-pawn';
  return undefined;
}

/** The pawn taken en passant stands beside the capturing pawn's new square. */
function epSquare(move: MoveFacts): Square {
  return `${move.to[0]}${move.from[1]}` as Square;
}
