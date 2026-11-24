import { Chess } from 'chess.js';
import { describe, expect, it } from 'vitest';
import { levelInfo } from '../app/levels';
import { modeInfo } from '../app/modes';
import { Analyst, type PositionEval } from './analyst';
import { Coach } from './coach';

type Script = Record<string, { cp: number; pv?: string[] }>;

class FakeAnalyst {
  constructor(private script: Script) {}
  async evaluate(fen: string): Promise<PositionEval> {
    const s = this.script[fen] ?? { cp: 0 };
    return { fen, bestCp: s.cp, lines: s.pv ? [{ multipv: 1, depth: 12, score: { kind: 'cp', value: s.cp }, pv: s.pv }] : [] };
  }
  taughtLine = Analyst.prototype.taughtLine;
}

const make = (script: Script, color: 'w' | 'b' = 'w') => new Coach(new FakeAnalyst(script) as unknown as Analyst, levelInfo(2), color, modeInfo('lesson'));

// White: Qa7, Rb8, Kg1. Black's Rc8 attacks Rb8 and its Bd4 is undefended. The engine's line: Rxc8+ Qxc8 Qxd4.
const ROOK_FEN = '1Rr3k1/Q1pq1p1p/p2p2p1/3p4/3b4/7P/P1P2PP1/6K1 w - - 0 1';

describe('Coach.bestLine ("show me what\'s good here")', () => {
  it('gives the engine line with what it wins and a note for each move', async () => {
    const coach = make({ [ROOK_FEN]: { cp: 320, pv: ['b8c8', 'd7c8', 'a7d4', 'g8f8'] } });
    const best = await coach.bestLine(ROOK_FEN);
    expect(best?.ucis).toEqual(['b8c8', 'd7c8', 'a7d4']);
    expect(best?.intro).toBe("The engine likes Rxc8+ Qxc8 Qxd4. It wins a bishop.");
    expect(best?.notes[0]).toBe('Rxc8+. That takes my rook on c8, with check.');
    expect(best?.notes[1]).toBe('Qxc8. That takes back on c8.');
    expect(best?.notes[2]).toContain('That bishop was a loose piece: nothing defended it.');
  });

  it("says it can't name a pattern when no detector fires", async () => {
    const fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    const coach = make({ [fen]: { cp: 30, pv: ['e2e4', 'e7e5', 'g1f3'] } });
    const best = await coach.bestLine(fen);
    expect(best?.intro).toBe("The engine likes e4 e5 Nf3. The engine rates the position +0.3 for you after the first move. I can't name a pattern in it that I can check.");
  });

  it('nothing when the engine has no line', async () => {
    expect(await make({}).bestLine(ROOK_FEN)).toBeUndefined();
  });
});

describe('Coach.describeSidelineMove', () => {
  it('words the coach reply, and adds only the pay-off when the verdict named it already', () => {
    const coach = make({});
    expect(coach.describeSidelineMove({ rootFen: ROOK_FEN, ucis: ['b8c8', 'd7c8'] })).toBe('I play Qxc8. That takes back on c8.');
    expect(coach.describeSidelineMove({ rootFen: ROOK_FEN, ucis: ['b8c8', 'd7c8'] }, true)).toBe('');
  });

  it('a skewer set up earlier in the sideline is named when the player cashes it in', () => {
    const coach = make({});
    const fen = '4q3/8/8/8/4k3/8/8/R6K w - - 0 1';
    expect(coach.describeSidelineMove({ rootFen: fen, ucis: ['a1e1', 'e4f5', 'e1e8'] })).toContain('The skewer pays off: Rxe8 takes the queen.');
  });
});

describe('Coach.deviations (if they do not play the best reply)', () => {
  class Multi {
    async evaluate(fen: string): Promise<PositionEval> {
      const mk = (cp: number, pv: string[]) => ({ multipv: 1, depth: 12, score: { kind: 'cp' as const, value: cp }, pv });
      return { fen, bestCp: -300, lines: [mk(-300, ['d7c8']), mk(-600, ['d7d8']), mk(-900, ['d7e8'])] };
    }
    taughtLine = Analyst.prototype.taughtLine;
  }
  it('lists the next-best real choices, not the one already shown, nor a hopeless one', async () => {
    const c = new Coach(new Multi() as unknown as Analyst, levelInfo(2), 'w', modeInfo('lesson'));
    const fen = new Chess(ROOK_FEN);
    fen.move('Rxc8+');
    const devs = await c.deviations(fen.fen(), 'd7c8');
    expect(devs).toEqual([{ uci: 'd7d8', san: 'Qd8', lossCp: 300 }]);
  });
});
