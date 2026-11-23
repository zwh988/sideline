// Concepts: the "why" behind a line. A concept is named only when board code
// found it in the line (rule 1: the engine decides what is true; templates
// only word facts). Names follow the Lichess puzzle themes, so a detector can
// be scored against Lichess's labelled puzzles (scripts/build-puzzles.mjs,
// `npm run concepts`) and players meet the same words they know from there.
import { Chess, type PieceSymbol, type Square } from 'chess.js';
import { VALUE, materialBalance, other, playAndDescribe, type MoveFacts } from './facts';
import { absolutePinWon, defendedBy, discoveredAttack, isTrapped, lineUps } from './motifs';

/** Themes we can detect today, by their Lichess names. */
export const DETECTABLE = [
  'mate',
  'mateIn1',
  'mateIn2',
  'mateIn3',
  'mateIn4',
  'mateIn5',
  'fork',
  'discoveredAttack',
  'hangingPiece',
  'backRankMate',
  'smotheredMate',
  'doubleCheck',
  'promotion',
  'pin',
  'skewer',
  'capturingDefender',
  'trappedPiece',
  'sacrifice',
] as const;

export type Concept = (typeof DETECTABLE)[number];

/**
 * Lichess themes that matter below ~1600 and have no detector yet (task 1.6c).
 * The harness reports them as "not detected" so the gap is visible.
 */
export const NOT_YET = [
  'deflection',
  'attraction',
  'quietMove',
  'defensiveMove',
  'interference',
  'clearance',
  'intermezzo',
  'xRayAttack',
  'exposedKing',
  'zugzwang',
] as const;

/** A puzzle as stored in the Lichess database: `moves[0]` is the opponent's move that sets it up. */
export interface PuzzleRecord {
  id: string;
  fen: string;
  moves: string[];
  rating: number;
  themes: string[];
}

/** The position the solver sees, and the solution (the solver's move first). */
export function puzzleStart(p: Pick<PuzzleRecord, 'fen' | 'moves'>): { fen: string; solution: string[] } {
  const chess = new Chess(p.fen);
  chess.move(uciMove(p.moves[0]));
  return { fen: chess.fen(), solution: p.moves.slice(1) };
}

function uciMove(uci: string) {
  return { from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] };
}

/**
 * The concepts in a solution line. `solution[0]` is the player's move from
 * `fen`; the replies alternate. Only the player's moves are described.
 */
