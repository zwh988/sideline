// One puzzle being solved (task 3.2): checking the player's moves against the
// solution, the hint ladder, and the coach's words when it is solved. Pure, so
// it is tested on real Lichess puzzles (puzzle.test.ts); the screen is in ui.ts.
//
// Rule 1: the puzzle's Lichess themes only chose it. A concept is named only
// when our detectors find it in the line (`explainLine`, `conceptNote`).
import { Chess, type Square } from 'chess.js';
import type { Shape } from '../coach/coach';
import { conceptNote, type NoteConcept } from '../coach/explain';
import { PIECE_NAME } from '../coach/facts';
import { explainLine, taughtFrom } from '../coach/lineexplain';
import { winsPhrase } from '../coach/templates';
import type { Color } from './game';
import type { Rating } from './linetree';
import type { Puzzle } from './puzzlepool';

const move = (chess: Chess, uci: string) => chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });

/** What a move of the player is, before the engine is asked. */
export type MoveCheck =
  /** The solution's move. */
  | 'correct'
  /** Not the solution's move, but it mates: counts as solved (Lichess does the same). */
  | 'mate'
  /** Anything else: the engine decides (`judgeOther`). */
  | 'other';

export class PuzzleRun {
  /** The position the solver first sees: after the opponent's first move. */
  readonly solverFen: string;
  readonly solverColor: Color;
  /** The solver's moves and the replies, from `solverFen`. */
  readonly solution: string[];
  /** How far into `solution` the player has got (the next solver move is at this index). */
  index = 0;

  constructor(readonly puzzle: Puzzle) {
    const chess = new Chess(puzzle.fen);
    move(chess, puzzle.moves[0]);
    this.solverFen = chess.fen();
    this.solverColor = chess.turn() === 'w' ? 'white' : 'black';
    this.solution = puzzle.moves.slice(1);
  }

  /** The opponent's move that sets the puzzle (it is played on the board first). */
  get firstMove(): string {
    return this.puzzle.moves[0];
  }

  /** The solver move expected now. */
  get expected(): string | undefined {
    return this.solution[this.index];
  }

  get solved(): boolean {
    return this.index >= this.solution.length;
  }

  /** The position the player is to move in now. */
  get fen(): string {
    const chess = new Chess(this.solverFen);
    for (const u of this.solution.slice(0, this.index)) move(chess, u);
    return chess.fen();
  }

  check(uci: string): MoveCheck {
    const want = this.expected;
    if (!want) return 'other';
    // A promotion counts by its piece; a solution that promotes without saying so means a queen.
    if (uci === want || (uci.length === 4 && want === `${uci}q`)) return 'correct';
    const chess = new Chess(this.fen);
    try {
      move(chess, uci);
    } catch {
      return 'other';
    }
    return chess.isCheckmate() ? 'mate' : 'other';
  }

  /**
   * The player's move was right: step past it. Returns the opponent's reply to play next, or nothing
   * when the puzzle is solved. `mate` (another mating move) solves it at once.
   */
  advance(kind: 'correct' | 'mate'): string | undefined {
    if (kind === 'mate') {
      this.index = this.solution.length;
      return undefined;
    }
    this.index++;
    const reply = this.solution[this.index];
    if (reply) this.index++;
    return reply;
  }
}

/**
 * A move that is not the solution's (and does not mate): "also good" when the engine puts it among the moves
 * that hold up (Best, Great or Good lane: within 1.5 pawns of the best). Then the coach says there is something
 * stronger and the player tries again, without a miss. Anything worse is a wrong move.
 */
export function judgeOther(rating: Pick<Rating, 'lane'>): 'also-good' | 'wrong' {
  return rating.lane === 'other' ? 'wrong' : 'also-good';
}

const LOOK_FOR: Record<NoteConcept, string> = {
  fork: 'Look for a fork: one piece attacking two things at once.',
  discoveredAttack: 'Look for a discovered attack: move one piece out of the way of another.',
  pin: 'Look for a pin.',
  skewer: 'Look for a skewer.',
  backRankMate: 'Look at their back rank.',
  smotheredMate: 'Look for a smothered mate.',
  loosePiece: 'Look for something you can take for free.',
  trappedPiece: 'Look for a piece of theirs with no safe square.',
  capturingDefender: 'Look for a defender you can take.',
  sacrifice: 'Sometimes you have to give something to get more.',
};

