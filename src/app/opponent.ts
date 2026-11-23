// The coach's move choice: Maia plays like a human at the level's rating.
// If Maia can't load, weakened Stockfish takes over (feasibility tests 1–2).
import { loadMaia, movePolicies, sampleMove, type Maia3 } from '../engine/maia';
import { Stockfish } from '../engine/stockfish';
import type { Game } from './game';

export interface Opponent {
  readonly kind: 'maia' | 'stockfish';
  /** Rating to play at; can change between games without reloading. */
  elo: number;
  chooseMove(game: Game): Promise<string>;
}

/** Moves below this probability are dropped, so Maia never plays truly random moves. */
const MIN_PROBABILITY = 0.02;

class MaiaOpponent implements Opponent {
  readonly kind = 'maia';
  constructor(
    private maia: Maia3,
    public elo: number,
  ) {}

  async chooseMove(game: Game): Promise<string> {
    // History lets Maia see the last few moves, as a human would.
    const [policy] = await movePolicies(this.maia, game.fen, [this.elo], game.moves.map((m) => m.uci));
    const likely = new Map([...policy].filter(([, p]) => p >= MIN_PROBABILITY));
    return sampleMove(likely.size ? likely : policy);
  }
}

class StockfishOpponent implements Opponent {
  readonly kind = 'stockfish';
  constructor(
    private sf: Stockfish,
    public elo: number, // not used: Stockfish's own Elo limit can't go this low
  ) {}

  async chooseMove(game: Game): Promise<string> {
    const a = await this.sf.analyse(game.fen, { depth: 8 });
    return a.bestMove;
  }
}

export async function createOpponent(
  elo: number,
  onProgress?: (loaded: number, total: number) => void,
): Promise<Opponent> {
  try {
    return new MaiaOpponent(await loadMaia(onProgress), elo);
  } catch (err) {
    console.warn('Maia failed to load; using weakened Stockfish', err);
    const sf = await Stockfish.create();
    sf.setOption('Skill Level', 0);
    return new StockfishOpponent(sf, elo);
  }
}
