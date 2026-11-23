import { Chess } from 'chess.js';
import { describe, expect, it } from 'vitest';
import { isTrapped, lineUps } from './motifs';

describe('lineUps', () => {
  it('finds a pin: bishop, knight, king on one diagonal', () => {
    const c = new Chess('4k3/3n4/8/1B6/8/8/8/4K3 b - - 0 1');
    const l = lineUps(c, 'w');
    expect(l).toHaveLength(1);
    expect(l[0]).toMatchObject({ kind: 'pin', by: 'b5', front: { square: 'd7', type: 'n' }, back: { square: 'e8', type: 'k' } });
  });

  it('finds a skewer: rook, king in front, queen behind', () => {
    const c = new Chess('4q3/8/8/8/4k3/4R3/8/7K b - - 0 1');
    const l = lineUps(c, 'w');
    expect(l.map((x) => x.kind)).toEqual(['skewer']);
  });

  it('ignores a pawn behind the front piece (not worth skewering) and own pieces', () => {
    expect(lineUps(new Chess('4k3/8/8/4p3/4r3/8/8/4R2K w - - 0 1'), 'w')).toEqual([]);
  });
});

describe('isTrapped', () => {
  it('a knight in the corner with its own pawn on c7 and b6 covered by a pawn has no safe square', () => {
    const c = new Chess('n3k3/2p5/8/P7/8/8/8/4K3 b - - 0 1');
    expect(isTrapped(c, 'a8', 'w')).toBe(true);
  });

  it('not trapped when b6 is safe', () => {
    const c = new Chess('n3k3/2p5/8/8/P7/8/8/4K3 b - - 0 1');
    expect(isTrapped(c, 'a8', 'w')).toBe(false);
  });

  it('not trapped when the piece is pinned or the side is in check, and pawns are never "trapped"', () => {
    expect(isTrapped(new Chess('4k3/8/8/8/8/8/4p3/4K3 b - - 0 1'), 'e2', 'w')).toBe(false);
    expect(isTrapped(new Chess('4k3/8/8/8/8/8/4q3/R3K3 w - - 0 1'), 'a1', 'b')).toBe(false); // wrong side to move
  });
});
