import { describe, expect, it } from 'vitest';
import { conceptNote } from './explain';

describe('conceptNote', () => {
  it('fork, from the player\'s side: the targets are the coach\'s pieces', () => {
    const n = conceptNote('r3kb1r/ppp2ppp/8/3N4/8/8/PPP2PPP/R3KB1R w KQkq - 0 1', 'd5c7', 'you');
    expect(n).toEqual({ concept: 'fork', text: "That's a fork: your knight on c7 attacks my king on e8 and my rook on a8 at once." });
  });

  it('fork, from the coach\'s side: the targets are the player\'s', () => {
        const n = conceptNote('4k3/2p5/8/8/8/8/8/R3K2R b KQ - 0 1', 'c7c5', 'me');
    expect(n).toBeUndefined(); // a plain pawn push says nothing
    const f = conceptNote('4k3/8/8/8/3n4/8/8/R3K3 b Q - 0 1', 'd4c2', 'me');
    expect(f?.text).toBe("That's a fork: my knight on c2 attacks your king on e1 and your rook on a1 at once.");
  });

  it('skewer: the rook checks the king and the queen stands behind it', () => {
    const n = conceptNote('4q3/8/8/8/4k3/8/8/R6K w - - 0 1', 'a1e1', 'you');
    expect(n?.concept).toBe('skewer');
    expect(n?.text).toBe("That's a skewer: your rook on e1 attacks the king on e4, and the queen on e8 is lined up behind it.");
  });

  it('pin: pinned to the king', () => {
    const n = conceptNote('4k3/3q4/8/8/B7/8/8/4K3 w - - 0 1', 'a4b5', 'you');
    expect(n).toEqual({
      concept: 'pin',
      text: "That's a pin: your bishop on b5 attacks the queen on d7, which is pinned to the king and can't leave that line.",
    });
  });

  it('discovered attack: the bishop move uncovers the rook\'s check', () => {
    const n = conceptNote('4k3/8/8/4B3/8/8/8/4R1K1 w - - 0 1', 'e5d4', 'you');
    expect(n?.concept).toBe('discoveredAttack');
    expect(n?.text).toContain('uncovers the rook on e1');
  });

  it('back-rank mate and smothered mate', () => {
    expect(conceptNote('6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1', 'a1a8', 'you')?.concept).toBe('backRankMate');
    expect(conceptNote('6rk/6pp/8/6N1/8/8/8/6K1 w - - 0 1', 'g5f7', 'you')?.concept).toBe('smotheredMate');
  });

  it('a loose piece taken for free', () => {
    const n = conceptNote('4k3/8/8/3q4/8/8/8/3QK3 w - - 0 1', 'd1d5', 'you');
    expect(n).toEqual({ concept: 'loosePiece', text: 'That queen was a loose piece: nothing defended it.' });
  });

  it('says nothing when no detector fires', () => {
    expect(conceptNote('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', 'e2e4', 'you')).toBeUndefined();
  });
});

describe('conceptNote: trapped piece, capturing the defender, sacrifice', () => {
  it('traps a knight in the corner: attacked, nowhere safe to go', () => {
    // 1.a5 and the Bh1 attacks the Na8; b6 is covered by the pawn and c7 is its own pawn.
    const n = conceptNote('n3k3/2p5/8/8/P7/8/8/4K2B w - - 0 1', 'a4a5', 'you');
    expect(n).toEqual({ concept: 'trappedPiece', text: 'That traps my knight on a8: it is attacked and has no safe square to go to.' });
  });

  it('does not say a piece is trapped when it has a safe square', () => {
    expect(conceptNote('n3k3/8/8/8/P7/8/8/4K2B w - - 0 1', 'a4a5', 'you')?.concept).not.toBe('trappedPiece');
  });

  it('taking the only defender', () => {
    const n = conceptNote('6k1/3b4/4n3/8/8/8/8/3RR1K1 w - - 0 1', 'd1d7', 'you');
    expect(n).toEqual({ concept: 'capturingDefender', text: 'That takes the only defender of my knight on e6: it is now undefended.' });
  });

  it('not when the piece keeps another defender', () => {
    // The knight on e6 is also guarded by the pawn on f7.
    const n = conceptNote('6k1/3b1p2/4n3/8/8/8/8/3RR1K1 w - - 0 1', 'd1d7', 'you');
    expect(n?.concept).not.toBe('capturingDefender');
  });

  it('a sacrifice: the Greek gift Bxh7+ offers the bishop for a pawn', () => {
    const n = conceptNote('rnbq1rk1/pppn1ppp/4p3/3pP3/1b1P4/2NB1N2/PPP2PPP/R1BQK2R w KQ - 0 7', 'd3h7', 'you');
    expect(n).toEqual({
      concept: 'sacrifice',
      text: 'That offers material: your bishop on h7 can be taken, and it is worth more than the pawn it takes.',
    });
  });

  it('an even trade is not a sacrifice', () => {
    expect(conceptNote('4k3/8/2p5/3q4/8/8/8/3QK3 w - - 0 1', 'd1d5', 'you')?.concept).not.toBe('sacrifice');
  });
});
