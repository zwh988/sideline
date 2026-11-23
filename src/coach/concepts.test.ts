import { describe, expect, it } from 'vitest';
import { detectConcepts, puzzleStart, type PuzzleRecord } from './concepts';

// Four rows copied from the Lichess puzzle database page (CC0), with their theme labels.
const LICHESS: PuzzleRecord[] = [
  { id: '00sHx', fen: 'q3k1nr/1pp1nQpp/3p4/1P2p3/4P3/B1PP1b2/B5PP/5K2 b k - 0 17', moves: 'e8d7 a2e6 d7d8 f7f8'.split(' '), rating: 1760, themes: ['mate', 'mateIn2', 'middlegame', 'short'] },
  { id: '00sJb', fen: 'Q1b2r1k/p2np2p/5bp1/q7/5P2/4B3/PPP3PP/2KR1B1R w - - 1 17', moves: 'd1d7 a5e1 d7d1 e1e3 c1b1 e3b6'.split(' '), rating: 2235, themes: ['advantage', 'fork', 'long'] },
  { id: '00sO1', fen: '1k1r4/pp3pp1/2p1p3/4b3/P3n1P1/8/KPP2PN1/3rBR1R b - - 2 31', moves: 'b8c7 e1a5 b7b6 f1d1'.split(' '), rating: 998, themes: ['advantage', 'discoveredAttack', 'master', 'middlegame', 'short'] },
];

const detect = (p: PuzzleRecord) => {
  const s = puzzleStart(p);
  return detectConcepts(s.fen, s.solution);
};

describe('puzzleStart', () => {
  it('applies the opponent\'s first move and leaves the solver to move', () => {
    const s = puzzleStart(LICHESS[0]);
    expect(s.fen.split(' ')[1]).toBe('w');
    expect(s.solution).toEqual(['a2e6', 'd7d8', 'f7f8']);
  });
});

describe('detectConcepts on Lichess puzzles', () => {
  it('finds a mate in 2', () => {
    const found = detect(LICHESS[0]);
    expect(found.has('mate')).toBe(true);
    expect(found.has('mateIn2')).toBe(true);
    expect(found.has('mateIn1')).toBe(false);
  });

  it('finds a fork', () => {
    expect(detect(LICHESS[1]).has('fork')).toBe(true);
  });

  // Known gap (task 1.6c): the bishop move uncovers the f1 rook against a *defended* rook of equal value
  // that is attacked twice. Our discovered-attack rule wants a more valuable or undefended target.
  it.fails('finds a discovered attack on a defended piece attacked more often than defended', () => {
    expect(detect(LICHESS[2]).has('discoveredAttack')).toBe(true);
  });
});

describe('detectConcepts on hand-checked positions', () => {
  it('back-rank mate: Ra8# with the king boxed in by its own pawns', () => {
    const found = detectConcepts('6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1', ['a1a8']);
    expect([...found].sort()).toEqual(['backRankMate', 'mate', 'mateIn1']);
  });

  it('not a back-rank mate when the queen mates from off the back rank', () => {
    const found = detectConcepts('7k/8/6K1/8/8/8/1Q6/8 w - - 0 1', ['b2g7']);
    expect(found.has('mate')).toBe(true);
    expect(found.has('backRankMate')).toBe(false);
  });

  it('smothered mate: Nf7# with the king buried by its own rook and pawns', () => {
    const found = detectConcepts('6rk/6pp/8/6N1/8/8/8/6K1 w - - 0 1', ['g5f7']);
    expect(found.has('smotheredMate')).toBe(true);
    expect(found.has('backRankMate')).toBe(false);
    expect(found.has('mateIn1')).toBe(true);
  });

  it('knight fork: Nxc7+ hits the king and the rook', () => {
    const found = detectConcepts('r3kb1r/ppp2ppp/8/3N4/8/8/PPP2PPP/R3KB1R w KQkq - 0 1', ['d5c7', 'e8d7', 'c7a8']);
    expect(found.has('fork')).toBe(true);
    expect(found.has('mate')).toBe(false);
  });

  it('hanging piece: taking an undefended queen', () => {
    const found = detectConcepts('4k3/8/8/3q4/8/8/8/3QK3 w - - 0 1', ['d1d5']);
    expect(found.has('hangingPiece')).toBe(true);
  });

  it('not a hanging piece when the captured piece is defended', () => {
    const found = detectConcepts('4k3/8/2p5/3q4/8/8/8/3QK3 w - - 0 1', ['d1d5']);
    expect(found.has('hangingPiece')).toBe(false);
  });

  it('promotion', () => {
    const found = detectConcepts('8/P6k/8/8/8/8/8/K7 w - - 0 1', ['a7a8q']);
    expect(found.has('promotion')).toBe(true);
  });
});
