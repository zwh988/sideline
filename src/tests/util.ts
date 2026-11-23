import { Chess } from 'chess.js';
import type { Score } from '../engine/stockfish';

export function makeLogger(out: HTMLElement) {
  return (html: string) => out.insertAdjacentHTML('beforeend', html);
}

export function uciToSan(fen: string, uci: string): string {
  try {
    return new Chess(fen).move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }).san;
  } catch {
    return `?${uci}`;
  }
}

/** Converts a UCI line to SAN, stopping at the first illegal move. */
export function lineToSan(fen: string, pv: string[], max = 6): string {
  const board = new Chess(fen);
  const san: string[] = [];
  for (const uci of pv.slice(0, max)) {
    try {
      san.push(board.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }).san);
    } catch {
      san.push(`?${uci}`);
      break;
    }
  }
  return san.join(' ');
}

/** Score as centipawns, with mates mapped to large values, for comparing moves. */
export function scoreToCp(s: Score): number {
  if (s.kind === 'cp') return s.value;
  return s.value > 0 ? 100000 - s.value : -100000 - s.value;
}

export function formatScore(s: Score): string {
  return s.kind === 'mate' ? `mate in ${s.value}` : (s.value / 100).toFixed(2);
}

/** Plays SAN moves from the start; returns the FEN and the moves in UCI. */
export function playSan(sanMoves: string[]): { fen: string; uci: string[] } {
  const board = new Chess();
  const uci = sanMoves.map((san) => {
    const m = board.move(san);
    return m.from + m.to + (m.promotion ?? '');
  });
  return { fen: board.fen(), uci };
}
