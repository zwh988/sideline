import { describe, expect, it } from 'vitest';
import { richSegments } from './richtext';

const picked = (t: string, kind: 'move' | 'key') => richSegments(t).filter((s) => s.kind === kind).map((s) => s.text);

describe("the coach's words, formatted", () => {
  it('never changes the text', () => {
    const t = "You played 5.Bc4. The engine preferred e4, about 4.0 pawns better for you. I can't name a reason I can check.";
    expect(richSegments(t).map((s) => s.text).join('')).toBe(t);
  });

  it('finds moves with their numbers, captures, checks, castling, promotion and squares', () => {
    expect(picked('Here you played 14.Bc4, then 11…Nbd7 and Nxe5+.', 'move')).toEqual(['14.Bc4', '11…Nbd7', 'Nxe5+']);
    expect(picked('O-O-O is fine, O-O too; e8=Q# ends it; dxe5 wins.', 'move')).toEqual(['O-O-O', 'O-O', 'e8=Q#', 'dxe5']);
    expect(picked('Your pawn on e4 is attacked.', 'move')).toEqual(['e4']);
  });

  it('leaves ordinary words alone', () => {
    expect(picked('A bishop and a knight. Coach 2, Tier 3. Be careful: A1 is not a move.', 'move')).toEqual([]);
  });

  it('bolds the concepts and amounts', () => {
    expect(picked("That's a fork: the knight attacks both. Mate in 2 was there; the pinned rook is trapped.", 'key')).toEqual(['fork', 'Mate in 2', 'pinned', 'trapped']);
    expect(picked('about 3.2 pawns better, and 1 pawn more', 'key')).toEqual(['about 3.2 pawns', '1 pawn']);
  });
});
