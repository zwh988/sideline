import { Chess } from 'chess.js';
import { describe, expect, it } from 'vitest';
import { levelInfo } from '../app/levels';
import { modeInfo, type ModeId } from '../app/modes';
import { Analyst, flipTurn, type PositionEval } from './analyst';
import { Coach } from './coach';

/** Hand-checked engine output per position; unknown positions are quiet (0.00, no line). */
type Script = Record<string, { cp: number; pv?: string[] }>;

/** Stands in for Stockfish: the real line cutting and threat check over scripted evaluations. */
class FakeAnalyst {
  constructor(private script: Script) {}
  async evaluate(fen: string): Promise<PositionEval> {
    const s = this.script[fen] ?? { cp: 0 };
    return {
      fen,
      bestCp: s.cp,
      lines: s.pv ? [{ multipv: 1, depth: 12, score: { kind: 'cp', value: s.cp }, pv: s.pv }] : [],
    };
  }
  taughtLine = Analyst.prototype.taughtLine;
  threat = Analyst.prototype.threat;
  async markForced<T>(line: T): Promise<T> {
    return line;
  }
}

function coach(mode: ModeId, script: Script = {}, color: 'w' | 'b' = 'w'): Coach {
  return new Coach(new FakeAnalyst(script) as unknown as Analyst, levelInfo(2), color, modeInfo(mode));
}

/** Plays a UCI move (which must be legal) and returns the new FEN. */
function after(fen: string, uci: string): string {
  const chess = new Chess(fen);
  chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
  return chess.fen();
}

// White to move: Nxc7+ forks king and rook (Nxc7+ Kd7 Nxa8).
const FORK = 'r3kb1r/ppp2ppp/8/3N4/8/8/PPP2PPP/R3KB1R w KQkq - 0 1';
const FORK_SCRIPT: Script = { [FORK]: { cp: 650, pv: ['d5c7', 'e8d7', 'c7a8', 'f8d6'] } };

// 1.e4 e5 2.Nf3 d6 3.d4 exd4 4.Qxd4 Nc6, White to move. 5.Bc4?? Nxd4 Nxd4 loses the queen for a knight.
const SCOTCH = 'r1bqkbnr/ppp2ppp/2np4/8/3QP3/5N2/PPP2PPP/RNB1KB1R w KQkq - 1 5';
const SCOTCH_SCRIPT: Script = {
  [SCOTCH]: { cp: 40, pv: ['d4a4'] },
  [after(SCOTCH, 'f1c4')]: { cp: 600, pv: ['c6d4', 'f3d4', 'g8f6'] },
};

// White to move: Black's bishop on b7 attacks the undefended knight on f3.
const THREAT = '4k3/1b6/8/8/8/5N2/8/4K3 w - - 0 1';
const THREAT_SCRIPT: Script = { [flipTurn(THREAT)]: { cp: 300, pv: ['b7f3'] } };

describe('Coach modes: prompts on the player turn', () => {
  it('Lesson points out an available tactic; Sparring stays quiet', async () => {
    expect((await coach('lesson', FORK_SCRIPT).onPlayerTurn(FORK, 10))?.kind).toBe('tactic');
    expect(await coach('sparring', FORK_SCRIPT).onPlayerTurn(FORK, 10)).toBeUndefined();
  });

  it('Lesson asks about a threat; Sparring stays quiet', async () => {
    expect((await coach('lesson', THREAT_SCRIPT).onPlayerTurn(THREAT, 10))?.text).toBe(
      'Before you move: what does my last move want?',
    );
    expect(await coach('sparring', THREAT_SCRIPT).onPlayerTurn(THREAT, 10)).toBeUndefined();
  });

  it('Lesson gives a phase prompt; Sparring does not', async () => {
    const start = new Chess().fen();
    expect((await coach('lesson').onPlayerTurn(start, 16))?.kind).toBe('phase');
    expect(await coach('sparring').onPlayerTurn(start, 16)).toBeUndefined();
  });
});

describe('Coach modes: hints', () => {
  it('Sparring hints start at step 1 on request; in Lesson the prompt was step 1', async () => {
    const lesson = coach('lesson', FORK_SCRIPT);
    await lesson.onPlayerTurn(FORK, 10);
    expect((await lesson.hint()).text).toMatch(/^Look at /);

    const sparring = coach('sparring', FORK_SCRIPT);
    await sparring.onPlayerTurn(FORK, 10);
    expect((await sparring.hint()).text).toBe("There's a tactic in this position.");
    expect((await sparring.hint()).text).toMatch(/^Look at /);
  });
});

