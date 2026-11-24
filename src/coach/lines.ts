// Which lines get taught (spec): the engine's main line can run 20+ moves;
// only the forcing stretch up to the payoff is taught. Walk the line move by
// move and cut it at the first point where all three hold:
//   1. The payoff has happened: checkmate, or material changed and stays changed.
//   2. Nothing is left to settle: no capture pending, and the material holds
//      through the next few moves (so checks that win nothing back don't count).
//   3. Material matches the engine's evaluation (else extend, or flag the rest as positional).
import { Chess, type Color } from 'chess.js';
import { VALUE, materialBalance, playAndDescribe, type MoveFacts } from './facts';

export type Motif =
  | 'mate-in-1'
  | 'mate-in-2'
  | 'mate'
  | 'fork'
  | 'discovered-attack'
  | 'hanging-piece'
  | 'winning-material';

export interface TaughtLine {
  rootFen: string;
  /** The side the line is good for (to move at the root). */
  side: Color;
  moves: MoveFacts[];
  /** Material won by `side`, in pawns (0 for a mate). */
  gain: number;
  mate: boolean;
  motif: Motif;
  /** The engine sees clearly more than the material: part of the advantage is positional. */
  positionalRest: boolean;
  /** Pawns the engine's line gives back later, after the taught part (0 if none). */
  laterLoss: number;
}

export type CutResult =
  | { kind: 'line'; line: TaughtLine }
  | { kind: 'too-deep'; plies: number } // a payoff exists but beyond the level's limit
  | { kind: 'none' };

export interface CutOptions {
  maxPlies: number;
  minGain: number;
  /** Engine score for the side to move at the root, in centipawns (ignored for mates). */
  evalCp: number;
  /** Engine mate score for the side to move: moves to mate, if any. */
  mateIn?: number;
}

/** How far to read along the engine line. */
const SCAN_PLIES = 16;
/** A gain "stays" if it holds for this many moves (both sides) after the cut. */
const STAY_PLIES = 4;
/** Engine sees this many pawns more than the material won: the rest is positional. */
const POSITIONAL_MARGIN = 2.5;

export function cutLine(rootFen: string, pv: string[], opts: CutOptions): CutResult {
  const chess = new Chess(rootFen);
  const side = chess.turn();
  const start = materialBalance(chess, side);

  const facts: MoveFacts[] = [];
  const gains: number[] = [];
  for (const uci of pv.slice(0, SCAN_PLIES)) {
    try {
      facts.push(playAndDescribe(chess, uci));
    } catch {
      break; // engine line no longer legal (shouldn't happen); use what we have
    }
    gains.push(materialBalance(chess, side) - start);
    if (chess.isGameOver()) break;
  }
  if (!facts.length) return { kind: 'none' };
  // "Stays changed": the least material held during the next few moves.
  // Losses further down the engine line are a separate, later story.
  const kept = (i: number) => Math.min(...gains.slice(i, i + STAY_PLIES + 1));

  const candidates: number[] = [];
  for (let i = 0; i < facts.length; i++) {
    const f = facts[i];
    if (f.mate) {
      if (f.color === side) candidates.push(i);
      break;
    }
    if (opts.mateIn !== undefined && opts.mateIn > 0) continue; // only the mate is the payoff
    const payoff = kept(i) >= opts.minGain;
    // Never cut mid-exchange: no capture may be pending. Checks or threats
    // after the cut only matter if they win material back, and `kept`
    // already covers that (spite checks don't block the cut).
    const next = facts[i + 1];
    const settled = !next?.captured;
    if (payoff && settled) candidates.push(i);
  }
  if (!candidates.length) return { kind: 'none' };

  // Rule 3: prefer the first cut where material roughly matches the evaluation.
  const matches = (i: number) =>
    facts[i].mate || opts.evalCp / 100 - kept(i) <= POSITIONAL_MARGIN;
  const within = candidates.filter((i) => i < opts.maxPlies);
  if (!within.length) return { kind: 'too-deep', plies: candidates[0] + 1 };
  const cut = within.find(matches) ?? within[0];

  const moves = facts.slice(0, cut + 1);
  const mate = moves[cut].mate;
  return {
    kind: 'line',
    line: {
      rootFen,
      side,
      moves,
      gain: mate ? 0 : kept(cut),
      mate,
      motif: motifOf(moves, side, mate),
      positionalRest: !mate && !matches(cut),
      laterLoss: mate ? 0 : Math.max(0, kept(cut) - gains[gains.length - 1]),
    },
  };
}

/** Names the line's main pattern from the winning side's moves. */
export function motifOf(moves: MoveFacts[], side: Color, mate: boolean): Motif {
  const own = moves.filter((m) => m.color === side);
  if (mate) return own.length === 1 ? 'mate-in-1' : own.length === 2 ? 'mate-in-2' : 'mate';
  if (own.some((m) => m.doubleAttack)) return 'fork';
  if (own.some((m) => m.discovered)) return 'discovered-attack';
  // Piece safety (Level 1): a piece that can simply be taken, either because
  // nobody defends it or because the taker is worth less, so a recapture
  // doesn't make up for it. The line is just "take" or "take, take back".
  if (moves[0].captured && moves.length <= 2) return 'hanging-piece';
  return 'winning-material';
}

/**
 * The line only takes back what the opponent's last move just took (an even
 * trade): its gain, counted from before that capture, is below `minGain`.
 * `previous` is the opponent's move that led to the line's root position.
 */
export function isMereRecapture(line: TaughtLine, previous: { fen: string; uci: string } | undefined, minGain: number): boolean {
  if (!previous || line.mate) return false;
  let taken;
  const chess = new Chess(previous.fen);
  try {
    taken = chess.move({ from: previous.uci.slice(0, 2), to: previous.uci.slice(2, 4), promotion: previous.uci[4] });
  } catch {
    return false;
  }
  if (chess.fen().split(' ')[0] !== line.rootFen.split(' ')[0]) return false; // not the move that led here
  if (!taken.captured || line.moves[0].to !== taken.to) return false;
  return line.gain - VALUE[taken.captured] < minGain;
}