/** Hint `step` (1–4) for the move `uci` at `fen`: what to look for, which piece, where it goes, the move. */
export function puzzleHint(fen: string, uci: string, step: number): { text: string; shapes: Shape[] } {
  const chess = new Chess(fen);
  const m = move(new Chess(fen), uci);
  const from = uci.slice(0, 2) as Square;
  const to = uci.slice(2, 4) as Square;
  if (step <= 1) {
    const note = conceptNote(fen, uci, 'you');
    if (note) return { text: LOOK_FOR[note.concept], shapes: [] };
    move(chess, uci);
    if (chess.isCheckmate()) return { text: 'There is a checkmate in one move here.', shapes: [] };
    return { text: 'Start with checks, captures and threats.', shapes: [] };
  }
  const piece = PIECE_NAME[m.piece];
  if (step === 2) return { text: `The piece to move is your ${piece} on ${from}.`, shapes: [{ orig: from, brush: 'green' }] };
  if (step === 3) return { text: `Your ${piece} goes to ${to}.`, shapes: [{ orig: from, brush: 'green' }, { orig: to, brush: 'green' }] };
  return { text: `The move is ${m.san}.`, shapes: [{ orig: from, dest: to, brush: 'green' }] };
}

/** The pool theme of a concept the coach named, for "Another fork?" (none when it has no theme of its own). */
const CONCEPT_THEME: Partial<Record<string, string>> = {
  fork: 'fork', discoveredAttack: 'discoveredAttack', pin: 'pin', skewer: 'skewer', backRankMate: 'backRankMate',
  smotheredMate: 'smotheredMate', loosePiece: 'hangingPiece', trappedPiece: 'trappedPiece', capturingDefender: 'capturingDefender',
  sacrifice: 'sacrifice', deflection: 'deflection', attraction: 'attraction', intermezzo: 'intermezzo',
};

/**
 * The coach's words when a puzzle is solved: the first concept our detectors found in the player's moves
 * (worded as in a sideline), then what the line achieved (checkmate, the material it wins). `played` is the
 * line as the player played it from `solverFen` (it may end in another mate than the solution's).
 */
export function solvedWords(run: PuzzleRun, played: string[]): { text: string; theme?: string } {
  const steps = explainLine(run.solverFen, played, { player: run.solverColor === 'white' ? 'w' : 'b', previous: { fen: run.puzzle.fen, uci: run.firstMove } });
  const line = taughtFrom(run.solverFen, played);
  let named: { text: string; concept?: string } | undefined;
  if (line?.mate) {
    // A mate's own pattern (smothered, back rank) comes before whatever the checks on the way showed.
    const before = new Chess(run.solverFen);
    for (const u of played.slice(0, -1)) move(before, u);
    const note = conceptNote(before.fen(), played.at(-1)!, 'you');
    if (note?.concept === 'smotheredMate' || note?.concept === 'backRankMate') named = note;
  }
  named ??= steps.find((s) => s.mine && s.concept && s.text);
  if (!named) {
    // explainLine words a mating move as the mate; the pattern of the mate (smothered, back rank) is conceptNote's.
    const chess = new Chess(run.solverFen);
    for (const [i, uci] of played.entries()) {
      if (i % 2 === 0 && (named = conceptNote(chess.fen(), uci, 'you'))) break;
      move(chess, uci);
    }
  }
  if (line) {
    // A piece the opponent promoted in the line and lost again was a pawn before: count it as one.
    const promoted = new Set<string>();
    line.moves = line.moves.map((m) => {
      if (m.color !== line.side && m.promotion) promoted.add(m.to);
      if (m.color === line.side && m.captured && promoted.has(m.to)) return { ...m, captured: 'p' };
      return m;
    });
  }
  const outcome = !line ? '' : line.mate ? 'Checkmate.' : line.gain > 0 ? `That wins ${winsPhrase(line)}.` : '';
  const parts = ['Solved!', named?.text, outcome].filter(Boolean);
  if (parts.length === 1) parts.push('That is the whole line.');
  return { text: parts.join(' '), theme: named?.concept ? CONCEPT_THEME[named.concept] : undefined };
}
