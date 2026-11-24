// Board geometry for concepts: pins, skewers, discovered attacks, trapped
// pieces. Pure functions over chess.js positions, no engine. Used by
// concepts.ts; each is scored against Lichess's labelled puzzles.
import { Chess, type Color, type PieceSymbol, type Square } from 'chess.js';
import { VALUE, other } from './facts';

const DIAGONALS = [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const;
const LINES = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;

const square = (file: number, rank: number): Square | undefined =>
  file < 0 || file > 7 || rank < 1 || rank > 8 ? undefined : ((String.fromCharCode(97 + file) + rank) as Square);

interface Placed {
  square: Square;
  type: PieceSymbol;
  color: Color;
}

/** The first two pieces met walking from `from` in direction (df, dr). */
function firstTwo(chess: Chess, from: Square, df: number, dr: number): Placed[] {
  const found: Placed[] = [];
  let f = from.charCodeAt(0) - 97 + df;
  let r = Number(from[1]) + dr;
  for (let s = square(f, r); s && found.length < 2; s = square((f += df), (r += dr))) {
    const p = chess.get(s);
    if (p) found.push({ square: s, type: p.type, color: p.color });
  }
  return found;
}

export interface LineUp {
  kind: 'pin' | 'skewer';
  /** The attacking bishop, rook or queen. */
  by: Square;
  /** The enemy piece nearest to it. */
  front: Placed;
  /** The enemy piece behind it. */
  back: Placed;
}

/**
 * Pins and skewers by `color`'s sliders: an enemy piece with another enemy
 * piece directly behind it on the same line.
 * - **Pin:** the piece behind is the king or worth more than the front piece,
 *   so the front piece shouldn't move.
 * - **Skewer:** the front piece is the king or worth more than the one
 *   behind, so when it moves away, the piece behind is taken.
 */
export function lineUps(chess: Chess, color: Color): LineUp[] {
  const out: LineUp[] = [];
  for (const row of chess.board()) {
    for (const p of row) {
      if (!p || p.color !== color || (p.type !== 'b' && p.type !== 'r' && p.type !== 'q')) continue;
      const dirs = p.type === 'b' ? DIAGONALS : p.type === 'r' ? LINES : [...DIAGONALS, ...LINES];
      for (const [df, dr] of dirs) {
        const [front, back] = firstTwo(chess, p.square, df, dr);
        if (!front || !back || front.color === color || back.color === color) continue;
        if (back.type === 'k' || (front.type !== 'k' && VALUE[back.type] > VALUE[front.type])) {
          out.push({ kind: 'pin', by: p.square, front, back });
        } else if (front.type === 'k' || (VALUE[front.type] > VALUE[back.type] && back.type !== 'p')) {
          out.push({ kind: 'skewer', by: p.square, front, back });
        }
      }
    }
  }
  return out;
}

/** How many of `color`'s pieces attack `sq` versus how many defend the piece on it. */
function pressure(chess: Chess, sq: Square, attacker: Color): { attackers: number; defenders: number } {
  return { attackers: chess.attackers(sq, attacker).length, defenders: chess.attackers(sq, other(attacker)).length };
}

/**
 * A discovered attack: the move uncovered a line, so a piece other than the
 * one that moved now attacks something worth attacking: the king, a more
 * valuable piece, an undefended piece, or a piece attacked more often than it
 * is defended. `before` is the position before the move, `after` after it.
 */
export function discoveredAttack(before: Chess, after: Chess, movedTo: Square, color: Color): boolean {
  const enemy = other(color);
  for (const row of after.board()) {
    for (const t of row) {
      if (!t || t.color !== enemy) continue;
      if (t.type !== 'k' && VALUE[t.type] < 3) continue;
      const was = new Set(before.attackers(t.square, color));
      const { attackers, defenders } = pressure(after, t.square, color);
      for (const by of after.attackers(t.square, color)) {
        if (by === movedTo || was.has(by)) continue;
        const attacker = after.get(by)!;
        if (
          t.type === 'k' ||
          VALUE[t.type] > VALUE[attacker.type] ||
          defenders === 0 ||
          attackers > defenders
        ) {
          return true;
        }
      }
    }
  }
  return false;
}

/**
 * Enemy pieces (a knight or more) that `color` attacks and cannot get away:
 * every square they could move to is attacked by `color`, and the piece is
 * undefended or attacked by something cheaper. Evaluated with the enemy to
 * move (`chess` is the position after `color`'s move).
 */
export function trappedPieces(chess: Chess, color: Color): Placed[] {
  const enemy = other(color);
  if (chess.turn() !== enemy || chess.inCheck()) return []; // in check, other pieces can't move at all: not "trapped"
  const out: Placed[] = [];
  for (const row of chess.board()) {
    for (const p of row) {
      if (!p || p.color !== enemy || p.type === 'k' || VALUE[p.type] < 3) continue;
      const attackers = chess.attackers(p.square, color);
      if (!attackers.length) continue;
      const cheapest = Math.min(...attackers.map((a) => VALUE[chess.get(a)!.type] || 100));
      if (chess.attackers(p.square, enemy).length && cheapest >= VALUE[p.type]) continue; // defended and not won by a cheaper piece
      const moves = chess.moves({ square: p.square, verbose: true });
      if (moves.every((m) => chess.attackers(m.to, color).length > 0)) out.push({ square: p.square, type: p.type, color: p.color });
    }
  }
  return out;
}

/** The enemy pieces `piece` (on `sq`, of `color`) currently defends. */
export function defendedBy(chess: Chess, sq: Square, color: Color): Placed[] {
  const out: Placed[] = [];
  for (const row of chess.board()) {
    for (const t of row) {
      if (t && t.color === color && t.square !== sq && chess.attackers(t.square, color).includes(sq)) {
        out.push({ square: t.square, type: t.type, color: t.color });
      }
    }
  }
  return out;
}

/**
 * A piece the side to move cannot save: not in check, not pinned, a knight,
 * bishop, rook or queen, and none of its moves reaches a square that is safe
 * (every escape square is attacked by `by`, or it would only take something
 * worth less than itself).
 */
export function isTrapped(chess: Chess, sq: Square, by: Color): boolean {
  const piece = chess.get(sq);
  if (!piece || piece.color !== chess.turn() || chess.inCheck()) return false;
  if (!['n', 'b', 'r', 'q'].includes(piece.type)) return false;
  const without = new Chess(chess.fen());
  without.remove(sq);
  if (without.inCheck()) return false; // pinned to its king
  for (const m of chess.moves({ square: sq, verbose: true })) {
    if (m.captured && VALUE[m.captured] >= VALUE[piece.type]) return false;
    const next = new Chess(chess.fen());
    next.move(m);
    if (!next.isAttacked(m.to, by)) return false; // a safe square to go to
  }
  return true;
}

/**
 * An absolute pin: an enemy piece pinned to its king, attacked along the pin
 * by a piece worth less than it (so it can't simply be left alone).
 */
export function absolutePinWon(chess: Chess, color: Color): boolean {
  const colinear = (a: Square, b: Square, c: Square) => {
    const [ax, ay] = [a.charCodeAt(0), Number(a[1])];
    const [bx, by] = [b.charCodeAt(0), Number(b[1])];
    const [cx, cy] = [c.charCodeAt(0), Number(c[1])];
    return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax) === 0;
  };
  return lineUps(chess, color).some(
    (l) =>
      l.kind === 'pin' &&
      l.back.type === 'k' &&
      // attacked along the pin line by something cheaper (a pawn on that line counts, not only the pinner)
      chess.attackers(l.front.square, color).some((a) => colinear(a, l.front.square, l.back.square) && VALUE[chess.get(a)!.type] < VALUE[l.front.type]),
  );
}
