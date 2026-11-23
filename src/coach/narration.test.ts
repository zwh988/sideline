import { Chess } from 'chess.js';
import { describe, expect, it } from 'vitest';
import { flipTurn } from './analyst';
import { cutLine, type TaughtLine } from './lines';
import { coachMoveFacts, qualityOf, type CoachMoveInput } from './narration';
import { narrateCoachMove } from './templates';

/** The player's threat before the coach moves: the line they'd play if it were their turn again. */
function threat(fen: string, pv: string[], evalCp: number, minGain = 3, mateIn?: number): TaughtLine {
  const r = cutLine(flipTurn(fen), pv, { maxPlies: 6, minGain, evalCp, mateIn });
  if (r.kind !== 'line') throw new Error(`no threat line: ${r.kind}`);
  return r.line;
}

function facts(input: Partial<CoachMoveInput> & Pick<CoachMoveInput, 'fenBefore' | 'uci'>) {
  // Every test move must be legal in its position.
  expect(() => new Chess(input.fenBefore).move({ from: input.uci.slice(0, 2), to: input.uci.slice(2, 4) })).not.toThrow();
  return coachMoveFacts({ lossCp: 0, mistakeCp: 250, ply: 10, ...input });
}

const say = (input: Parameters<typeof facts>[0]) => narrateCoachMove(facts(input));

// A bishop on b2 eyes the undefended knight on f6 (Black, the coach, to move).
const BISHOP_ON_KNIGHT = '4k3/8/5n2/8/8/8/1B2K3/8 b - - 0 1';

describe('coach move facts: the player threat', () => {
  it('sees the threatened piece move away', () => {
    // 1.e4 Nc6 2.d4 e6 3.d5: the pawn attacks the knight.
    const fen = 'r1bqkbnr/pppp1ppp/2n1p3/3P4/4P3/8/PPP2PPP/RNBQKBNR b KQkq - 0 3';
    const t = threat(fen, ['d5c6', 'd7c6'], 250, 2);
    expect(t.gain).toBe(2);
    const f = facts({ fenBefore: fen, uci: 'c6e5', lastMove: { san: 'd5', to: 'd5' }, playerThreat: t });
    expect(f.threat?.handled).toBe('moved');
    expect(f.threat?.victim).toEqual({ square: 'c6', piece: 'n' });
    expect(narrateCoachMove(f)).toEqual({
      text: 'After your d5, you were threatening to win a knight for a pawn with dxc6. Ne5 moves my knight out of danger.',
      priority: 'high',
      topic: 'threat',
    });
  });

  it('sees a defender added', () => {
    const t = threat(BISHOP_ON_KNIGHT, ['b2f6'], 300);
    const n = say({ fenBefore: BISHOP_ON_KNIGHT, uci: 'e8e7', lastMove: { san: 'Bb2', to: 'b2' }, playerThreat: t });
    expect(n?.text).toBe('After your Bb2, you were threatening to win a knight with Bxf6. Ke7 defends my knight on f6.');
  });

  it('sees the attacker taken', () => {
    const fen = '4k3/8/5n2/8/8/8/1B2K3/1r6 b - - 0 1';
    const t = threat(fen, ['b2f6'], 300);
    const n = say({ fenBefore: fen, uci: 'b1b2', lastMove: { san: 'Bb2', to: 'b2' }, playerThreat: t });
    expect(n?.text).toBe('After your Bb2, you were threatening to win a knight with Bxf6. So I took your bishop on b2 first.');
  });

  it('sees the threat blocked', () => {
    const fen = '4k3/8/4pn2/8/8/8/1B2K3/8 b - - 0 1';
    const t = threat(fen, ['b2f6'], 300);
    const n = say({ fenBefore: fen, uci: 'e6e5', lastMove: { san: 'Bb2', to: 'b2' }, playerThreat: t });
    expect(n?.text).toBe('After your Bb2, you were threatening to win a knight with Bxf6. e5 blocks it.');
  });

  it('names a stopped mate threat without claiming how', () => {
    // 1.e4 e5 2.Bc4 Nc6 3.Qh5: Qxf7 is mate. 3...g6 blocks the diagonal; after 3...Qe7
    // Qxf7+ is still legal, just not mate.
    const fen = 'r1bqkbnr/pppp1ppp/2n5/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 3 3';
    const t = threat(fen, ['h5f7'], 0, 3, 1);
    const last = { san: 'Qh5', to: 'h5' } as const;
    expect(say({ fenBefore: fen, uci: 'g7g6', lastMove: last, playerThreat: t })?.text).toBe(
      'After your Qh5, you were threatening checkmate with Qxf7#. g6 blocks it.',
    );
    const f = facts({ fenBefore: fen, uci: 'd8e7', lastMove: last, playerThreat: t });
    expect(f.threat?.handled).toBe('other');
    expect(narrateCoachMove(f)?.text).toBe('After your Qh5, you were threatening checkmate with Qxf7#. Qe7 stops that.');
  });

  it('says nothing about a threat the move did not answer', () => {
    const t = threat(BISHOP_ON_KNIGHT, ['b2f6'], 300);
    // The king steps away; Bxf6 still wins the knight.
    const f = facts({ fenBefore: BISHOP_ON_KNIGHT, uci: 'e8d8', playerThreat: t, playerLineAfter: threat(BISHOP_ON_KNIGHT, ['b2f6'], 300) });
    expect(f.threat).toBeUndefined();
  });
});

