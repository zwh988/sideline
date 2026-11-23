// Game state: the rules come from chess.js; this adds what the board and
// opponent need (legal destinations, UCI history, results, takebacks).
import { Chess, SQUARES, type Square } from 'chess.js';

export type Color = 'white' | 'black';

export interface PlayedMove {
  san: string;
  uci: string;
  from: Square;
  to: Square;
  color: Color;
}

export type Result =
  | { over: false }
  | { over: true; winner: Color | null; reason: string };

export class Game {
  private chess = new Chess();
  readonly playerColor: Color;

  constructor(playerColor: Color) {
    this.playerColor = playerColor;
  }

  get fen(): string {
    return this.chess.fen();
  }

  get turn(): Color {
    return this.chess.turn() === 'w' ? 'white' : 'black';
  }

  get isPlayerTurn(): boolean {
    return this.turn === this.playerColor;
  }

  get inCheck(): boolean {
    return this.chess.inCheck();
  }

  get moves(): PlayedMove[] {
    return this.chess.history({ verbose: true }).map((m) => ({
      san: m.san,
      uci: m.from + m.to + (m.promotion ?? ''),
      from: m.from,
      to: m.to,
      color: m.color === 'w' ? 'white' : 'black',
    }));
  }

  get lastMove(): PlayedMove | undefined {
    return this.moves.at(-1);
  }

  /** Legal destinations per square, in the shape the board wants. */
  get dests(): Map<Square, Square[]> {
    const dests = new Map<Square, Square[]>();
    for (const from of SQUARES) {
      const targets = this.chess.moves({ square: from, verbose: true }).map((m) => m.to);
      if (targets.length) dests.set(from, targets);
    }
    return dests;
  }

  isPromotion(from: Square, to: Square): boolean {
    return this.chess.moves({ square: from, verbose: true }).some((m) => m.to === to && m.promotion);
  }

  /** Plays a move given as UCI (e.g. "e2e4", "e7e8q"). Throws if illegal. */
  play(uci: string): PlayedMove {
    this.chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    return this.lastMove!;
  }

  /** Takes back the player's last move (and the opponent's reply, if any). */
  takeback(): boolean {
    const history = this.moves;
    const lastPlayerIdx = history.findLastIndex((m) => m.color === this.playerColor);
    if (lastPlayerIdx < 0) return false;
    for (let i = history.length; i > lastPlayerIdx; i--) this.chess.undo();
    return true;
  }

  get result(): Result {
    const c = this.chess;
    if (c.isCheckmate()) return { over: true, winner: this.turn === 'white' ? 'black' : 'white', reason: 'checkmate' };
    if (c.isStalemate()) return { over: true, winner: null, reason: 'stalemate' };
    if (c.isInsufficientMaterial()) return { over: true, winner: null, reason: 'insufficient material' };
    if (c.isThreefoldRepetition()) return { over: true, winner: null, reason: 'threefold repetition' };
    if (c.isDraw()) return { over: true, winner: null, reason: 'fifty-move rule' };
    return { over: false };
  }

  get pgn(): string {
    return this.chess.pgn();
  }
}
