// The line the player is entering with tap-arrows ("Explain your idea").
// Pure state over chess.js, no DOM: the game screen feeds it taps and draws
// what it reports. A line is a start position plus the moves from it, which
// is also what a branch (task 1.6) needs to start from.
import { Chess, type Square } from 'chess.js';

export interface LineMove {
  from: Square;
  to: Square;
  promotion?: 'q' | 'r' | 'b' | 'n';
  uci: string;
  san: string;
  /** Who moves: true for the player's own moves, false for the opponent's replies. */
  mine: boolean;
}

/** A line from a position: the unit that checking and (later) branches work on. */
export interface Line {
  rootFen: string;
  moves: LineMove[];
}

/** What a tap did. The game screen turns this into a status message. */
export type TapResult =
  | { kind: 'selected'; square: Square; dests: Square[] }
  | { kind: 'deselected' }
  | { kind: 'added'; move: LineMove }
  | { kind: 'needs-promotion'; from: Square; to: Square }
  | { kind: 'invalid'; from: Square; to: Square; why: string }
  | { kind: 'ignored'; why: string }
  | { kind: 'full' };

/** Longest line that can be entered (and checked in a few seconds). */
export const MAX_LINE_MOVES = 8;

export class LineInput {
  private chess: Chess;
  private _moves: LineMove[] = [];
  private _selected?: Square;

  /** `playerTurn`: the side to move at the root is the player's, so move 1 is "mine". */
  constructor(
    readonly rootFen: string,
    private playerTurn = true,
  ) {
    this.chess = new Chess(rootFen);
  }

  get moves(): readonly LineMove[] {
    return this._moves;
  }

  get selected(): Square | undefined {
    return this._selected;
  }

  /** The position after the moves entered so far. */
  get fen(): string {
    return this.chess.fen();
  }

  get line(): Line {
    return { rootFen: this.rootFen, moves: [...this._moves] };
  }

  get isEmpty(): boolean {
    return this._moves.length === 0;
  }

  get isFull(): boolean {
    return this._moves.length >= MAX_LINE_MOVES;
  }

  /** The next arrow is the player's own move (else the opponent's reply). */
  get nextIsMine(): boolean {
    return this.playerTurn === (this._moves.length % 2 === 0);
  }

  /** Nothing more can be added: the game is over in the line's position. */
  get ended(): boolean {
    return this.chess.isGameOver();
  }

  /** Legal destinations of the selected piece. */
  get dests(): Square[] {
    return this._selected ? this.destsOf(this._selected) : [];
  }

  private destsOf(sq: Square): Square[] {
    return [...new Set(this.chess.moves({ square: sq, verbose: true }).map((m) => m.to))];
  }

  /**
   * A tap on a square. First a piece of the side to move, then where it goes.
   * An illegal target is reported as invalid and the piece stays selected, so
   * the player can simply tap another square.
   */
  tap(sq: Square): TapResult {
    if (this.isFull) return { kind: 'full' };
    if (this.ended) return { kind: 'ignored', why: 'The game is over in this line.' };
    const piece = this.chess.get(sq);
    const turn = this.chess.turn();

    if (this._selected) {
      if (sq === this._selected) {
        this._selected = undefined;
        return { kind: 'deselected' };
      }
      // Another piece of the same side: switch to it.
      if (piece && piece.color === turn) return this.select(sq);
      const from = this._selected;
      const legal = this.chess.moves({ square: from, verbose: true }).filter((m) => m.to === sq);
      if (!legal.length) return { kind: 'invalid', from, to: sq, why: this.whyIllegal(from, sq) };
      if (legal[0].promotion) return { kind: 'needs-promotion', from, to: sq };
      return this.add(from, sq);
    }

    if (!piece) return { kind: 'ignored', why: 'Tap a piece first.' };
    if (piece.color !== turn) {
      return { kind: 'ignored', why: `It's ${this.nextIsMine ? 'your' : 'their'} move here: tap one of ${this.nextIsMine ? 'your' : 'their'} pieces.` };
    }
    return this.select(sq);
  }

  private select(sq: Square): TapResult {
    const dests = this.destsOf(sq);
    this._selected = sq;
    return { kind: 'selected', square: sq, dests };
  }

  /** Adds a move after a promotion choice (or directly, if legal). Throws if illegal. */
  add(from: Square, to: Square, promotion?: LineMove['promotion']): TapResult {
    const mine = this.nextIsMine;
    const m = this.chess.move({ from, to, promotion });
    this._selected = undefined;
    const move: LineMove = {
      from,
      to,
      promotion: m.promotion as LineMove['promotion'],
      uci: from + to + (m.promotion ?? ''),
      san: m.san,
      mine,
    };
    this._moves.push(move);
    return { kind: 'added', move };
  }

  /** Removes the last arrow. Returns it, or nothing if the line was empty. */
  undo(): LineMove | undefined {
    this._selected = undefined;
    const move = this._moves.pop();
    if (move) this.chess.undo();
    return move;
  }

  /** Keeps only the first `n` moves (for branching from a point in the line). */
  truncate(n: number): void {
    while (this._moves.length > Math.max(0, n)) this.undo();
    this._selected = undefined;
  }

  /** Puts a previously entered line back (to change it). */
  load(moves: readonly LineMove[]): void {
    this.truncate(0);
    for (const m of moves) this.add(m.from, m.to, m.promotion);
  }

  private whyIllegal(from: Square, to: Square): string {
    const p = this.chess.get(from)!;
    const target = this.chess.get(to);
    if (target && target.color === p.color) return "That square is occupied by the same side's piece.";
    // Only what the board proves: the rules say no, whatever the reason.
    return this.chess.moves({ square: from }).length
      ? `That's not a legal move for the ${p.type === 'n' ? 'knight' : { p: 'pawn', b: 'bishop', r: 'rook', q: 'queen', k: 'king' }[p.type]}${this.chess.inCheck() ? ' while the king is in check' : ''}.`
      : 'That piece has no legal moves.';
  }
}
