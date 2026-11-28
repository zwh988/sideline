import { Chess } from 'chess.js';
import { describe, expect, it } from 'vitest';
import { BAD_MOVE_PGN, FORK_FEN, FORK_PGN, OPERA_ANNOTATED, SCOTCH_FEN } from '../app/import-fixtures';
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

const asGame = (pgn: string, playerColor: 'white' | 'black') => {
  const g = parseGame(pgn);
  return { startFen: g.startFen, moves: g.moves.map((m) => m.uci), playerColor };
};

describe('reviewGame: every pattern, both sides, at any level', () => {
  it('finds the mistake in a game with a bad move (5.Bc4?? loses the queen to Nxd4), in the past tense', async () => {
    const r = await reviewGame(new FakeAnalyst(SCOTCH_SCRIPT) as unknown as Analyst, asGame(BAD_MOVE_PGN, 'white'), {});
    expect(r?.moments).toHaveLength(1);
    const m = r!.moments[0];
    expect(m).toMatchObject({ kind: 'mistake', fen: SCOTCH_FEN, played: 'f1c4', better: 'd4a4', line: ['d4a4'], answer: ['c6d4', 'f3d4'], ply: 9 });
    expect(m.lossCp).toBeGreaterThan(500);
    expect(m.text).toBe(
      'You played 5.Bc4. After that, your opponent can play Nxd4, winning a queen for a knight. The line runs Nxd4 Nxd4. ' +
        'Nxd4: that takes the only defender of your bishop on c4: it is now undefended. The engine preferred Qa4. ' +
        'Habit: when a piece is guarded, ask what happens if you take its guard.',
    );
    // Looking back: no takeback offer, no "Careful: after Bc4, I can play…".
    expect(r!.remarks).toEqual([{ ply: 9, remark: expect.objectContaining({ kind: 'mistake', }) }]);
    expect(r!.remarks[0].remark.shapes).toBeUndefined(); // no arrows in Review: Show line plays it
    expect(r!.remarks[0].remark.offerTakeback).toBeUndefined();
  });

  it('as Black the same game: the opponent gave something away, and Nxd4 found it (one moment, not two)', async () => {
    const r = await reviewGame(new FakeAnalyst(SCOTCH_SCRIPT) as unknown as Analyst, asGame(BAD_MOVE_PGN, 'black'), {});
    expect(r?.moments).toHaveLength(1);
    expect(r!.moments[0]).toMatchObject({ kind: 'found-tactic', played: 'c6d4', ply: 10, prompted: true });
    expect(r!.moments[0].text).toMatch(/^Good find: 5…Nxd4\. Your opponent had just given something away\. It wins a queen for a knight\./);
  });

  it('finds the tactic the player found, in a game that starts from a position', async () => {
    const r = await reviewGame(new FakeAnalyst(FORK_SCRIPT) as unknown as Analyst, asGame(FORK_PGN, 'white'), {});
    expect(r?.moments).toHaveLength(1);
    expect(r!.moments[0]).toMatchObject({ kind: 'found-tactic', fen: FORK_FEN, played: 'd5c7', ply: 1, concept: 'fork', line: ['d5c7', 'e8d7', 'c7a8'] });
    expect(r!.moments[0].text).toContain("Nxc7+: that's a fork: your knight on c7 attacks their king on e8 and their rook on a8 at once.");
  });

  it('as Black the opponent found the fork: their tactic', async () => {
    const r = await reviewGame(new FakeAnalyst(FORK_SCRIPT) as unknown as Analyst, asGame(FORK_PGN, 'black'), {});
    expect(r?.moments).toHaveLength(1);
    expect(r!.moments[0]).toMatchObject({ kind: 'their-tactic', played: 'd5c7', concept: 'fork' });
    expect(r!.moments[0].text).toMatch(/^Your opponent played 1\.Nxc7\+\. It wins a rook and a pawn\. The line runs Nxc7\+ Kd7 Nxa8\. Nxc7\+: that's a fork: their knight on c7 attacks your king on e8 and your rook on a8 at once\./);
  });

  it('finds the tactic the player missed', async () => {
    const missed: Script = { ...FORK_SCRIPT, [after(FORK_FEN, 'h1g1')]: { cp: 300 } };
    const game = { startFen: FORK_FEN, moves: ['h1g1'], playerColor: 'white' as const };
    const r = await reviewGame(new FakeAnalyst(missed) as unknown as Analyst, game, {});
    expect(r?.moments[0]).toMatchObject({ kind: 'missed-tactic', played: 'h1g1', better: 'd5c7' });
    expect(r!.moments[0].text).toMatch(/^You played 1\.Rg1, but you had something stronger: Nxc7\+ Kd7 Nxa8, winning a rook and a pawn\./);
  });

  it('lists a missed mate even when the player stays far ahead, and names it', async () => {
    const fen = '6k1/5ppp/8/8/8/8/5PPP/3QR1K1 w - - 0 1';
    const script: Script = { [fen]: { cp: 99999, pv: ['e1e8'] }, [after(fen, 'h2h3')]: { cp: -1500 } };
    const r = await reviewGame(new FakeAnalyst(script) as unknown as Analyst, { startFen: fen, moves: ['h2h3'], playerColor: 'white' }, {});
    expect(r!.moments[0]).toMatchObject({ kind: 'missed-tactic', better: 'e1e8' });
    expect(r!.moments[0].lossCp).toBeUndefined();
    expect(r!.moments[0].text).toMatch(/^You played 1\.h3 and missed checkmate: Re8#\./);
  });

  it('lists a missed win of material while still winning, unless the move wins as much', async () => {
    const quiet: Script = { [FORK_FEN]: FORK_SCRIPT[FORK_FEN], [after(FORK_FEN, 'h1g1')]: { cp: -600 } };
    const game = { startFen: FORK_FEN, moves: ['h1g1'], playerColor: 'white' as const };
    const r = await reviewGame(new FakeAnalyst(quiet) as unknown as Analyst, game, {});
    expect(r!.moments.map((m) => m.kind)).toEqual(['missed-tactic']);
  });

  it('finds every pattern, and never tags one as beyond a level', async () => {
    const r = await reviewGame(new FakeAnalyst(FORK_SCRIPT) as unknown as Analyst, asGame(FORK_PGN, 'white'), {});
    expect(r?.moments).toHaveLength(1);
    expect(r!.moments[0]).toMatchObject({ kind: 'found-tactic', concept: 'fork' });
    expect(r!.moments[0].beyond).toBeUndefined();
  });

  it('lists every swing of about a pawn: a 2.4-pawn drop is your mistake, whatever level the game was played at', async () => {
    const script: Script = { ...SCOTCH_SCRIPT, [after(SCOTCH_FEN, 'f1c4')]: { cp: 200, pv: ['c6d4', 'f3d4', 'g8f6'] } };
    expect((await reviewGame(new FakeAnalyst(script) as unknown as Analyst, asGame(BAD_MOVE_PGN, 'white'), {}))?.moments.map((m) => m.kind)).toEqual(['mistake']);
  });

  it('lists a one-pawn drop too, and leaves a smaller one out', async () => {
    const fen = '4k3/8/8/8/8/8/4P3/4K3 w - - 0 1';
    const at = (cp: number) => ({ [fen]: { cp: 300, pv: ['e2e4'] }, [after(fen, 'e1d1')]: { cp } });
    const run = (cp: number) => reviewGame(new FakeAnalyst(at(cp)) as unknown as Analyst, { startFen: fen, moves: ['e1d1'], playerColor: 'white' }, {});
    expect((await run(-200))!.moments.map((m) => m.kind)).toEqual(['mistake']); // 300 -> 200: 1.0 pawn
    expect((await run(-240))!.moments).toEqual([]); // 300 -> 240: 0.6 pawn
  });

  it('a quiet drop with nothing the detectors can name says so', async () => {
    const fen = '4k3/8/8/8/8/8/4P3/4K3 w - - 0 1';
    const script: Script = { [fen]: { cp: 300, pv: ['e2e4'] }, [after(fen, 'e1d1')]: { cp: 100 } };
    const r = await reviewGame(new FakeAnalyst(script) as unknown as Analyst, { startFen: fen, moves: ['e1d1'], playerColor: 'white' }, {});
    expect(r!.moments[0]).toMatchObject({ kind: 'mistake', better: 'e2e4' });
    expect(r!.moments[0].answer).toBeUndefined();
    expect(r!.moments[0].text).toBe("You played 1.Kd1. The engine preferred e4, about 4.0 pawns better for you. I can't name a reason I can check.");
  });

  it('returns the evaluation curve (White\'s view, one value per position)', async () => {
    const r = await reviewGame(new FakeAnalyst(SCOTCH_SCRIPT) as unknown as Analyst, asGame(BAD_MOVE_PGN, 'white'), {});
    expect(r!.curve).toHaveLength(13);
    expect(r!.curve[8]).toBe(40); // White to move at 5.: +0.4
    expect(r!.curve[9]).toBe(-600); // after 5.Bc4, Black to move at +6.0
  });

  it('stays quiet over a whole annotated game when nothing happens', async () => {
    const a = new FakeAnalyst({});
    const r = await reviewGame(a as unknown as Analyst, asGame(OPERA_ANNOTATED, 'white'), {});
    expect(r?.moments).toEqual([]);
    expect(r?.remarks).toEqual([]);
    expect(a.searches).toBe(33); // one search per position, both sides (33 plies; the mated position needs none)
  });

  it('starts each game with a fresh engine state', async () => {
    const a = new FakeAnalyst({});
    await reviewGame(a as unknown as Analyst, asGame(BAD_MOVE_PGN, 'white'), {});
    await reviewGame(a as unknown as Analyst, asGame(FORK_PGN, 'white'), {});
    expect(a.newGames).toBe(2);
  });

  it('reports progress after every move', async () => {
    const seen: [number, number][] = [];
    await reviewGame(new FakeAnalyst({}) as unknown as Analyst, asGame(BAD_MOVE_PGN, 'white'), { onProgress: (d, t) => seen.push([d, t]) });
    expect(seen).toHaveLength(12);
    expect(seen.at(-1)).toEqual([12, 12]);
  });

  it('stops when cancelled and returns nothing half-finished', async () => {
    const ctl = new AbortController();
    let moves = 0;
    const r = await reviewGame(new FakeAnalyst(SCOTCH_SCRIPT) as unknown as Analyst, asGame(BAD_MOVE_PGN, 'white'), {
      signal: ctl.signal,
      onProgress: () => {
        if (++moves === 3) ctl.abort();
      },
    });
    expect(r).toBeUndefined();
    expect(moves).toBe(3); // no engine work after the cancel
  });
});

describe('reviewGame: a label for every move', () => {
  it('labels both sides: the blunder 5.Bc4 and the fork that punishes it', async () => {
    const r = await reviewGame(new FakeAnalyst(SCOTCH_SCRIPT) as unknown as Analyst, asGame(BAD_MOVE_PGN, 'white'), {});
    expect(r!.labels).toHaveLength(12);
    expect(r!.labels[8]).toBe('blunder'); // 5.Bc4: +0.4 to -6.0
    expect(r!.labels[9]).toBe('best'); // 5…Nxd4, the engine's move
  });

  it('a move the engine rates as the only one that holds is great', async () => {
    const fen = SCOTCH_FEN;
    const a = new FakeAnalyst({});
    a.evaluate = async (f: string) => {
      a.searches++;
      return f === fen
        ? { fen: f, bestCp: 40, lines: [{ multipv: 1, depth: 12, score: { kind: 'cp', value: 40 }, pv: ['d4a4'] }, { multipv: 2, depth: 12, score: { kind: 'cp', value: -250 }, pv: ['f1c4'] }] }
        : { fen: f, bestCp: -40, lines: [] };
    };
    const r = await reviewGame(a as unknown as Analyst, { startFen: fen, moves: ['d4a4'], playerColor: 'white' }, {});
    expect(r!.labels).toEqual(['great']);
  });
});

describe('reviewGame: a sacrifice that holds', () => {
  it('is brilliant (Qxd6 gives the queen for a pawn; in this script the engine says it holds)', async () => {
    const script: Script = { [SCOTCH_FEN]: { cp: 40, pv: ['d4d6'] }, [after(SCOTCH_FEN, 'd4d6')]: { cp: -40 } };
    const r = await reviewGame(new FakeAnalyst(script) as unknown as Analyst, { startFen: SCOTCH_FEN, moves: ['d4d6'], playerColor: 'white' }, {});
    expect(r!.labels).toEqual(['brilliant']);
  });
});
