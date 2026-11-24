import { Chess } from 'chess.js';
import { describe, expect, it } from 'vitest';
import { BAD_MOVE_PGN, FORK_FEN, FORK_PGN, OPERA_ANNOTATED, SCOTCH_FEN } from '../app/import-fixtures';
import { levelInfo } from '../app/levels';
import { parseGame } from '../app/pgnimport';
import { Analyst, type PositionEval } from './analyst';
import { reviewGame } from './review';

type Script = Record<string, { cp: number; pv?: string[] }>;

/** Stands in for Stockfish with hand-checked evaluations; unknown positions are quiet (0.00, no line). */
class FakeAnalyst {
  searches = 0;
  newGames = 0;
  async newGame() {
    this.newGames++;
  }
  constructor(private script: Script) {}
  async evaluate(fen: string): Promise<PositionEval> {
    this.searches++;
    const s = this.script[fen] ?? { cp: 0 };
    return { fen, bestCp: s.cp, lines: s.pv ? [{ multipv: 1, depth: 12, score: { kind: 'cp', value: s.cp }, pv: s.pv }] : [] };
  }
  taughtLine = Analyst.prototype.taughtLine;
  threat = Analyst.prototype.threat;
  async markForced<T>(line: T): Promise<T> {
    return line;
  }
}

const after = (fen: string, uci: string): string => {
  const c = new Chess(fen);
  c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
  return c.fen();
};

const SCOTCH_SCRIPT: Script = {
  [SCOTCH_FEN]: { cp: 40, pv: ['d4a4'] },
  [after(SCOTCH_FEN, 'f1c4')]: { cp: 600, pv: ['c6d4', 'f3d4', 'g8f6'] },
};
const FORK_SCRIPT: Script = { [FORK_FEN]: { cp: 650, pv: ['d5c7', 'e8d7', 'c7a8', 'f8d6'] } };

const level2 = levelInfo(2);
const asGame = (pgn: string, playerColor: 'white' | 'black') => {
  const g = parseGame(pgn);
  return { startFen: g.startFen, moves: g.moves.map((m) => m.uci), playerColor };
};

describe('reviewGame: the same moment-finding as a live game, over an imported game', () => {
  it('finds the mistake in a game with a bad move (5.Bc4?? loses the queen to Nxd4)', async () => {
    const r = await reviewGame(new FakeAnalyst(SCOTCH_SCRIPT) as unknown as Analyst, asGame(BAD_MOVE_PGN, 'white'), { level: level2 });
    expect(r?.moments).toHaveLength(1);
    const m = r!.moments[0];
    expect(m).toMatchObject({ kind: 'mistake', fen: SCOTCH_FEN, played: 'f1c4', better: 'c6d4', ply: 9 });
    expect(m.lossCp).toBeGreaterThan(500);
    expect(m.concept).toBe('hangingPiece');
    // Looking back, not offering a takeback.
    expect(m.text).toBe('Careful: after Bc4, I can play Nxd4, which takes the queen. That would win a queen for a knight.');
    expect(r!.remarks).toEqual([{ ply: 9, remark: expect.objectContaining({ kind: 'mistake', offerTakeback: false }) }]);
  });

  it('judges only the chosen side: as Black the same game has no mistake, but Nxd4 is a tactic found', async () => {
    const r = await reviewGame(new FakeAnalyst(SCOTCH_SCRIPT) as unknown as Analyst, asGame(BAD_MOVE_PGN, 'black'), { level: level2 });
    expect(r?.moments).toHaveLength(1);
    expect(r!.moments[0]).toMatchObject({ kind: 'found-tactic', played: 'c6d4', ply: 10, concept: 'hangingPiece' });
    expect(r!.moments[0].text).toBe('Good eye: that wins a queen for a knight.');
  });

  it('finds the tactic the player found, in a game that starts from a position', async () => {
    const r = await reviewGame(new FakeAnalyst(FORK_SCRIPT) as unknown as Analyst, asGame(FORK_PGN, 'white'), { level: level2 });
    expect(r?.moments).toHaveLength(1);
    expect(r!.moments[0]).toMatchObject({ kind: 'found-tactic', fen: FORK_FEN, played: 'd5c7', ply: 1, concept: 'fork' });
  });

  it('finds the tactic the player missed', async () => {
    const missed: Script = { ...FORK_SCRIPT, [after(FORK_FEN, 'h1g1')]: { cp: 300 } };
    const game = { startFen: FORK_FEN, moves: ['h1g1'], playerColor: 'white' as const };
    const r = await reviewGame(new FakeAnalyst(missed) as unknown as Analyst, game, { level: level2 });
    expect(r?.moments[0]).toMatchObject({ kind: 'missed-tactic', played: 'h1g1', better: 'd5c7' });
  });

  it('stays quiet over a whole annotated game when nothing happens', async () => {
    const a = new FakeAnalyst({});
    const r = await reviewGame(a as unknown as Analyst, asGame(OPERA_ANNOTATED, 'white'), { level: level2 });
    expect(r).toEqual({ remarks: [], moments: [] });
    expect(a.searches).toBeGreaterThan(30); // it did look at White's 17 moves
  });

  it('starts each game with a fresh engine state', async () => {
    const a = new FakeAnalyst({});
    await reviewGame(a as unknown as Analyst, asGame(BAD_MOVE_PGN, 'white'), { level: level2 });
    await reviewGame(a as unknown as Analyst, asGame(FORK_PGN, 'white'), { level: level2 });
    expect(a.newGames).toBe(2);
  });

  it('reports progress after every move, and counts the opponent\'s moves too', async () => {
    const seen: [number, number][] = [];
    await reviewGame(new FakeAnalyst({}) as unknown as Analyst, asGame(BAD_MOVE_PGN, 'white'), { level: level2, onProgress: (d, t) => seen.push([d, t]) });
    expect(seen).toHaveLength(12);
    expect(seen.at(-1)).toEqual([12, 12]);
  });

  it('stops when cancelled and returns nothing half-finished', async () => {
    const ctl = new AbortController();
    let moves = 0;
    const r = await reviewGame(new FakeAnalyst(SCOTCH_SCRIPT) as unknown as Analyst, asGame(BAD_MOVE_PGN, 'white'), {
      level: level2,
      signal: ctl.signal,
      onProgress: () => {
        if (++moves === 3) ctl.abort();
      },
    });
    expect(r).toBeUndefined();
    expect(moves).toBe(3); // no engine work after the cancel
  });

  it('does not call a mistake a mistake above the level (Level 1 does not know the fork)', async () => {
    const r = await reviewGame(new FakeAnalyst(FORK_SCRIPT) as unknown as Analyst, asGame(FORK_PGN, 'white'), { level: levelInfo(1) });
    expect(r?.moments).toEqual([]);
  });
});
