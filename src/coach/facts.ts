// Board facts for single moves: material, captures, checks, and simple
// motifs (hanging piece, double attack, discovered attack). Everything here
// is computed from the board, never guessed, so the coach can state it as fact.
import { Chess, SQUARES, type Color, type PieceSymbol, type Square } from 'chess.js';

export const VALUE: Record<PieceSymbol, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

export const PIECE_NAME: Record<PieceSymbol, string> = {
  p: 'pawn',
  n: 'knight',
  b: 'bishop',
  r: 'rook',
  q: 'queen',
  k: 'king',
};

export const other = (c: Color): Color => (c === 'w' ? 'b' : 'w');

/** Material of `color` minus the opponent's, in pawns. */
export function materialBalance(chess: Chess, color: Color): number {
  let sum = 0;
  for (const row of chess.board()) {
    for (const sq of row) if (sq) sum += sq.color === color ? VALUE[sq.type] : -VALUE[sq.type];
  }
  return sum;
}

export interface Target {
  square: Square;
  piece: PieceSymbol;
}

export interface MoveFacts {
  san: string;
  uci: string;
  from: Square;
  to: Square;
  color: Color;
  piece: PieceSymbol;
  captured?: PieceSymbol;
  /** The captured piece had no defenders before the capture. */
  capturedUndefended?: boolean;
  promotion?: PieceSymbol;
  check: boolean;
  mate: boolean;
  /** Enemy pieces the moved piece attacks after the move that are worth attacking. */
  attacks: Target[];
  /** The moved piece attacks two or more worthwhile targets at once (a fork). */
  doubleAttack: boolean;
  /** Another piece of the mover now attacks a worthwhile target (discovered attack). */
  discovered?: { by: Square; piece: PieceSymbol; target: Target };
  /** Filled in by the line analysis: the opponent had no reasonable alternative. */
  forced?: boolean;
}

/**
 * A target is worth attacking if it is the king, worth more than the
 * attacker, or an undefended piece (not a pawn).
 */
function worthwhileTargets(chess: Chess, from: Square, attackerValue: number, by: Color): Target[] {
  const targets: Target[] = [];
  for (const sq of SQUARES) {
    const p = chess.get(sq);
    if (!p || p.color === by) continue;
    if (!chess.attackers(sq, by).includes(from)) continue;
    const defended = chess.attackers(sq, p.color).length > 0;
    if (p.type === 'k' || VALUE[p.type] > attackerValue || (!defended && VALUE[p.type] >= 3)) {
      targets.push({ square: sq, piece: p.type });
    }
  }
  return targets;
}

/**
 * The piece on `sq` can't simply be taken: no cheaper enemy piece attacks it,
 * and if attacked at all, it is defended.
 */
function isSafe(chess: Chess, sq: Square): boolean {
  const p = chess.get(sq)!;
  const enemyAttackers = chess.attackers(sq, other(p.color));
  if (enemyAttackers.some((a) => VALUE[chess.get(a)!.type] < VALUE[p.type] && chess.get(a)!.type !== 'k')) return false;
  return enemyAttackers.length === 0 || chess.attackers(sq, p.color).length > 0;
}

/** Plays `uci` on `chess` (mutating it) and returns the facts about that move. */
export function playAndDescribe(chess: Chess, uci: string): MoveFacts {
  const from = uci.slice(0, 2) as Square;
  const to = uci.slice(2, 4) as Square;
  const color = chess.turn();
  const enemy = other(color);

  // Before the move: is the target defended, and which of our pieces already attack what?
  const targetBefore = chess.get(to);
  const capturedUndefended = targetBefore ? chess.attackers(to, enemy).length === 0 : undefined;
  const attackedBefore = new Map<Square, Square[]>();
  for (const sq of SQUARES) {
    const p = chess.get(sq);
    if (p && p.color === enemy) attackedBefore.set(sq, chess.attackers(sq, color));
  }

  const move = chess.move({ from, to, promotion: uci[4] as PieceSymbol | undefined });
  const piece = (move.promotion ?? move.piece) as PieceSymbol;
  const attacks = worthwhileTargets(chess, to, VALUE[piece] || 100, color);

  // Discovered attack: a different piece of ours attacks a valuable target it didn't before.
  let discovered: MoveFacts['discovered'];
  for (const sq of SQUARES) {
    const p = chess.get(sq);
    if (!p || p.color !== enemy || (p.type !== 'k' && VALUE[p.type] < 3)) continue;
    const before = attackedBefore.get(sq) ?? [];
    for (const by of chess.attackers(sq, color)) {
      if (by === to || before.includes(by)) continue;
      const attacker = chess.get(by)!;
      if (p.type === 'k' || VALUE[p.type] > VALUE[attacker.type]) {
        discovered = { by, piece: attacker.type, target: { square: sq, piece: p.type } };
      }
    }
  }

  return {
    san: move.san,
    uci,
    from,
    to,
    color,
    piece: move.piece as PieceSymbol,
    captured: move.captured as PieceSymbol | undefined,
    capturedUndefended: move.captured ? capturedUndefended : undefined,
    promotion: move.promotion as PieceSymbol | undefined,
    check: chess.inCheck(),
    mate: chess.isCheckmate(),
    attacks,
    // With check, the opponent must deal with the king first, so even an
    // attackable forking piece usually wins something; otherwise it must be safe.
    doubleAttack: attacks.length >= 2 && (chess.inCheck() || isSafe(chess, to)),
    discovered,
  };
}
