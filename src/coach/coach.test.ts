import { Chess } from 'chess.js';
import { describe, expect, it } from 'vitest';
import { levelInfo } from '../app/levels';
import { modeInfo, type ModeId } from '../app/modes';
import { Analyst, flipTurn, type PositionEval } from './analyst';
import { Coach } from './coach';
import openingData from './openings-data.json';
import { OpeningBook } from './openings';

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

const BOOK = new OpeningBook(openingData as never);

function coach(mode: ModeId, script: Script = {}, color: 'w' | 'b' = 'w', book?: OpeningBook): Coach {
  return new Coach(new FakeAnalyst(script) as unknown as Analyst, levelInfo(2), color, modeInfo(mode), book);
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

  it('a tactic prompt carries the engine line for the sideline', async () => {
    const r = await coach('lesson', FORK_SCRIPT).onPlayerTurn(FORK, 10);
    expect(r?.kind).toBe('tactic');
    expect(r?.line).toEqual(['d5c7', 'e8d7', 'c7a8']);
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
    // The moment saved with the game: where the player decided, what they played, what the coach found.
    expect(r?.moment).toMatchObject({ kind: 'mistake', fen: SCOTCH, played: 'f1c4', better: 'c6d4' });
    expect(typeof r?.moment?.lossCp).toBe('number');
    // The universes: what happens after it (the coach's line) and what the engine wanted.
    expect(r?.moment).toMatchObject({ answer: ['c6d4', 'f3d4'], line: ['d4a4'] });
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
    // Same capture, but the engine sees some compensation: 0.80 lost (-0.42 before, +1.22 for Black after).
    // Too little for a hung pawn (0.9 per pawn), too much for a praised sacrifice (0.6).
    expect(await coach('lesson', hungScript(122)).onPlayerMove(HUNG, 'd3d4', 10)).toBeUndefined();
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

// Greek gift: Bxh7+ is best (Stockfish depth 12: +5.39; next best Ng5 +1.96). Kxh7 wins the bishop for a
// pawn, and the engine's best reply is sometimes Kxh7 (-5.43 for Black), sometimes declining with Kh8
// (-5.34). Either way White is winning. Beyond Level 2's tactics.
const GREEK = 'rnbq1rk1/pppn1ppp/4p3/3pP3/1b1P4/2NB1N2/PPP2PPP/R1BQK2R w KQ - 0 7';
const GREEK_SCRIPT: Script = {
  [GREEK]: { cp: 539, pv: ['d3h7', 'g8h7', 'f3g5', 'h7g6', 'h2h4'] },
  [after(GREEK, 'd3h7')]: { cp: -543, pv: ['g8h7', 'f3g5', 'h7g6', 'h2h4', 'b8c6', 'd1d3', 'f7f5', 'h4h5'] },
};

// Evans Gambit, 1.e4 e5 2.Nf3 Nc6 3.Bc4 Bc5 4.b4: Stockfish +0.44 before, +0.30 for Black after 4...Bxb4.
// A playable gambit, 0.74 worse than the best move: neither praised nor called a hung pawn.
const EVANS = 'r1bqk1nr/pppp1ppp/2n5/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4';
const EVANS_SCRIPT: Script = {
  [EVANS]: { cp: 44, pv: ['c2c3', 'g8f6', 'd2d4'] },
  [after(EVANS, 'b2b4')]: { cp: 30, pv: ['c5b4', 'c2c3', 'b4e7', 'd2d4', 'c6a5', 'c4d3', 'd7d6', 'd4e5'] },
};

describe('Coach: sacrifices', () => {
  it('praises a sound sacrifice the player may not know is good', async () => {
    const r = await coach('lesson', GREEK_SCRIPT).onPlayerMove(GREEK, 'd3h7', 13);
    expect(r).toMatchObject({ kind: 'praise', mood: 'surprised' });
    expect(r?.text).toBe(
      'Bold! Bxh7+ offers your bishop for a pawn, but the engine rates it among the best moves here. Can you see what you get for it?',
    );
  });

  it("trusts the engine's top move when its evaluations jump", async () => {
    // Another search scored the position after Bxh7+ only -4.36 for Black: 1.03 "worse" than +5.39.
    const noisy: Script = { ...GREEK_SCRIPT, [after(GREEK, 'd3h7')]: { ...GREEK_SCRIPT[after(GREEK, 'd3h7')], cp: -436 } };
    expect((await coach('lesson', noisy).onPlayerMove(GREEK, 'd3h7', 13))?.kind).toBe('praise');
  });

  it('praises the offer when the engine would decline it', async () => {
    const declined: Script = {
      ...GREEK_SCRIPT,
      [after(GREEK, 'd3h7')]: { cp: -534, pv: ['g8h8', 'f3g5', 'f7f6', 'd1h5', 'f6g5', 'h7g6', 'h8g8', 'c1g5'] },
    };
    expect((await coach('lesson', declined).onPlayerMove(GREEK, 'd3h7', 13))?.text).toMatch(/^Bold! Bxh7\+ offers your bishop for a pawn/);
  });

  it("praises the Queen's Gambit pawn offer", async () => {
    // 1.d4 d5 2.c4: Stockfish +0.26 before, -0.25 for Black after (2...e6). c4 can't be retaken at once.
    const pos = after(after(new Chess().fen(), 'd2d4'), 'd7d5');
    const script: Script = { [pos]: { cp: 26, pv: ['g1f3', 'g8f6', 'c2c4'] }, [after(pos, 'c2c4')]: { cp: -25, pv: ['e7e6', 'g1f3'] } };
    expect((await coach('lesson', script).onPlayerMove(pos, 'c2c4', 3))?.text).toBe(
      'Bold! c4 offers a pawn, but the engine rates it among the best moves here. Can you see what you get for it?',
    );
  });

  it('is Lesson only', async () => {
    expect(await coach('sparring', GREEK_SCRIPT).onPlayerMove(GREEK, 'd3h7', 13)).toBeUndefined();
  });

  it('neither praises a gambit nor calls it a hung pawn', async () => {
    expect(await coach('lesson', EVANS_SCRIPT).onPlayerMove(EVANS, 'b2b4', 7)).toBeUndefined();
  });

  it('does not praise a pawn break that can be retaken (Italian, 5.d4 exd4 cxd4)', async () => {
    // 1.e4 e5 2.Nf3 Nc6 3.Bc4 Bc5 4.c3 Nf6 5.d4: after exd4 White can take back with cxd4.
    const fen = 'r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/2P2N2/PP1P1PPP/RNBQK2R w KQkq - 1 5';
    const script: Script = {
      [fen]: { cp: 22, pv: ['d2d4', 'e5d4', 'c3d4'] },
      [after(fen, 'd2d4')]: { cp: -18, pv: ['e5d4', 'e4e5', 'd7d5', 'c4b5', 'f6e4', 'c3d4', 'c5b4', 'c1d2'] },
    };
    expect(await coach('lesson', script).onPlayerMove(fen, 'd2d4', 9)).toBeUndefined();
  });

  it('does not praise an even trade', async () => {
    // 1.e4 d5 2.exd5 Qxd5: material is level again.
    const pos = after(after(new Chess().fen(), 'e2e4'), 'd7d5');
    const script: Script = { [pos]: { cp: 30, pv: ['e4d5'] }, [after(pos, 'e4d5')]: { cp: -30, pv: ['d8d5', 'b1c3'] } };
    expect(await coach('lesson', script).onPlayerMove(pos, 'e4d5', 3)).toBeUndefined();
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

describe('Coach: known openings and gambits', () => {
  const start = new Chess().fen();
  const d4d5 = after(after(start, 'd2d4'), 'd7d5');
  const qgScript: Script = { [d4d5]: { cp: 26, pv: ['g1f3'] }, [after(d4d5, 'c2c4')]: { cp: -25, pv: ['e7e6', 'g1f3'] } };

  it("names the Queen's Gambit instead of praising the offer (and without a book, praises as before)", async () => {
    expect((await coach('lesson', qgScript, 'w', BOOK).onPlayerMove(d4d5, 'c2c4', 3))?.text).toBe(
      "That's the Queen's Gambit, a known opening: you offer a pawn. We'll look at this one in openings training.",
    );
    expect((await coach('lesson', qgScript).onPlayerMove(d4d5, 'c2c4', 3))?.text).toMatch(/^Bold!/);
    expect(await coach('sparring', qgScript, 'w', BOOK).onPlayerMove(d4d5, 'c2c4', 3)).toBeUndefined();
  });

  it('names the Evans Gambit the player enters, and does not repeat when it carries on', async () => {
    const r = await coach('lesson', EVANS_SCRIPT, 'w', BOOK).onPlayerMove(EVANS, 'b2b4', 7);
    expect(r?.text).toBe("That's the Evans Gambit, a known opening: you offer a pawn. We'll look at this one in openings training.");
  });

  it('as Black: the Englund Gambit is named, with the engine view when it prefers other moves, and is not a hung pawn', async () => {
    const afterD4 = after(start, 'd2d4');
    const script: Script = { [afterD4]: { cp: 20 }, [after(afterD4, 'e7e5')]: { cp: 140, pv: ['d4e5', 'b8c6'] } };
    // Without the book the lost pawn is flagged as hung material.
    expect((await coach('lesson', script, 'b').onPlayerMove(afterD4, 'e7e5', 2))?.kind).toBe('mistake');
    const r = await coach('lesson', script, 'b', BOOK).onPlayerMove(afterD4, 'e7e5', 2);
    expect(r?.kind).toBe('praise');
    expect(r?.text).toBe("That's the Englund Gambit, a known opening: you offer a pawn. The engine prefers other moves here. We'll look at this one in openings training.");
  });

  it('keeps flagging a real mistake that is in no book', async () => {
    const r = await coach('lesson', SCOTCH_SCRIPT, 'w', BOOK).onPlayerMove(SCOTCH, 'f1c4', 9);
    expect(r?.kind).toBe('mistake');
  });

  it('says it every time the coach plays a gambit (Lesson), also in a later game or after a takeback; Sparring stays silent', async () => {
    const lastMove = { san: 'Bc5', to: 'c5' as const };
    const r = await coach('lesson', {}, 'w', BOOK).onCoachMove(EVANS, 'b2b4', 8, lastMove);
    expect(r?.text).toBe("I'm playing the Evans Gambit, a known opening: I offer a pawn.");
    expect(await coach('sparring', {}, 'w', BOOK).onCoachMove(EVANS, 'b2b4', 8, lastMove)).toBeUndefined();
    const c = coach('lesson', {}, 'w', BOOK);
    expect((await c.onCoachMove(EVANS, 'b2b4', 8, lastMove))?.kind).toBe('narration');
    // The same position again (a takeback replayed it): said again. A move that only carries the gambit on is not an entry.
    expect((await c.onCoachMove(EVANS, 'b2b4', 20, lastMove))?.text).toContain('Evans Gambit');
    const next = after(after(EVANS, 'b2b4'), 'c5b4');
    expect(((await c.onCoachMove(next, 'c2c3', 30, lastMove))?.text ?? '')).not.toContain('Evans Gambit');
  });
});


describe('Coach: taking back what was just taken is not a tactic', () => {
  // Black's Rd2 takes White's Rd1 with check, and Kxd1 simply takes back (an even trade).
  const BEFORE = '4k3/8/8/8/8/8/3r4/3RK3 b - - 0 1';
  const TRADED = after(BEFORE, 'd2d1');
  const SCRIPT: Script = { [TRADED]: { cp: 0, pv: ['e1d1'] } };

  it('stays quiet after the opponent took a rook and the line only takes it back', async () => {
    const c = coach('lesson', SCRIPT, 'w');
    await c.onCoachMove(BEFORE, 'd2d1', 24);
    expect(await c.onPlayerTurn(TRADED, 24)).toBeUndefined();
  });

  it('would have called it a tactic without knowing the last move', async () => {
    const c = coach('lesson', SCRIPT, 'w');
    expect((await c.onPlayerTurn(TRADED, 24))?.kind).toBe('tactic');
  });
});
