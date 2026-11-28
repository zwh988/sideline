import { Chess } from 'chess.js';
import { describe, expect, it } from 'vitest';
import { failedRecapture, materialBalance, playAndDescribe } from './facts';

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

  it('counts a defended knight as a target when it is attacked more often than defended', () => {
    // 17...Bxd4: Nc3 has no guard; Ne5 is hit by Bd4, Qf6 and Ng6, guarded only by Qh5.
    const fen = 'r3k2r/p2b3p/1b2pqnp/3pN2Q/3P4/P1NB4/2P2PPP/R4RK1 b kq - 0 17';
    const f = playAndDescribe(new Chess(fen), 'b6d4');
    expect(f.attacks.map((t) => t.square).sort()).toEqual(['c3', 'e5']);
    expect(f.doubleAttack).toBe(true);
    // Without Qf6 and Ng6 (a pawn on f7 instead, to keep Qh5 off the king), Ne5 has one attacker and one guard: no fork.
    const g = playAndDescribe(new Chess('r3k2r/p2b1p1p/1b2p2p/3pN2Q/3P4/P1NB4/2P2PPP/R4RK1 b kq - 0 17'), 'b6d4');
    expect(g.attacks.map((t) => t.square)).toEqual(['c3']);
    expect(g.doubleAttack).toBe(false);
  });

  it('does not call it a fork when the forking piece is simply lost', () => {
    // Knight on d5 forks two rooks but a pawn on e6 takes it.
    const chess = new Chess('4k3/2r1r3/4p3/8/8/2N5/8/4K3 w - - 0 1');
    const f = playAndDescribe(chess, 'c3d5');
    expect(f.attacks.length).toBe(2);
    expect(f.doubleAttack).toBe(false);
  });
});

describe('failedRecapture', () => {
  const afterMoves = (fen: string, ...ucis: string[]) => {
    const c = new Chess(fen);
    for (const u of ucis) c.move({ from: u.slice(0, 2), to: u.slice(2, 4) });
    return c.fen();
  };

  it('explains a pawn defended only by a queen that would be lost', () => {
    // Real game: 1.e4 Nf6 2.Nc3 d5 3.d3 e5 4.Nxd5 Nxd5 5.exd5 Qxd5 6.d4? exd4: Qxd4 loses the queen to Qxd4.
    const fen = afterMoves('rnb1kb1r/ppp2ppp/8/3qp3/8/3P4/PPP2PPP/R1BQKBNR w KQkq - 0 6', 'd3d4', 'e5d4');
    expect(failedRecapture(fen, 'd4')).toEqual({
      recapture: { san: 'Qxd4', piece: 'q' },
      reply: { san: 'Qxd4', piece: 'q' },
    });
  });

  it('says nothing when the recapture works', () => {
    // 1.e4 d5 2.exd5: Qxd5 can't be taken.
    const fen = afterMoves(new Chess().fen(), 'e2e4', 'd7d5', 'e4d5');
    expect(failedRecapture(fen, 'd5')).toBeUndefined();
  });

  it('says nothing when there is no recapture', () => {
    expect(failedRecapture('4k3/8/8/4P3/8/8/8/4K3 b - - 0 1', 'e5')).toBeUndefined();
  });

  it('says nothing when the exchange goes on (a rook behind the queen)', () => {
    // Qxd4 Qxd4 Rxd4: the rook takes back again.
    expect(failedRecapture('6k1/8/8/3q4/3p4/8/3Q4/3R2K1 w - - 0 1', 'd4')).toBeUndefined();
  });

  it('says nothing when the recapture still pays (a rook takes a queen)', () => {
    expect(failedRecapture('6k1/8/8/3q4/3q4/8/8/3R2K1 w - - 0 1', 'd4')).toBeUndefined();
  });

  it('says nothing with two ways to take back', () => {
    expect(failedRecapture('6k1/8/8/3q4/3p4/5N2/8/3Q2K1 w - - 0 1', 'd4')).toBeUndefined();
  });
});
