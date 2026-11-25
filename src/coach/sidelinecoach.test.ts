import { Chess } from 'chess.js';
import { describe, expect, it } from 'vitest';
import { levelInfo } from '../app/levels';
import { modeInfo } from '../app/modes';
import { Analyst, type PositionEval } from './analyst';
import { Coach } from './coach';

describe('Coach lines (task 1.9): options, ratings and a move in words', () => {
  // White to move after 4…d6: Nc6 attacks the queen on d4. Bb5 pins the knight; Bc4?? and Be2?? lose the queen.
  const SCOTCH = 'r1bqkbnr/ppp2ppp/2np4/8/3QP3/5N2/PPP2PPP/RNB1KB1R w KQkq - 1 5';
  const after = (uci: string) => {
    const c = new Chess(SCOTCH);
    c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    return c.fen();
  };
  const mk = (cp: number, pv: string[]) => ({ multipv: 1, depth: 12, score: { kind: 'cp' as const, value: cp }, pv });
  class Scotch {
    searches: string[] = [];
    async evaluate(fen: string): Promise<PositionEval> {
      this.searches.push(fen);
      if (fen === SCOTCH) return { fen, bestCp: 150, lines: [mk(150, ['f1b5', 'c8d7']), mk(110, ['d4d3']), mk(-460, ['f1c4'])] };
      if (fen === after('f1e2')) return { fen, bestCp: 460, lines: [mk(460, ['c6d4'])] };
      return { fen, bestCp: 0, lines: [] };
    }
    taughtLine = Analyst.prototype.taughtLine;
  }
  const lines = () => {
    const fake = new Scotch();
    return { fake, coach: new Coach(fake as unknown as Analyst, levelInfo(2), 'w', modeInfo('lesson')) };
  };

  it('options: the engine moves in lanes against the best', async () => {
    const o = await lines().coach.options(SCOTCH);
    expect(o.map((x) => [x.san, x.lane])).toEqual([
      ['Bb5', 'best'],
      ['Qd3', 'great'],
      ['Bc4', 'other'],
    ]);
  });

  it('rateMove: a move among the lines needs no new search; another one costs one search of its position', async () => {
    const { fake, coach } = lines();
    expect((await coach.rateMove(SCOTCH, 'f1c4')).lane).toBe('other');
    expect(fake.searches).toEqual([SCOTCH]);
    const be2 = await coach.rateMove(SCOTCH, 'f1e2');
    expect(be2).toMatchObject({ lane: 'other', lossCp: 610, evalCp: -460, bestSan: 'Bb5' });
    expect(fake.searches).toEqual([SCOTCH, after('f1e2')]);
  });

  it('lineNote: the lane sentence first, then what the board code found', async () => {
    const { coach } = lines();
    const bb5 = (await coach.options(SCOTCH))[0];
    const note = await coach.lineNote(SCOTCH, ['f1b5'], bb5);
    expect(note.startsWith("The engine's top choice here.")).toBe(true);
    const great = (await coach.options(SCOTCH))[1];
    expect(await coach.lineNote(SCOTCH, ['d4d3'], great)).toContain('A great move: the engine\'s top pick is Bb5, only 0.4 pawns better.');
  });

  it('lineNote: a move far below the best is judged and its refutation named', async () => {
    const { coach } = lines();
    const bc4 = (await coach.options(SCOTCH))[2];
    expect(await coach.lineNote(SCOTCH, ['f1c4'], bc4)).toContain("doesn't hold up");
  });

  it('withCommon: marks a common move that is among the options and rates one that is not', async () => {
    const { fake, coach } = lines();
    const opts = await coach.options(SCOTCH);
    const merged = await coach.withCommon(SCOTCH, opts, [
      { uci: 'f1c4', p: 0.4 }, // already an option (Other)
      { uci: 'f1e2', p: 0.3 }, // not among the lines: rated with one more search
      { uci: 'a2a3', p: 0.05 }, // too unlikely
    ]);
    expect(merged.find((o) => o.uci === 'f1c4')?.common).toBe(true);
    const be2 = merged.find((o) => o.uci === 'f1e2')!;
    expect(be2).toMatchObject({ san: 'Be2', lane: 'other', common: true });
    expect(merged.some((o) => o.uci === 'a2a3')).toBe(false);
    expect(fake.searches).toContain(after('f1e2'));
  });

  it('reason: names a passed pawn that favours the better side, and says nothing for a level position', () => {
    const { coach } = lines();
    const fen = '8/7p/8/3P4/8/8/8/k1K5 w - - 0 1';
    const rating = (evalCp: number, lane: 'best' | 'other' = 'best') => ({ lane, lossCp: 0, evalCp });
    const r = coach.reason(fen, [], fen, rating(250));
    expect(r?.text).toBe("What stands out: White has a passed pawn on d5: no black pawn on the c, d, e files is ahead of it. Black's pawn on h7 is isolated: no black pawn stands on the files beside it.");
    expect(r?.squares).toEqual(['d5', 'h7']);
    expect(coach.reason(fen, [], fen, rating(40))).toBeUndefined();
    expect(coach.reason(fen, [], fen, rating(250, 'other'))).toBeUndefined(); // a refuted move is worded with its refutation
  });

  it("reason: says it can't name one when no fact favours the better side", () => {
    const { coach } = lines();
    const start = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    const rating = (evalCp: number) => ({ lane: 'best' as const, lossCp: 0, evalCp });
    expect(coach.reason(start, [], start, rating(300))).toEqual({ text: "I can't name a reason I can check for that.", squares: [] });
    expect(coach.reason(start, [], start, rating(120))).toBeUndefined();
  });
});