describe('Coach modes: the player move', () => {
  it('Lesson explains a mistake and offers a takeback', async () => {
    const r = await coach('lesson', SCOTCH_SCRIPT).onPlayerMove(SCOTCH, 'f1c4', 9);
    expect(r?.kind).toBe('mistake');
    expect(r?.offerTakeback).toBe(true);
    expect(r?.text).toBe('Careful: after Bc4, I can play Nxd4, which takes the queen. That would win a queen for a knight. Want to take it back?');
  });

  it('Sparring flags the mistake without the refutation or a takeback', async () => {
    const r = await coach('sparring', SCOTCH_SCRIPT).onPlayerMove(SCOTCH, 'f1c4', 9);
    expect(r?.kind).toBe('mistake');
    expect(r?.offerTakeback).toBeFalsy();
    expect(r?.shapes ?? []).toEqual([]);
    expect(r?.text).toBe('Careful: Bc4 gives me a chance to win material.');
  });

  it('a missed tactic offers a takeback only in Lesson', async () => {
    const lesson = await coach('lesson', FORK_SCRIPT).onPlayerMove(FORK, 'a2a3', 11);
    expect(lesson).toMatchObject({ kind: 'missed-tactic', offerTakeback: true });
    const sparring = await coach('sparring', FORK_SCRIPT).onPlayerMove(FORK, 'a2a3', 11);
    expect(sparring).toMatchObject({
      kind: 'missed-tactic',
      offerTakeback: false,
      text: 'You had something stronger than a3 here.',
    });
  });

  it('finding the tactic is praised in both modes', async () => {
    for (const mode of ['lesson', 'sparring'] as const) {
      expect((await coach(mode, FORK_SCRIPT).onPlayerMove(FORK, 'd5c7', 11))?.kind).toBe('praise');
    }
  });

  it('"you saw my threat" is Lesson only', async () => {
    expect((await coach('lesson', THREAT_SCRIPT).onPlayerMove(THREAT, 'f3d4', 1))?.kind).toBe('defended');
    expect(await coach('sparring', THREAT_SCRIPT).onPlayerMove(THREAT, 'f3d4', 1)).toBeUndefined();
  });
});

// From a real game (Lesson, Level 2): 1.e4 Nf6 2.Nc3 d5 3.d3 e5 4.Nxd5 Nxd5 5.exd5 Qxd5, White to move.
// 6.d4? hangs a pawn: 6...exd4, and 7.Qxd4?? Qxd4 loses the queen. Stockfish (depth 12): -0.42 before,
// +1.73 for Black after 6.d4, best line 6...exd4 7.Nf3 Nc6 8.Bd3 Bb4+ 9.Bd2.
const HUNG = 'rnb1kb1r/ppp2ppp/8/3qp3/8/3P4/PPP2PPP/R1BQKBNR w KQkq - 0 6';
const hungScript = (afterCp: number): Script => ({
  [HUNG]: { cp: -42, pv: ['c2c3', 'b8c6', 'd1b3'] },
  [after(HUNG, 'd3d4')]: { cp: afterCp, pv: ['e5d4', 'g1f3', 'b8c6', 'f1d3', 'f8b4', 'c1d2'] },
});

describe('Coach: hung material below the mistake size', () => {
  it('flags a hung pawn at Level 2 in Lesson, with a takeback offer', async () => {
    const r = await coach('lesson', hungScript(173)).onPlayerMove(HUNG, 'd3d4', 10);
    expect(r).toMatchObject({ kind: 'mistake', offerTakeback: true });
    expect(r?.text).toBe(
      'Careful: after d4, I can play exd4, which takes the pawn. That would win a pawn: if you recapture with Qxd4, I take your queen with Qxd4. Want to take it back?',
    );
    expect(r?.shapes).toEqual([{ orig: 'e5', dest: 'd4', brush: 'red' }]);
  });

  it('flags it at Level 1 too', async () => {
    const c = new Coach(new FakeAnalyst(hungScript(173)) as unknown as Analyst, levelInfo(1), 'w', modeInfo('lesson'));
    expect((await c.onPlayerMove(HUNG, 'd3d4', 10))?.kind).toBe('mistake');
  });

  it('stays quiet when the evaluation does not confirm the pawn is lost', async () => {
    // Same capture, but the engine sees compensation: only 0.50 lost.
    expect(await coach('lesson', hungScript(8)).onPlayerMove(HUNG, 'd3d4', 10)).toBeUndefined();
  });

  it('does not call an even trade a hung pawn', async () => {
    // 1.e4 d5 2.exd5: Black takes back with Qxd5 (+1 pawn from the root), but the evaluation is level.
    const fen = after(new Chess().fen(), 'e2e4');
    const pos = after(fen, 'd7d5');
    const script: Script = { [pos]: { cp: 30, pv: ['e4d5'] }, [after(pos, 'e4d5')]: { cp: -30, pv: ['d8d5', 'b1c3'] } };
    expect(await coach('lesson', script).onPlayerMove(pos, 'e4d5', 3)).toBeUndefined();
  });

  it('is Lesson only: Sparring flags only the real mistakes of the level', async () => {
    expect(await coach('sparring', hungScript(173)).onPlayerMove(HUNG, 'd3d4', 10)).toBeUndefined();
  });
});

describe("Coach modes: thinking aloud on the coach's move", () => {
  const afterE4 = after(new Chess().fen(), 'e2e4');
  const lastMove = { san: 'e4', to: 'e4' as const };

  it('Lesson narrates the idea of its move; Sparring is silent', async () => {
    const lesson = await coach('lesson', {}, 'w').onCoachMove(afterE4, 'e7e5', 2, lastMove);
    expect(lesson?.text).toBe("I'm putting a pawn in the centre, on e5.");
    expect(await coach('sparring', {}, 'w').onCoachMove(afterE4, 'e7e5', 2, lastMove)).toBeUndefined();
  });
});
