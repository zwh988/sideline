import { describe, expect, it } from 'vitest';
import { cutLine } from './lines';

const L2 = { maxPlies: 4, minGain: 3 };

describe('cutLine', () => {
  it('teaches mate in 1 as a one-move line', () => {
    const r = cutLine('r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4', ['h5f7'], {
      ...L2,
      evalCp: 0,
      mateIn: 1,
    });
    expect(r.kind).toBe('line');
    if (r.kind !== 'line') return;
    expect(r.line.mate).toBe(true);
    expect(r.line.motif).toBe('mate-in-1');
    expect(r.line.moves.map((m) => m.san)).toEqual(['Qxf7#']);
  });

  it('cuts a knight fork after the rook is taken, not before', () => {
    // Engine line continues past the payoff; the cut keeps only Nxc7+ Kd7 Nxa8.
    const r = cutLine(
      'r3kb1r/ppp2ppp/8/3N4/8/8/PPP2PPP/R3KB1R w KQkq - 0 1',
      ['d5c7', 'e8d7', 'c7a8', 'f8d6', 'e1c1', 'd7e7'],
      { ...L2, evalCp: 650 },
    );
    expect(r.kind).toBe('line');
    if (r.kind !== 'line') return;
    expect(r.line.moves.map((m) => m.san)).toEqual(['Nxc7+', 'Kd7', 'Nxa8']);
    expect(r.line.gain).toBe(6);
    expect(r.line.motif).toBe('fork');
    expect(r.line.positionalRest).toBe(false);
  });

  it('takes a hanging piece as a one-move line', () => {
    // Black knight on e5 is undefended; White's d4 pawn takes it.
    const r = cutLine('4k3/8/8/4n3/3P4/8/8/4K3 w - - 0 1', ['d4e5', 'e8e7', 'e1e2'], { ...L2, evalCp: 400 });
    expect(r.kind).toBe('line');
    if (r.kind !== 'line') return;
    expect(r.line.moves.map((m) => m.san)).toEqual(['dxe5']);
    expect(r.line.motif).toBe('hanging-piece');
  });

  it('treats a defended queen attacked by a knight as a loose piece', () => {
    // 1.e4 e5 2.Nf3 d6 3.d4 exd4 4.Qxd4 Nc6 5.Bc4?? — Black to move: Nxd4 Nxd4.
    const r = cutLine('r1bqkbnr/ppp2ppp/2np4/8/2BQP3/5N2/PPP2PPP/RNB1K2R b KQkq - 1 5', ['c6d4', 'f3d4', 'g8f6'], {
      ...L2,
      evalCp: 600,
    });
    expect(r.kind).toBe('line');
    if (r.kind !== 'line') return;
    expect(r.line.moves.map((m) => m.san)).toEqual(['Nxd4', 'Nxd4']);
    expect(r.line.motif).toBe('hanging-piece');
    expect(r.line.gain).toBe(6);
  });

  it('does not call a longer combination a loose piece', () => {
    // Bxd5 exd5 Nxd5 is a three-move sequence: general material win.
    const r = cutLine('6k1/5ppp/4p3/3r4/8/1BN5/5PPP/6K1 w - - 0 1', ['b3d5', 'e6d5', 'c3d5', 'g8f8'], {
      ...L2,
      evalCp: 320,
    });
    expect(r.kind === 'line' && r.line.motif).toBe('winning-material');
  });

  it('never cuts mid-exchange', () => {
    // Bxd5 wins a rook (+5) but exd5 recaptures; the cut comes after Nxd5 (+3).
    const r = cutLine('6k1/5ppp/4p3/3r4/8/1BN5/5PPP/6K1 w - - 0 1', ['b3d5', 'e6d5', 'c3d5', 'g8f8'], {
      ...L2,
      evalCp: 320,
    });
    expect(r.kind).toBe('line');
    if (r.kind !== 'line') return;
    expect(r.line.moves.map((m) => m.san)).toEqual(['Bxd5', 'exd5', 'Nxd5']);
    expect(r.line.gain).toBe(3);
  });

  it('finds no payoff when the line ends with the side down material', () => {
    // Rxd8+ Rxd8 Re8+ Rxe8: White trades one rook and loses the other.
    const r = cutLine('2rr2k1/5ppp/8/8/8/8/5PPP/3RR1K1 w - - 0 1', ['d1d8', 'c8d8', 'e1e8', 'd8e8'], {
      ...L2,
      evalCp: -400,
    });
    expect(r.kind).toBe('none');
  });

  it('cuts after the payoff even if spite checks follow', () => {
    // Real Stockfish line after 1.Nxc7+ Kd7: Nxa8 Bb4+ c3 Re8+ Kd1 Rd8+ cxb4.
    const r = cutLine(
      'r4b1r/ppNk1ppp/8/8/8/8/PPP2PPP/R3KB1R w KQ - 1 2',
      ['c7a8', 'f8b4', 'c2c3', 'h8e8', 'e1d1', 'e8d8', 'c3b4', 'd7e7', 'd1e1', 'd8a8'],
      { maxPlies: 4, minGain: 3, evalCp: 730 },
    );
    expect(r.kind).toBe('line');
    if (r.kind !== 'line') return;
    expect(r.line.moves.map((m) => m.san)).toEqual(['Nxa8']);
    expect(r.line.gain).toBe(5);
  });

  it('records material given back later in the engine line', () => {
    // Nxa8 wins the rook; three moves later the king traps and takes the knight.
    const r = cutLine(
      'r3kb1r/ppp2ppp/8/3N4/8/8/PPP2PPP/R3KB1R w KQkq - 0 1',
      ['d5c7', 'e8d7', 'c7a8', 'd7c8', 'a2a3', 'c8b8', 'a3a4', 'b8a8', 'a4a5'],
      { maxPlies: 4, minGain: 3, evalCp: 300 },
    );
    expect(r.kind).toBe('line');
    if (r.kind !== 'line') return;
    expect(r.line.gain).toBe(6);
    expect(r.line.laterLoss).toBe(3);
  });

  it('does not count a gain that is lost again right away', () => {
    // Bxd5 wins a rook but the line then loses the bishop and more at once.
    const r = cutLine('6k1/5ppp/4p3/3r4/8/1B6/5PPP/6K1 w - - 0 1', ['b3d5', 'e6d5', 'g1f1', 'g8f8'], {
      maxPlies: 4,
      minGain: 3,
      evalCp: 200,
    });
    expect(r.kind).toBe('none'); // rook for bishop is +2, below a piece
  });

  it('reports a payoff beyond the level limit as too deep', () => {
    // Same fork, but Level 1 only teaches lines up to 2 plies.
    const r = cutLine('r3kb1r/ppp2ppp/8/3N4/8/8/PPP2PPP/R3KB1R w KQkq - 0 1', ['d5c7', 'e8d7', 'c7a8', 'f8d6'], {
      maxPlies: 2,
      minGain: 3,
      evalCp: 650,
    });
    expect(r).toEqual({ kind: 'too-deep', plies: 3 });
  });

  it('flags a positional rest when the engine sees much more than the material', () => {
    const r = cutLine('4k3/8/8/4n3/3P4/8/8/4K3 w - - 0 1', ['d4e5', 'e8e7', 'e1e2'], { ...L2, evalCp: 900 });
    expect(r.kind === 'line' && r.line.positionalRest).toBe(true);
  });
});

