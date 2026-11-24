import { describe, expect, it } from 'vitest';
import { puzzleStart } from './concepts';
import { explainLine, taughtFrom } from './lineexplain';
import { winsPhrase } from './templates';

// The reviewed game's position: Rxc8+ Qxc8 Qxd4 is the engine's line (Black's Bd4 is undefended).
const ROOK_FEN = '1Rr3k1/Q1pq1p1p/p2p2p1/3p4/3b4/7P/P1P2PP1/6K1 w - - 0 1';

describe('explainLine', () => {
  it('words every move of Rxc8+ Qxc8 Qxd4, by facts only', () => {
    const steps = explainLine(ROOK_FEN, ['b8c8', 'd7c8', 'a7d4'], { player: 'w' });
    expect(steps.map((s) => s.san)).toEqual(['Rxc8+', 'Qxc8', 'Qxd4']);
    expect(steps[0].text).toBe('That takes my rook on c8, with check.');
    expect(steps[1].text).toBe('That takes back on c8.');
    expect(steps[2].text).toBe('That bishop was a loose piece: nothing defended it.');
    expect(steps.map((s) => s.mine)).toEqual([true, false, true]);
  });

  it('looks back with "their" instead of "my"', () => {
    const steps = explainLine(ROOK_FEN, ['b8c8'], { player: 'w', voice: 'review' });
    expect(steps[0].text).toBe('That takes their rook on c8, with check.');
  });

  it('what the line wins is the net material, said by winsPhrase', () => {
    const line = taughtFrom(ROOK_FEN, ['b8c8', 'd7c8', 'a7d4'])!;
    expect(line.gain).toBe(3);
    expect(winsPhrase(line)).toBe('a bishop');
  });

  it('names a skewer when it is cashed in later in the line', () => {
    // 1.Re1+ Kd4?? is not forced; Black's king is skewered with the queen behind it: Re1+ Kf5 Rxe8.
    const fen = '4q3/8/8/8/4k3/8/8/R6K w - - 0 1';
    const steps = explainLine(fen, ['a1e1', 'e4f5', 'e1e8'], { player: 'w' });
    expect(steps[0].concept).toBe('skewer');
    expect(steps[0].text).toContain("That's a skewer");
    expect(steps[2].payoff).toBe('The skewer pays off: Rxe8 takes the queen.');
    expect(steps[2].concept).toBe('cashedIn');
  });

  it('says nothing for a quiet move', () => {
    const steps = explainLine('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', ['e2e4'], { player: 'w' });
    expect(steps[0].text).toBe('');
    expect(steps[0].concept).toBeUndefined();
  });

  it('deflection (Lichess 0MUjp): Qc7+ makes the king leave the bishop it guarded, then Qxc8#', () => {
    const s = puzzleStart({ fen: 'NQ1k1b1r/1p1bpppp/8/4P3/2P2q2/5n2/PP4PP/R1n2K1R b - - 1 18', moves: 'd7c8 b8c7 d8e8 c7c8'.split(' ') });
    const steps = explainLine(s.fen, s.solution, { player: 'w' });
    expect(steps.map((x) => x.san)).toEqual(['Qc7+', 'Ke8', 'Qxc8#']);
    expect(steps[1].text).toBe('The king left d8, where it defended my bishop on c8, so that piece is now undefended.');
    expect(steps[2].payoff).toBe('Qxc8# takes it: that is a deflection, the defender was drawn away first.');
  });

  it('attraction (Lichess 0va8T): the king takes on h7 and Rh4# follows', () => {
    const s = puzzleStart({ fen: 'rn3r1k/6pp/p2pBq2/1p3P1Q/4bR2/2P5/P1P3PP/R5K1 b - - 1 17', moves: 'f6c3 h5h7 h8h7 f4h4'.split(' ') });
    const steps = explainLine(s.fen, s.solution, { player: 'w' });
    expect(steps[1].text).toContain('The king was pulled to h7: that is an attraction.');
    expect(steps[1].concept).toBe('attraction');
  });

  it('intermezzo (Lichess 1F0sM): Nxe7+ comes before taking back on c2', () => {
    const s = puzzleStart({ fen: '3r1rk1/ppq1bpp1/5n1p/3Nnb2/4pN1P/1P2P3/PBQR1PP1/4KB1R b K - 7 17', moves: 'c7c2 d5e7 g8h7 d2c2'.split(' ') });
    // The line starts after Black's Qxc2; White's Nxe7+ comes first, Rxc2 takes back after Kh7.
    const steps = explainLine(s.fen, s.solution, { player: 'w', previous: { fen: '3r1rk1/ppq1bpp1/5n1p/3Nnb2/4pN1P/1P2P3/PBQR1PP1/4KB1R b K - 7 17', uci: 'c7c2' } });
    expect(steps[0].concept).toBe('intermezzo');
    expect(steps[0].text).toContain('Instead of taking back on c2 at once, this comes first (it gives check); the takeback follows.');
  });
});
