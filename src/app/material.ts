// Captured material and the point balance, from the board alone (no engine).
import { Chess, type PieceSymbol } from 'chess.js';
import { VALUE } from '../coach/facts';

const FULL: Record<string, number> = { q: 1, r: 2, b: 2, n: 2, p: 8 };
const ORDER: PieceSymbol[] = ['q', 'r', 'b', 'n', 'p'];
const GLYPH = { w: { q: '♕', r: '♖', b: '♗', n: '♘', p: '♙' }, b: { q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' } } as const;

export interface Material {
  /** Pieces each side has lost, as glyphs (missing from the standard set; promotions never count as lost). */
  lostByWhite: string;
  lostByBlack: string;
  /** White's material minus Black's, in pawns. */
  balance: number;
}

export function materialOf(fen: string): Material {
  const chess = new Chess(fen);
  const have = { w: {} as Record<string, number>, b: {} as Record<string, number> };
  let balance = 0;
  for (const row of chess.board()) {
    for (const sq of row) {
      if (!sq || sq.type === 'k') continue;
      have[sq.color][sq.type] = (have[sq.color][sq.type] ?? 0) + 1;
      balance += sq.color === 'w' ? VALUE[sq.type] : -VALUE[sq.type];
    }
  }
  const lost = (c: 'w' | 'b') =>
    ORDER.map((p) => GLYPH[c][p as keyof (typeof GLYPH)['w']].repeat(Math.max(0, FULL[p] - (have[c][p] ?? 0)))).join('');
  return { lostByWhite: lost('w'), lostByBlack: lost('b'), balance };
}

/** "You +3" / "Level" / "Coach +2" for the player's colour. */
export function balanceText(balance: number, player: 'w' | 'b'): string {
  const mine = player === 'w' ? balance : -balance;
  return mine === 0 ? 'Material level' : mine > 0 ? `You +${mine}` : `Coach +${-mine}`;
}
