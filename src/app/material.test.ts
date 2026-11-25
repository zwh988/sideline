import { describe, expect, it } from 'vitest';
import { balanceText, materialOf } from './material';

describe('material', () => {
  it('start position: nothing lost, level', () => {
    expect(materialOf('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1')).toEqual({ capturedByWhite: [], capturedByBlack: [], lostByWhite: '', lostByBlack: '', balance: 0 });
  });
  it('knight fork FEN: White lacks a bishop pair member etc.; balance counted from the board', () => {
    const m = materialOf('r3kb1r/ppp2ppp/8/3N4/8/8/PPP2PPP/R3KB1R w KQkq - 0 1');
    expect(m.balance).toBe(3); // White has a knight Black doesn't match
    expect(m.lostByBlack).toContain('♛');
    expect(m.capturedByWhite).toContain('q'); // White has taken Black's queen
    expect(m.capturedByWhite).not.toContain('k');
  });
  it('balance text by colour', () => {
    expect(balanceText(3, 'w')).toBe('You +3');
    expect(balanceText(3, 'b')).toBe('Coach +3');
    expect(balanceText(0, 'w')).toBe('Material level');
  });
});
