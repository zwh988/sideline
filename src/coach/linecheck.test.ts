import { Chess } from 'chess.js';
import { describe, expect, it } from 'vitest';
import { LineInput, type Line } from '../app/lines-input';
import type { PositionEval } from './analyst';
import { checkLine, lineMoveLabel, type LineEvaluator } from './linecheck';
import { narrateVerdict } from './templates';
import { verdictShapes } from './coach';

/** Hand-checked engine output per position; unknown positions are quiet (0.00, no line). */
type Script = Record<string, { cp: number; pv?: string[] }>;

class FakeAnalyst implements LineEvaluator {
  constructor(private script: Script) {}
  async evaluate(fen: string): Promise<PositionEval> {
    const s = this.script[fen] ?? { cp: 0 };
    return {
      fen,
      bestCp: s.cp,
      lines: s.pv ? [{ multipv: 1, depth: 12, score: { kind: 'cp', value: s.cp }, pv: s.pv }] : [],
    };
  }
}

/** Plays UCI moves from a FEN: the FENs along a line, and the line itself (mine/theirs alternate). */
function lineOf(rootFen: string, ucis: string[]): { line: Line; fens: string[] } {
  const input = new LineInput(rootFen);
  const fens = [rootFen];
  for (const u of ucis) {
    input.add(u.slice(0, 2) as never, u.slice(2, 4) as never, u[4] as never);
    fens.push(input.fen);
  }
  return { line: input.line, fens };
}

const OPTS = { maxPlies: 6 };

// White to move: Nxc7+ forks king and rook (Nxc7+ Kd7 Nxa8).
const FORK = 'r3kb1r/ppp2ppp/8/3N4/8/8/PPP2PPP/R3KB1R w KQkq - 0 1';

