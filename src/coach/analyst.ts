// The analyst turns Stockfish output into teachable facts:
//   - the best line in a position, cut to its taught part (a tactic),
//   - the opponent's threat (what they'd do if it were their move again),
//   - whether each opponent reply in a taught line is forced.
// It owns its own Stockfish worker, separate from the opponent's move choice.
import { Chess } from 'chess.js';
import { scoreToCp, Stockfish, type Line } from '../engine/stockfish';
import { cutLine, type CutResult, type TaughtLine } from './lines';

export interface PositionEval {
  fen: string;
  /** Best score for the side to move, in centipawns (mates mapped to ±100000). */
  bestCp: number;
  mateIn?: number;
  lines: Line[];
}

export interface LineLimits {
  maxPlies: number;
  minGain: number;
}

/** A reply is "forced" when the next-best reply is at least this much worse. */
const FORCED_MARGIN_CP = 150;

export class Analyst {
  private queue: Promise<unknown> = Promise.resolve();

  private constructor(
    private sf: Stockfish,
    private depth: number,
  ) {}

  /** Phones search less deeply: still far stronger than needed at these levels. */
  static async create(): Promise<Analyst> {
    const phone = matchMedia('(pointer: coarse)').matches;
    return new Analyst(await Stockfish.create(), phone ? 10 : 12);
  }

  /** Runs engine jobs one at a time (the worker handles one search at once). */
  private run<T>(job: () => Promise<T>): Promise<T> {
    const next = this.queue.then(job, job);
    this.queue = next.catch(() => undefined);
    return next;
  }

  evaluate(fen: string, multiPv = 2, depth = this.depth): Promise<PositionEval> {
    return this.run(async () => {
      const a = await this.sf.analyse(fen, { depth, multiPv });
      const best = a.lines[0];
      return {
        fen,
        bestCp: best ? scoreToCp(best.score) : 0,
        mateIn: best?.score.kind === 'mate' ? best.score.value : undefined,
        lines: a.lines,
      };
    });
  }

  /**
   * Forgets what the engine learned from earlier searches (hash table, move
   * ordering): a game reviewed after another one gets the same answers as when
   * it is reviewed alone.
   */
  newGame(): Promise<void> {
    return this.run(() => this.sf.newGame());
  }

  /** Cuts the best line of an evaluated position to its taught part. */
  taughtLine(ev: PositionEval, limits: LineLimits): CutResult {
    const pv = ev.lines[0]?.pv ?? [];
    return cutLine(ev.fen, pv, { ...limits, evalCp: ev.bestCp, mateIn: ev.mateIn });
  }

  /**
   * The threat behind the opponent's last move: pass the move back to them and
   * see what they'd win. Returns nothing when in check (no "pass" is possible).
   */
  async threat(fen: string, limits: LineLimits): Promise<TaughtLine | undefined> {
    const chess = new Chess(fen);
    if (chess.inCheck()) return undefined;
    const flipped = flipTurn(fen);
    const ev = await this.evaluate(flipped, 1);
    const r = this.taughtLine(ev, limits);
    return r.kind === 'line' ? r.line : undefined;
  }

  /** Marks each reply in the line by the losing side as forced or not. */
  async markForced(line: TaughtLine): Promise<TaughtLine> {
    const chess = new Chess(line.rootFen);
    for (const move of line.moves) {
      if (move.color !== line.side) {
        const legal = chess.moves().length;
        if (legal === 1) move.forced = true;
        else {
          const ev = await this.evaluate(chess.fen(), 2, Math.max(8, this.depth - 2));
          const [best, second] = ev.lines;
          move.forced = !!best && !!second && scoreToCp(best.score) - scoreToCp(second.score) >= FORCED_MARGIN_CP;
        }
      }
      chess.move({ from: move.from, to: move.to, promotion: move.promotion });
    }
    return line;
  }

  terminate(): void {
    this.sf.terminate();
  }
}

/** Same position with the other side to move (no en passant), for threat checks. */
export function flipTurn(fen: string): string {
  const parts = fen.split(' ');
  parts[1] = parts[1] === 'w' ? 'b' : 'w';
  parts[3] = '-';
  return parts.join(' ');
}
