// A sideline ("Try a sideline"): a line played out from a position, one level
// deep. Pure state over chess.js, no DOM, so it can be unit-tested. The player
// moves their own colour; the other side's replies are added by the caller
// (Stockfish's best move, not the level-matched opponent).
import { Chess, SQUARES, type Square } from 'chess.js';
import { resultOf, type Color, type Result } from './game';
import { plyLabel } from './navigation';

export interface BranchMove {
  from: Square;
  to: Square;
  promotion?: string;
  uci: string;
  san: string;
  /** True for the player's moves, false for the coach's replies. */
  mine: boolean;
}

export class Branch {
  private chess: Chess;
  readonly moves: BranchMove[] = [];
  /** What the coach said in this branch (oldest first). */
  readonly notes: string[] = [];

  constructor(
    readonly rootFen: string,
    readonly playerColor: Color,
  ) {
    this.chess = new Chess(rootFen);
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

  get result(): Result {
    return resultOf(this.chess);
  }

  get lastMove(): BranchMove | undefined {
    return this.moves.at(-1);
  }

  /** Legal destinations per square for the side to move. */
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

  /** Plays a move for whoever is to move. Throws if illegal. */
  play(uci: string): BranchMove {
    const mine = this.isPlayerTurn;
    const m = this.chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    const move: BranchMove = { from: m.from, to: m.to, promotion: m.promotion, uci: m.from + m.to + (m.promotion ?? ''), san: m.san, mine };
    this.moves.push(move);
    return move;
  }

  /**
   * Takes back the player's last move and everything after it (the coach's
   * reply). A coach move that opened the branch stays. Returns false when
   * there is no move of the player's to take back.
   */
  undo(): boolean {
    const idx = this.moves.findLastIndex((m) => m.mine);
    if (idx < 0) return false;
    while (this.moves.length > idx) {
      this.moves.pop();
      this.chess.undo();
    }
    return true;
  }

  /** The line so far, with move numbers: "14.Nxe5 Qd4 15.Nxf7". */
  get lineText(): string {
    // Numbers before White's moves, and before the first move whoever plays it.
    return this.moves
      .map((m, i) => {
        const label = plyLabel(this.rootFen, i + 1, m.san);
        return i === 0 || label.includes('.') && !label.includes('…') ? label : m.san;
      })
      .join(' ');
  }
}