describe('checkLine', () => {
  it('good line: the knight fork, every move the engine\'s first choice', async () => {
    const { line, fens } = lineOf(FORK, ['d5c7', 'e8d7', 'c7a8']);
    const analyst = new FakeAnalyst({
      [fens[0]]: { cp: 650, pv: ['d5c7', 'e8d7', 'c7a8'] },
      [fens[1]]: { cp: -650, pv: ['e8d7', 'c7a8'] },
      [fens[2]]: { cp: 640, pv: ['c7a8'] },
      [fens[3]]: { cp: -640 },
    });
    const v = await checkLine(analyst, line, OPTS);
    expect(v).toMatchObject({ kind: 'good', mate: false, allTop: true, endCp: 640 });
    if (v.kind !== 'good') return;
    expect(v.gain).toBe(6); // a pawn and a rook
    expect(narrateVerdict(FORK, v)).toBe(
      'Good line! The engine agrees with every move you chose, and the replies you expect are good ones. ' +
        'It wins a rook and a pawn, and the engine rates the end position +6.4 for you.',
    );
  });

  it('refuted at move 1: 5.Bc4?? loses the queen to Nxd4', async () => {
    // 1.e4 e5 2.Nf3 d6 3.d4 exd4 4.Qxd4 Nc6; 5.Bc4 Nxd4 6.Nxd4.
    const root = 'r1bqkbnr/ppp2ppp/2np4/8/3QP3/5N2/PPP2PPP/RNB1KB1R w KQkq - 1 5';
    const { line, fens } = lineOf(root, ['f1c4']);
    const analyst = new FakeAnalyst({
      [fens[0]]: { cp: 40, pv: ['d4a4'] },
      [fens[1]]: { cp: 600, pv: ['c6d4', 'f3d4', 'g8f6'] },
    });
    const v = await checkLine(analyst, line, OPTS);
    expect(v.kind).toBe('refuted');
    if (v.kind !== 'refuted') return;
    expect(v.index).toBe(0);
    expect(v.reply?.san).toBe('Nxd4');
    expect(narrateVerdict(root, v)).toBe(
      "Refuted at move 1 (5.Bc4). I'd answer with Nxd4, winning a queen for a knight.",
    );
    // The shapes: the player's arrow (numbered 1) and the refuting reply in red.
    expect(verdictShapes(line, v)).toEqual([
      { orig: 'f1', dest: 'c4', brush: 'green', label: '1' },
      { orig: 'c6', dest: 'd4', brush: 'red', label: '2' },
    ]);
  });

  it('refuted at a later move says the earlier moves hold up', async () => {
    const { line, fens } = lineOf(FORK, ['d5c7', 'e8d7', 'a1b1']);
    const analyst = new FakeAnalyst({
      [fens[0]]: { cp: 650, pv: ['d5c7', 'e8d7', 'c7a8'] },
      [fens[1]]: { cp: -650, pv: ['e8d7'] },
      [fens[2]]: { cp: 640, pv: ['c7a8'] },
      [fens[3]]: { cp: 100, pv: ['a8b8'] }, // Black is fine now
    });
    const v = await checkLine(analyst, line, OPTS);
    expect(v).toMatchObject({ kind: 'refuted', index: 2 });
    expect(narrateVerdict(FORK, v)).toContain('Refuted at move 3 (2.Rb1)');
    expect(narrateVerdict(FORK, v)).toContain('The moves before it hold up');
  });

  it("the opponent has a better reply: Ke7 isn't their best answer to Nxc7+", async () => {
    const { line, fens } = lineOf(FORK, ['d5c7', 'e8e7']);
    const analyst = new FakeAnalyst({
      [fens[0]]: { cp: 650, pv: ['d5c7', 'e8d7'] },
      [fens[1]]: { cp: -300, pv: ['e8d7', 'c7a8'] },
      [fens[2]]: { cp: 700, pv: ['c7a8'] }, // after Ke7 White is much better off
    });
    const v = await checkLine(analyst, line, OPTS);
    expect(v).toMatchObject({ kind: 'better-reply', index: 1, lineCp: 700, bestCp: 300 });
    if (v.kind !== 'better-reply') return;
    expect(v.best.san).toBe('Kd7');
    expect(narrateVerdict(FORK, v)).toBe(
      'Your line works only if I cooperate. At move 2 (1…Ke7) you expect Ke7, but Kd7 is a better reply. ' +
        'The engine rates the position +7.0 for you after Ke7, but only +3.0 for you after Kd7.',
    );
    // The better reply replaces the one in the line, in red.
    expect(verdictShapes(line, v).at(-1)).toMatchObject({ orig: 'e8', dest: 'd7', brush: 'red', label: '2' });
  });

  it('a reply that is not best but loses either way is not a problem (already winning)', async () => {
    const { line, fens } = lineOf(FORK, ['d5c7', 'e8e7']);
    const analyst = new FakeAnalyst({
      [fens[0]]: { cp: 900, pv: ['d5c7'] },
      [fens[1]]: { cp: -800, pv: ['e8d7'] },
      [fens[2]]: { cp: 900 }, // -900 for Black vs best -800: both lost
    });
    expect((await checkLine(analyst, line, OPTS)).kind).toBe('good');
  });

  it('a slower mate is still the line: not refuted', async () => {
    // Back-rank mate in one for White: Ra8#. The fake says the engine prefers another mating move.
    const root = '6k1/5ppp/8/8/8/8/8/R3K3 w - - 0 1';
    const { line, fens } = lineOf(root, ['a1a8']);
    const analyst = new FakeAnalyst({ [fens[0]]: { cp: 99999, pv: ['e1e2'] } });
    const v = await checkLine(analyst, line, OPTS);
    expect(v).toMatchObject({ kind: 'good', mate: true });
    expect(narrateVerdict(root, v)).toContain('It ends in checkmate.');
  });

  it('a weaker move that keeps the edge is not refuted: the stronger move is mentioned', async () => {
    const { line, fens } = lineOf(FORK, ['a1b1']);
    const analyst = new FakeAnalyst({
      [fens[0]]: { cp: 650, pv: ['d5c7', 'e8d7'] },
      [fens[1]]: { cp: -300, pv: ['a8b8'] }, // still +3.0 for White, but 3.5 pawns below the best
    });
    const v = await checkLine(analyst, line, OPTS);
    expect(v).toMatchObject({ kind: 'good', allTop: false, weaker: { index: 0 } });
    expect(narrateVerdict(FORK, v)).toBe(
      'Good line! It holds up against the engine, and the replies you expect are good ones. The engine rates the end position +3.0 for you. ' +
        'The engine would pick Nxc7+, which attacks the king and the rook at once instead of Rb1 at move 1, but yours keeps an edge too.',
    );
  });

  it('an empty line has nothing to check', async () => {
    expect((await checkLine(new FakeAnalyst({}), { rootFen: FORK, moves: [] }, OPTS)).kind).toBe('empty');
  });

  it('labels moves by number, from either side', () => {
    expect(lineMoveLabel(FORK, 0, 'Nxc7+')).toBe('1.Nxc7+');
    expect(lineMoveLabel(FORK, 1, 'Kd7')).toBe('1…Kd7');
    expect(lineMoveLabel(FORK, 2, 'Nxa8')).toBe('2.Nxa8');
    const black = 'rnbq1rk1/pppn1ppp/4p3/3pP3/1b1P4/2NB1N2/PPP2PPP/R1BQK2R b KQ - 0 7';
    expect(lineMoveLabel(black, 0, 'Nb6')).toBe('7…Nb6');
    expect(lineMoveLabel(black, 1, 'O-O')).toBe('8.O-O');
    expect(new Chess(black).turn()).toBe('b');
  });
});
