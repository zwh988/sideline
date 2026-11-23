import { Chess } from 'chess.js';
import { describe, expect, it } from 'vitest';
import type { PositionEval } from './analyst';
import { checkLine, lineMoveLabel, type Line, type LineEvaluator } from './linecheck';
import { playAndDescribe } from './facts';
import { narrateSidelineMove, sidelineReplyText } from './sideline';

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
  const chess = new Chess(rootFen);
  const fens = [rootFen];
  const moves: Line['moves'] = [];
  ucis.forEach((u, i) => {
    const m = chess.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] });
    moves.push({ from: m.from, to: m.to, promotion: m.promotion, uci: u, san: m.san, mine: i % 2 === 0 });
    fens.push(chess.fen());
  });
  return { line: { rootFen, moves }, fens };
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
  });

  it('refuted at a later move', async () => {
    const { line, fens } = lineOf(FORK, ['d5c7', 'e8d7', 'a1b1']);
    const analyst = new FakeAnalyst({
      [fens[0]]: { cp: 650, pv: ['d5c7', 'e8d7', 'c7a8'] },
      [fens[1]]: { cp: -650, pv: ['e8d7'] },
      [fens[2]]: { cp: 640, pv: ['c7a8'] },
      [fens[3]]: { cp: 100, pv: ['a8b8'] }, // Black is fine now
    });
    expect(await checkLine(analyst, line, OPTS)).toMatchObject({ kind: 'refuted', index: 2 });
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
    expect(await checkLine(analyst, line, OPTS)).toMatchObject({ kind: 'good', mate: true });
  });

  it('a weaker move that keeps the edge is not refuted', async () => {
    const { line, fens } = lineOf(FORK, ['a1b1']);
    const analyst = new FakeAnalyst({
      [fens[0]]: { cp: 650, pv: ['d5c7', 'e8d7'] },
      [fens[1]]: { cp: -300, pv: ['a8b8'] }, // still +3.0 for White, but 3.5 pawns below the best
    });
    expect(await checkLine(analyst, line, OPTS)).toMatchObject({ kind: 'good', allTop: false, weaker: { index: 0 } });
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

describe('narrateSidelineMove (one move, checked by the engine, named by the board code)', () => {
  const judge = async (root: string, uci: string, script: Script, seen = new Set<never>()) => {
    const { line } = lineOf(root, [uci]);
    const v = await checkLine(new FakeAnalyst(script), line, OPTS);
    return narrateSidelineMove(root, v, seen);
  };

  it('a top move that is a fork: agrees, names the fork, and gives the habit once', async () => {
    const after = lineOf(FORK, ['d5c7']).fens[1];
    const script = { [FORK]: { cp: 650, pv: ['d5c7', 'e8d7'] }, [after]: { cp: -650, pv: ['e8d7'] } };
    const seen = new Set<never>();
    const first = await judge(FORK, 'd5c7', script, seen);
    expect(first).toBe(
      "The engine agrees with Nxc7+. That's a fork: your knight on c7 attacks my king on e8 and my rook on a8 at once. " +
        'Habit: look for a square where one piece can attack two things at once.',
    );
    // Said again: no habit the second time.
    const second = await judge(FORK, 'd5c7', script, seen);
    expect(second).not.toContain('Habit');
  });

  it('refuted: 5.Bc4?? says what the coach would do and what it wins', async () => {
    const root = 'r1bqkbnr/ppp2ppp/2np4/8/3QP3/5N2/PPP2PPP/RNB1KB1R w KQkq - 1 5';
    const after = lineOf(root, ['f1c4']).fens[1];
    const text = await judge(root, 'f1c4', {
      [root]: { cp: 40, pv: ['d4a4'] },
      [after]: { cp: 600, pv: ['c6d4', 'f3d4', 'g8f6'] },
    });
    expect(text).toContain("Bc4 doesn't hold up.");
    expect(text).toContain("I'd answer with Nxd4");
    expect(text).toContain('winning a queen for a knight');
  });

  it('a weaker move that holds up: names the engine\'s choice', async () => {
    const after = lineOf(FORK, ['a1b1']).fens[1];
    const text = await judge(FORK, 'a1b1', {
      [FORK]: { cp: 650, pv: ['d5c7', 'e8d7'] },
      [after]: { cp: -300, pv: ['a8b8'] },
    });
    expect(text).toBe(
      'Rb1 holds up, though the engine would pick Nxc7+, which attacks the king and the rook at once.',
    );
  });

  it('checkmate', async () => {
    const root = '6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1';
    const text = await judge(root, 'a1a8', { [root]: { cp: 99999, pv: ['a1a8'] } });
    expect(text).toContain('Checkmate!');
    expect(text).toContain("That's a back-rank mate");
  });

  it("says it can't name a reason when the engine refutes but no concept is found", async () => {
    // A quiet move that the engine says loses ground; the reply is a plain pawn push with no concept.
    const root = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    const { line, fens } = lineOf(root, ['f2f3']);
    const v = await checkLine(
      new FakeAnalyst({ [root]: { cp: 30, pv: ['e2e4'] }, [fens[1]]: { cp: 400, pv: ['e7e5'] } }),
      line,
      OPTS,
    );
    expect(narrateSidelineMove(root, v, new Set())).toBe(
      "f3 doesn't hold up. I'd answer with e5, and the engine then rates the position +4.0 for me. I can't name a reason I can check.",
    );
  });
});

describe('sidelineReplyText (the coach moves first, "Show me")', () => {
  it('says what the move does, without calling it good', () => {
    const root = 'r1bqkbnr/ppp2ppp/2np4/8/3QP3/5N2/PPP2PPP/RNB1KB1R w KQkq - 1 5';
    const after = new Chess(root);
    after.move('Bc4');
    const f = playAndDescribe(new Chess(after.fen()), 'c6d4');
    // The queen on d4 was the only guard of the bishop on c4, so the capture also leaves it loose (true on the board).
    expect(sidelineReplyText(after.fen(), f, new Set())).toBe(
      "I'd play Nxd4, which takes the queen. That takes the only defender of your bishop on c4: it is now undefended. " +
        'Habit: when a piece is guarded, ask what happens if you take its guard.',
    );
  });

  it('adds the concept and the habit for a fork by the coach', () => {
    const fen = '4k3/8/8/8/3n4/8/8/R3K3 b Q - 0 1';
    const f = playAndDescribe(new Chess(fen), 'd4c2');
    const seen = new Set<never>();
    const t = sidelineReplyText(fen, f, seen);
    expect(t).toContain("That's a fork: my knight on c2 attacks your king on e1 and your rook on a1 at once.");
    expect(t).toContain('Habit: look for a square');
    expect(sidelineReplyText(fen, f, seen)).not.toContain('Habit');
  });
});
