import { describe, expect, it } from 'vitest';
import { positionFacts, reasonsFor } from './position';

describe('positionFacts', () => {
  it('finds a passed pawn and says what makes it passed', () => {
    // White pawn d5; Black has only a king and a pawn on h7: nothing near the d-file.
    const f = positionFacts('8/7p/8/3P4/8/8/8/k1K5 w - - 0 1');
    const p = f.find((x) => x.kind === 'passed-pawn' && x.favours === 'w')!;
    expect(p.squares).toEqual(['d5']);
    expect(p.text).toBe('White has a passed pawn on d5: no black pawn on the c, d, e files is ahead of it.');
  });

  it('a pawn with an enemy pawn ahead on a neighbouring file is not passed', () => {
    // White d5, Black pawn on e6 (ahead of d5 on a neighbouring file).
    const f = positionFacts('8/8/4p3/3P4/8/8/8/k1K5 w - - 0 1');
    expect(f.some((x) => x.kind === 'passed-pawn' && x.favours === 'w')).toBe(false);
    // Black's e6 pawn is passed: nothing of White's is ahead (below) it on d, e, f.
    expect(f.some((x) => x.kind === 'passed-pawn' && x.favours === 'b')).toBe(false); // the d5 pawn is below e6 on a neighbouring file
  });

  it('isolated and doubled pawns favour the other side', () => {
    // White pawns on a2, a3 (doubled, and isolated: nothing on b), Black has king and rook only.
    const f = positionFacts('4k3/8/8/8/8/P7/P7/4K2r w - - 0 1');
    const d = f.find((x) => x.kind === 'doubled-pawns')!;
    expect(d.favours).toBe('b');
    expect(d.squares.sort()).toEqual(['a2', 'a3']);
    expect(f.find((x) => x.kind === 'isolated-pawn')!.favours).toBe('b');
  });

  it('a king on a file with no pawns, against a rook, is flagged; a sheltered one is not', () => {
    // Black king on g8 with pawns on f7 and h7 but none on the g-file; White has a rook.
    const open = positionFacts('6k1/5p1p/8/8/8/8/8/R3K3 w - - 0 1');
    expect(open.find((x) => x.kind === 'open-king')).toMatchObject({ favours: 'w', squares: ['g8'] });
    const sheltered = positionFacts('6k1/5ppp/8/8/8/8/8/R3K3 w - - 0 1');
    expect(sheltered.some((x) => x.kind === 'open-king' && x.squares[0] === 'g8')).toBe(false);
  });

  it('the bishop pair counts only against fewer bishops', () => {
    const f = positionFacts('4k3/8/8/8/8/8/8/2B1KB2 w - - 0 1');
    expect(f.find((x) => x.kind === 'bishop-pair')).toMatchObject({ favours: 'w', squares: ['c1', 'f1'] });
    expect(positionFacts('2b1kb2/8/8/8/8/8/8/2B1KB2 w - - 0 1').some((x) => x.kind === 'bishop-pair')).toBe(false);
  });

  it('says nothing about the start position', () => {
    expect(positionFacts('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1')).toEqual([]);
  });
});

describe('reasonsFor', () => {
  it('lists the facts that favour the better side, passed pawn first', () => {
    // White: passed d5 pawn and a rook; Black has doubled h-pawns (h7, h6) and a king on the pawn-free e-file.
    const r = reasonsFor('4k3/7p/7p/3P4/8/8/8/R3K3 w - - 0 1', 'w');
    expect(r.map((x) => x.kind)).toEqual(['passed-pawn', 'open-king', 'doubled-pawns', 'isolated-pawn']);
    expect(reasonsFor('4k3/7p/7p/3P4/8/8/8/R3K3 w - - 0 1', 'b').map((x) => x.kind)).toEqual(['passed-pawn', 'isolated-pawn']);
  });
});
