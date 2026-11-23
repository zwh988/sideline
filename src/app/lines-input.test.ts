import { describe, expect, it } from 'vitest';
import { LineInput } from './lines-input';

// White to move: Nxc7+ forks king and rook. Black replies Kd7 (or Ke7, Kf... ), then Nxa8.
const FORK = 'r3kb1r/ppp2ppp/8/3N4/8/8/PPP2PPP/R3KB1R w KQkq - 0 1';

describe('LineInput', () => {
  it('selects a piece, then adds a legal move; colours alternate', () => {
    const l = new LineInput(FORK);
    expect(l.nextIsMine).toBe(true);
    const sel = l.tap('d5');
    expect(sel).toMatchObject({ kind: 'selected', square: 'd5' });
    expect(sel.kind === 'selected' && sel.dests).toContain('c7');
    const r = l.tap('c7');
    expect(r).toMatchObject({ kind: 'added', move: { san: 'Nxc7+', uci: 'd5c7', mine: true } });
    expect(l.nextIsMine).toBe(false);
    l.tap('e8');
    const reply = l.tap('d7');
    expect(reply).toMatchObject({ kind: 'added', move: { san: 'Kd7', mine: false } });
    expect(l.moves.map((m) => m.mine)).toEqual([true, false]);
    expect(l.fen.split(' ')[1]).toBe('w');
  });

  it('shows an illegal target as invalid and keeps the piece selected', () => {
    const l = new LineInput(FORK);
    l.tap('d5');
    expect(l.tap('d6')).toMatchObject({ kind: 'invalid', from: 'd5', to: 'd6' });
    expect(l.selected).toBe('d5');
    expect(l.tap('c7').kind).toBe('added'); // then a legal tap still works
    expect(l.moves).toHaveLength(1);
  });

  it('tapping another own piece switches the selection', () => {
    const l = new LineInput(FORK);
    l.tap('a1');
    const r = l.tap('a2'); // own pawn: switches nothing, it is a pawn of the same side → reselect
    expect(r.kind).toBe('selected');
  });

  it("ignores the other side's pieces and empty squares when nothing is selected", () => {
    const l = new LineInput(FORK);
    expect(l.tap('e8')).toMatchObject({ kind: 'ignored' });
    expect(l.tap('e4')).toMatchObject({ kind: 'ignored' });
  });

  it('tapping the selected piece again deselects; another own piece switches', () => {
    const l = new LineInput(FORK);
    l.tap('d5');
    expect(l.tap('d5').kind).toBe('deselected');
    l.tap('d5');
    expect(l.tap('f1')).toMatchObject({ kind: 'selected', square: 'f1' });
  });

  it('undo removes the last arrow and restores the position', () => {
    const l = new LineInput(FORK);
    l.tap('d5');
    l.tap('c7');
    expect(l.undo()?.san).toBe('Nxc7+');
    expect(l.fen).toBe(FORK);
    expect(l.isEmpty).toBe(true);
    expect(l.undo()).toBeUndefined();
  });

  it('a pawn reaching the last rank asks for the promotion piece first', () => {
    const l = new LineInput('8/P3k3/8/8/8/8/8/4K3 w - - 0 1');
    l.tap('a7');
    expect(l.tap('a8')).toMatchObject({ kind: 'needs-promotion', from: 'a7', to: 'a8' });
    expect(l.moves).toHaveLength(0);
    expect(l.add('a7', 'a8', 'q')).toMatchObject({ kind: 'added', move: { uci: 'a7a8q', san: 'a8=Q' } });
  });

  it('is full after MAX_LINE_MOVES moves', () => {
    const l = new LineInput('4k3/8/8/8/8/8/8/R3K3 w - - 0 1');
    const shuffle = [
      ['a1', 'a2'], ['e8', 'd8'], ['a2', 'a1'], ['d8', 'e8'],
      ['a1', 'a2'], ['e8', 'd8'], ['a2', 'a1'], ['d8', 'e8'],
    ] as const;
    for (const [f, t] of shuffle) l.add(f, t);
    expect(l.isFull).toBe(true);
    expect(l.tap('a1').kind).toBe('full');
  });

  it('reports a finished game in the line', () => {
    // Fool's mate: after 1.f3 e5 2.g4 Qh4# nothing more can be added.
    const l = new LineInput('rnbqkbnr/pppp1ppp/8/4p3/6P1/5P2/PPPPP2P/RNBQKBNR b KQkq - 0 2', false);
    expect(l.nextIsMine).toBe(false);
    l.add('d8', 'h4');
    expect(l.ended).toBe(true);
    expect(l.tap('a2').kind).toBe('ignored');
  });

  it('load puts a line back, and truncate keeps a prefix (for branches)', () => {
    const l = new LineInput(FORK);
    l.tap('d5');
    l.tap('c7');
    l.tap('e8');
    l.tap('d7');
    const saved = [...l.moves];
    l.truncate(1);
    expect(l.moves).toHaveLength(1);
    l.load(saved);
    expect(l.moves.map((m) => m.san)).toEqual(['Nxc7+', 'Kd7']);
    expect(l.line.rootFen).toBe(FORK);
  });
});
