import { describe, expect, it } from 'vitest';
import { Branch } from './branches';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
// Black to move after 1.e4.
const AFTER_E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1';
// White to move: Nxc7+ forks king and rook.
const FORK = 'r3kb1r/ppp2ppp/8/3N4/8/8/PPP2PPP/R3KB1R w KQkq - 0 1';

describe('Branch', () => {
  it('marks the player\'s moves and the coach\'s replies', () => {
    const b = new Branch(FORK, 'white');
    expect(b.isPlayerTurn).toBe(true);
    expect(b.play('d5c7')).toMatchObject({ san: 'Nxc7+', mine: true });
    expect(b.isPlayerTurn).toBe(false);
    expect(b.play('e8d7')).toMatchObject({ san: 'Kd7', mine: false });
    expect(b.isPlayerTurn).toBe(true);
    expect(b.lineText).toBe('1.Nxc7+ Kd7');
  });

  it('throws on an illegal move and leaves the position alone', () => {
    const b = new Branch(FORK, 'white');
    expect(() => b.play('d5d6')).toThrow();
    expect(b.moves).toHaveLength(0);
    expect(b.fen).toBe(new Branch(FORK, 'white').fen);
  });

  it('offers legal destinations and spots promotions', () => {
    const b = new Branch(FORK, 'white');
    expect(b.dests.get('d5')).toContain('c7');
    expect(b.dests.get('d5')).not.toContain('d6'); // a knight doesn't go there
    const p = new Branch('8/P6k/8/8/8/8/8/K7 w - - 0 1', 'white');
    expect(p.isPromotion('a7', 'a8')).toBe(true);
    expect(p.isPromotion('a1', 'a2')).toBe(false);
    expect(p.play('a7a8q').san).toBe('a8=Q');
  });

  it('takes back the player\'s last move and the reply', () => {
    const b = new Branch(START, 'white');
    b.play('e2e4');
    b.play('e7e5');
    b.play('g1f3');
    b.play('b8c6');
    expect(b.undo()).toBe(true);
    expect(b.lineText).toBe('1.e4 e5');
    expect(b.isPlayerTurn).toBe(true);
    expect(b.undo()).toBe(true);
    expect(b.moves).toHaveLength(0);
    expect(b.fen).toBe(new Branch(START, 'white').fen);
    expect(b.undo()).toBe(false);
  });

  it('keeps the coach\'s opening move when the player takes back (branch from the opponent\'s turn)', () => {
    const b = new Branch(AFTER_E4, 'white'); // the player is White, but Black is to move
    expect(b.isPlayerTurn).toBe(false);
    b.play('e7e5');
    b.play('g1f3');
    b.play('b8c6');
    expect(b.undo()).toBe(true);
    expect(b.lineText).toBe('1…e5');
    expect(b.isPlayerTurn).toBe(true);
    expect(b.undo()).toBe(false); // nothing of the player's left
  });

  it('writes the line with move numbers, from either side', () => {
    const w = new Branch(FORK, 'white');
    w.play('d5c7');
    w.play('e8d7');
    w.play('c7a8');
    expect(w.lineText).toBe('1.Nxc7+ Kd7 2.Nxa8');
    const bl = new Branch(AFTER_E4, 'black');
    bl.play('e7e5');
    bl.play('g1f3');
    expect(bl.lineText).toBe('1…e5 2.Nf3');
    const mid = new Branch('r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3', 'white');
    mid.play('f1b5');
    expect(mid.lineText).toBe('3.Bb5');
  });

  it('reports the end of the line (checkmate, with the winner)', () => {
    const b = new Branch(START, 'white');
    for (const m of ['f2f3', 'e7e5', 'g2g4']) b.play(m);
    expect(b.result).toEqual({ over: false });
    b.play('d8h4');
    expect(b.result).toEqual({ over: true, winner: 'black', reason: 'checkmate' });
    expect(b.inCheck).toBe(true);
  });
});