describe('coach move facts: captures', () => {
  it('takes back after a capture', () => {
    // 1.e4 d5 2.exd5 Qxd5.
    const n = say({
      fenBefore: 'rnbqkbnr/ppp1pppp/8/3P4/8/8/PPPP1PPP/RNBQKBNR b KQkq - 0 2',
      uci: 'd8d5',
      lastMove: { san: 'exd5', to: 'd5' },
    });
    expect(n).toEqual({ text: 'I take back on d5.', priority: 'medium', topic: 'capture' });
  });

  it('takes an undefended piece', () => {
    const n = say({ fenBefore: '4k3/1b6/8/3N4/8/8/8/4K3 b - - 0 1', uci: 'b7d5', lastMove: { san: 'Nd5', to: 'd5' } });
    expect(n?.text).toBe("Your knight on d5 wasn't defended, so I took it.");
  });

  it('takes a defended piece without calling it free', () => {
    // The knight on d5 is defended by the pawn on e4.
    const n = say({ fenBefore: '4k3/1b6/8/3N4/4P3/8/8/4K3 b - - 0 1', uci: 'b7d5' });
    expect(n?.text).toBe('I take your knight on d5.');
  });

  it('names the right square en passant', () => {
    const f = facts({ fenBefore: '4k3/8/8/8/3pP3/8/8/4K3 b - e3 0 1', uci: 'd4e3', lastMove: { san: 'e4', to: 'e4' } });
    expect(f.capturedOn).toBe('e4');
    expect(narrateCoachMove(f)?.text).toBe('I take your pawn on e4 en passant.');
  });

  it('mentions check with a capture', () => {
    // The bishop takes on f7 with check; the king can take back.
    const fen = 'rnbqkbnr/pppp1ppp/8/4p3/2B1P3/8/PPPP1PPP/RNBQK1NR w KQkq - 0 2';
    expect(say({ fenBefore: fen, uci: 'c4f7' })?.text).toBe('I take your pawn on f7, with check.');
  });
});

describe('coach move facts: quiet moves', () => {
  const AFTER_E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';

  it('develops a knight', () => {
    expect(say({ fenBefore: AFTER_E4, uci: 'g8f6', ply: 1 })).toEqual({
      text: "I'm bringing my knight out to f6.",
      priority: 'low',
      topic: 'develop',
    });
  });

  it('puts a pawn in the centre', () => {
    expect(say({ fenBefore: AFTER_E4, uci: 'e7e5', ply: 1 })?.text).toBe("I'm putting a pawn in the centre, on e5.");
  });

  it('castles', () => {
    // Italian Game, White (the coach) castles.
    const fen = 'r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4';
    expect(say({ fenBefore: fen, uci: 'e1g1' })?.text).toBe("I'm castling, so my king leaves the centre.");
  });

  it('stays quiet on a move with nothing to teach', () => {
    expect(say({ fenBefore: AFTER_E4, uci: 'a7a6', ply: 1 })).toBeUndefined();
  });

  it('gives no reason for a clear mistake', () => {
    // 1.e4 Nh6 develops, but say it lost 300 centipawns: no purposeful-sounding reason.
    const f = facts({ fenBefore: AFTER_E4, uci: 'g8h6', ply: 1, lossCp: 300 });
    expect(f.quality).toBe('mistake');
    expect(f.intent).toBe('develop');
    expect(narrateCoachMove(f)).toBeUndefined();
  });

  it('stops giving opening reasons after the opening', () => {
    expect(say({ fenBefore: AFTER_E4, uci: 'g8f6', ply: 30 })).toBeUndefined();
  });
});

describe('honest narration', () => {
  it('rates moves against the best one', () => {
    expect(qualityOf(0, 250)).toBe('best');
    expect(qualityOf(50, 250)).toBe('fine');
    expect(qualityOf(150, 250)).toBe('inaccuracy');
    expect(qualityOf(250, 250)).toBe('mistake');
  });

  it('never calls its own move good, even a weaker one that still narrates', () => {
    const fen = 'rnbqkbnr/ppp1pppp/8/3P4/8/8/PPPP1PPP/RNBQKBNR b KQkq - 0 2';
    for (const lossCp of [0, 100, 200, 400]) {
      const n = say({ fenBefore: fen, uci: 'd8d5', lastMove: { san: 'exd5', to: 'd5' }, lossCp });
      expect(n?.text).not.toMatch(/\b(good|best|strong|great|excellent|nice)\b/i);
    }
  });
});