export function detectConcepts(fen: string, solution: string[]): Set<Concept> {
  const found = new Set<Concept>();
  const chess = new Chess(fen);
  const player = chess.turn();
  const start = materialBalance(chess, player);
  // One step per move of the player's: the position before and after it.
  const steps: { before: Chess; after: Chess; facts: MoveFacts; discovered: boolean; reply?: { from: Square; to: Square; captured?: PieceSymbol } }[] = [];
  let mated: Chess | undefined;
  let matingMove: MoveFacts | undefined;

  for (let i = 0; i < solution.length; i++) {
    if (chess.turn() === player) {
      const before = new Chess(chess.fen());
      const facts = playAndDescribe(chess, solution[i]);
      const after = new Chess(chess.fen());
      steps.push({ before, after, facts, discovered: discoveredAttack(before, after, facts.to, player) });
      if (facts.check && isDoubleCheck(chess)) found.add('doubleCheck');
      if (facts.mate) {
        mated = after;
        matingMove = facts;
      }
    } else {
      const m = chess.move(uciMove(solution[i]));
      const last = steps.at(-1);
      if (last) last.reply = { from: m.from, to: m.to, captured: m.captured };
    }
  }
  const facts = steps.map((s) => s.facts);

  // The key idea is in the first moves; later ones are follow-up.
  const early = steps.slice(0, 2);
  if (early.some((s) => s.facts.doubleAttack && !s.facts.mate)) found.add('fork');
  if (early.some((s) => s.facts.discovered || s.discovered)) found.add('discoveredAttack');
  if (facts[0]?.captured && facts[0].capturedUndefended && !facts[0].mate) found.add('hangingPiece');
  if (facts.some((f) => f.promotion)) found.add('promotion');

  // Skewers: set up by the moved piece, and cashed in later (the line takes the front or back piece).
  early.forEach((s, i) => {
    const later = steps.slice(i + 1).map((t) => t.facts);
    for (const l of lineUps(s.after, player)) {
      if (l.kind !== 'skewer' || l.by !== s.facts.to) continue;
      if (later.some((f) => f.captured && (f.to === l.front.square || f.to === l.back.square))) found.add('skewer');
    }
  });

  // Pins (as Lichess tags them): after one of the player's moves an enemy piece is pinned to its king
  // and attacked along the pin by something worth less.
  if (steps.some((s) => absolutePinWon(s.after, player))) found.add('pin');

  // Capturing a defender: take a piece that defended another, which is then left without
  // a defender and taken.
  early.forEach((s, i) => {
    if (!s.facts.captured) return;
    const defended = defendedBy(s.before, s.facts.to, other(player));
    const later = steps.slice(i + 1).map((t) => t.facts);
    if (
      defended.some(
        (d) => VALUE[d.type] >= 3 && s.after.attackers(d.square, other(player)).length === 0 && later.some((f) => f.captured && f.to === d.square),
      )
    ) {
      found.add('capturingDefender');
    }
  });

  // A trapped piece: the player takes a knight, bishop, rook or queen that had no safe square
  // before the opponent's reply (it may have moved there: then from where it came).
  steps.forEach((s, j) => {
    if (j === 0 || !s.facts.captured || s.facts.captured === 'p') return;
    const prev = steps[j - 1];
    const square = prev.reply && prev.reply.to === s.facts.to ? prev.reply.from : s.facts.to;
    if (isTrapped(prev.after, square, player)) found.add('trappedPiece');
  });

  // A sacrifice: a piece of the player's is taken at once and is worth at least two pawns more than
  // what the move itself took, yet the player ends up level or ahead (or mates).
  const net = materialBalance(chess, player) - start;
  if (
    early.some((s) => s.reply?.captured && s.reply.to === s.facts.to && VALUE[s.facts.piece] - (s.facts.captured ? VALUE[s.facts.captured] : 0) >= 2) &&
    (mated || net >= -1)
  ) {
    found.add('sacrifice');
  }

  if (mated && matingMove) {
    found.add('mate');
    const n = facts.length;
    if (n >= 1 && n <= 5) found.add(`mateIn${n}` as Concept);
    if (isBackRankMate(mated, matingMove)) found.add('backRankMate');
    if (isSmotheredMate(mated, matingMove)) found.add('smotheredMate');
  }
  return found;
}

function kingSquare(chess: Chess, color: 'w' | 'b'): Square {
  for (const row of chess.board()) for (const sq of row) if (sq && sq.type === 'k' && sq.color === color) return sq.square;
  throw new Error('no king');
}

/** Squares next to `sq` on the board. */
function neighbours(sq: Square): Square[] {
  const file = sq.charCodeAt(0) - 97;
  const rank = Number(sq[1]);
  const out: Square[] = [];
  for (let df = -1; df <= 1; df++) {
    for (let dr = -1; dr <= 1; dr++) {
      if (!df && !dr) continue;
      const f = file + df;
      const r = rank + dr;
      if (f >= 0 && f < 8 && r >= 1 && r <= 8) out.push((String.fromCharCode(97 + f) + r) as Square);
    }
  }
  return out;
}

/**
 * Checkmate by a rook or queen along the king's back rank, where the king's
 * own pieces block its way out (the squares on the next rank are all filled
 * by its own side or unreachable).
 */
function isBackRankMate(after: Chess, move: MoveFacts): boolean {
  const loser = after.turn();
  const king = kingSquare(after, loser);
  const home = loser === 'w' ? '1' : '8';
  if (king[1] !== home) return false;
  if (move.piece !== 'r' && move.piece !== 'q') return false;
  if (move.to[1] !== home) return false; // gives check along the rank
  const forward = loser === 'w' ? 2 : 7;
  const ahead = neighbours(king).filter((s) => Number(s[1]) === forward);
  return ahead.length > 0 && ahead.every((s) => after.get(s)?.color === loser);
}

/** Checkmate by a knight while the king's own pieces fill every square around it. */
function isSmotheredMate(after: Chess, move: MoveFacts): boolean {
  if (move.piece !== 'n') return false;
  const loser = after.turn();
  const king = kingSquare(after, loser);
  return neighbours(king).every((s) => after.get(s)?.color === loser);
}

/** The side to move is in check from two pieces at once. */
function isDoubleCheck(after: Chess): boolean {
  const loser = after.turn();
  return after.attackers(kingSquare(after, loser), other(loser)).length >= 2;
}