describe('motif of a line', () => {
  // A game (Nov 27): 24.Qg8+ checks along the 8th rank with the rook on a8 behind the king.
  const SKEWER = 'r3k3/p1p1q3/1pn5/5b2/3PpB1N/2P3Q1/P1P3PP/R3R1K1 w - - 0 24';
  const L4 = { maxPlies: 6, minGain: 2 };

  it('names a skewer when the line takes the piece behind the king', () => {
    const r = cutLine(SKEWER, ['g3g8', 'e8d7', 'g8a8'], { ...L4, evalCp: 900 });
    expect(r.kind === 'line' && [r.line.motif, r.line.gain]).toEqual(['skewer', 5]);
  });

  it('a check that is a queen trade is not a fork (the line wins the loose bishop)', () => {
    // Qg8+ Qf8 Qxf8+ "attacks" the king and the bishop on f5, but Kxf8 simply takes the queen.
    const r = cutLine(SKEWER, ['g3g8', 'e7f8', 'g8f8', 'e8f8', 'h4f5'], { ...L4, evalCp: 900 });
    expect(r.kind === 'line' && [r.line.motif, r.line.gain]).toEqual(['winning-material', 3]);
  });

  it('names a pin when the line takes the pinned piece', () => {
    // Re1 pins the knight on e5 to the king on e8; the rook takes it.
    const r = cutLine('4k3/8/8/4n3/8/8/8/K6R w - - 0 1', ['h1e1', 'e8d7', 'e1e5'], { ...L4, evalCp: 300 });
    expect(r.kind === 'line' && [r.line.motif, r.line.gain]).toEqual(['pin', 3]);
  });

  it('a skewer that the line does not cash in is not named', () => {
    // Same check, but the line wins the bishop instead of the rook: no skewer claim.
    const r = cutLine(SKEWER, ['g3g8', 'e7f8', 'g8f8', 'e8f8', 'h4f5'], { ...L4, evalCp: 900 });
    expect(r.kind === 'line' && r.line.motif).not.toBe('skewer');
  });
});
