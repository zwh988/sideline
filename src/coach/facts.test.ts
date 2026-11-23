import { Chess } from 'chess.js';
import { describe, expect, it } from 'vitest';
import { materialBalance, playAndDescribe } from './facts';

describe('materialBalance', () => {
  it('is zero at the start and counts a won rook', () => {
    expect(materialBalance(new Chess(), 'w')).toBe(0);
    expect(materialBalance(new Chess('4k3/8/8/8/8/8/8/R3K3 w - - 0 1'), 'w')).toBe(5);
    expect(materialBalance(new Chess('4k3/8/8/8/8/8/8/R3K3 w - - 0 1'), 'b')).toBe(-5);
  });
});

describe('playAndDescribe', () => {
  it('sees a knight fork of king and rook with check', () => {
    const chess = new Chess('r3kb1r/ppp2ppp/8/3N4/8/8/PPP2PPP/R3KB1R w KQkq - 0 1');
    const f = playAndDescribe(chess, 'd5c7');
    expect(f.san).toBe('Nxc7+');
    expect(f.check).toBe(true);
    expect(f.captured).toBe('p');
    expect(f.capturedUndefended).toBe(true);
    expect(f.doubleAttack).toBe(true);
    expect(f.attacks.map((t) => t.square).sort()).toEqual(['a8', 'e8']);
  });

  it('sees checkmate', () => {
    const chess = new Chess('r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4');
    const f = playAndDescribe(chess, 'h5f7');
    expect(f.mate).toBe(true);
    expect(f.captured).toBe('p');
    expect(f.capturedUndefended).toBe(false); // the king defended f7
  });

  it('marks a defended capture as defended', () => {
    // 1.e4 d5: exd5 takes a pawn the queen defends.
    const chess = new Chess('rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 2');
    const f = playAndDescribe(chess, 'e4d5');
    expect(f.capturedUndefended).toBe(false);
    expect(f.doubleAttack).toBe(false);
  });

  it('sees a discovered attack on the queen', () => {
    // White bishop b1 behind knight d3 looks at h7... use a rook: Rd1 behind Nd4, black queen d8.
    const chess = new Chess('3qk3/8/8/8/3N4/8/8/3RK3 w - - 0 1');
    const f = playAndDescribe(chess, 'd4f5');
    expect(f.discovered?.by).toBe('d1');
    expect(f.discovered?.target.piece).toBe('q');
  });

  it('does not call a pawn attacking two loose pawns a fork', () => {
    const chess = new Chess('4k3/8/2p1p3/8/3P4/8/8/4K3 w - - 0 1');
    const f = playAndDescribe(chess, 'd4d5');
    expect(f.doubleAttack).toBe(false);
  });

  it('sees a pawn fork of two knights', () => {
    const chess = new Chess('4k3/8/2n1n3/8/3P4/8/8/4K3 w - - 0 1');
    const f = playAndDescribe(chess, 'd4d5');
    expect(f.doubleAttack).toBe(true);
  });

  it('does not call it a fork when the forking piece is simply lost', () => {
    // Knight on d5 forks two rooks but a pawn on e6 takes it.
    const chess = new Chess('4k3/2r1r3/4p3/8/8/2N5/8/4K3 w - - 0 1');
    const f = playAndDescribe(chess, 'c3d5');
    expect(f.attacks.length).toBe(2);
    expect(f.doubleAttack).toBe(false);
  });
});
