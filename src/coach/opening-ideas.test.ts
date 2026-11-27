import { Chess } from 'chess.js';
import { describe, expect, it } from 'vitest';
import { openingIdeas, type IdeaTag } from './opening-ideas';

/** The position after `sans` from the start, and the last move's from/to/captured. */
function after(sans: string[]): { fen: string; previous?: { to: any; captured: boolean } } {
  const c = new Chess();
  let last;
  for (const s of sans) last = c.move(s);
  return { fen: c.fen(), previous: last ? { to: last.to, captured: !!last.captured } : undefined };
}

/** Tags of the move `san` after `sans`. */
function ideas(sans: string[], san: string): IdeaTag[] {
  const { fen, previous } = after(sans);
  const m = new Chess(fen).move(san);
  return openingIdeas(fen, m.from + m.to + (m.promotion ?? ''), previous);
}
const kinds = (t: IdeaTag[]) => t.map((x) => x.k);
const tag = <K extends IdeaTag['k']>(t: IdeaTag[], k: K) => t.find((x) => x.k === k) as Extract<IdeaTag, { k: K }> | undefined;

describe('openingIdeas', () => {
  it('1.e4: takes the centre and opens lines for the bishop and queen', () => {
    const t = ideas([], 'e4');
    expect(tag(t, 'centre')?.squares).toEqual(['d5', 'e4']);
    expect(tag(t, 'opens-line')?.pieces.map((p) => p.piece).sort()).toEqual(['b', 'q']);
    expect(kinds(t)).not.toContain('develops');
  });

  it('Vienna 2.Nc3 develops and eyes d5 and e4', () => {
    const t = ideas(['e4', 'e5'], 'Nc3');
    expect(tag(t, 'develops')?.piece).toBe('n');
    expect(tag(t, 'centre')?.squares).toEqual(['d5', 'e4']);
    expect(kinds(t)).not.toContain('attacks');
  });

  it('Vienna Gambit 3.f4 offers the pawn and attacks e5', () => {
    const t = ideas(['e4', 'e5', 'Nc3', 'Nf6'], 'f4');
    expect(tag(t, 'offers')?.piece).toBe('p');
    expect(tag(t, 'attacks')?.targets).toEqual([{ square: 'e5', piece: 'p', defended: false }]);
    expect(tag(t, 'centre')?.squares).toEqual(['e5']);
  });

  it("Queen's Gambit 2.c4 offers a pawn and hits d5", () => {
    const t = ideas(['d4', 'd5'], 'c4');
    expect(tag(t, 'offers')?.piece).toBe('p');
    expect(tag(t, 'attacks')?.targets).toEqual([{ square: 'd5', piece: 'p', defended: true }]);
  });

  it('Italian 3.Bc4 develops, prepares castling and aims at f7', () => {
    const t = ideas(['e4', 'e5', 'Nf3', 'Nc6'], 'Bc4');
    expect(tag(t, 'develops')?.piece).toBe('b');
    expect(tag(t, 'prepares-castling')?.side).toBe('k');
    expect(tag(t, 'attacks')?.targets).toEqual([{ square: 'f7', piece: 'p', defended: true }]);
    expect(tag(t, 'centre')?.squares).toEqual(['d5']);
  });

  it('castling is tagged as castling only', () => {
    const t = ideas(['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5'], 'O-O');
    expect(kinds(t)).toEqual(['castles']);
    expect(tag(t, 'castles')?.side).toBe('k');
  });

  it('Scandinavian …Bg4 pins the knight to the queen', () => {
    const t = ideas(['e4', 'd5', 'exd5', 'Qxd5', 'Nc3', 'Qa5', 'd4', 'Nf6', 'Nf3'], 'Bg4');
    expect(tag(t, 'pins')).toMatchObject({ by: 'g4', front: { square: 'f3', piece: 'n' }, back: { square: 'd1', piece: 'q' } });
    expect(tag(t, 'develops')?.piece).toBe('b');
  });

  it('Scandinavian 2.exd5 captures; 2…Qxd5 takes back', () => {
    expect(tag(ideas(['e4', 'd5'], 'exd5'), 'captures')?.piece).toBe('p');
    const t = ideas(['e4', 'd5', 'exd5'], 'Qxd5');
    expect(tag(t, 'takes-back')?.piece).toBe('p');
    expect(kinds(t)).not.toContain('captures');
  });

  it("Scholar's 3.Bc4 threatens Qxf7 mate", () => {
    const t = ideas(['e4', 'e5', 'Qh5', 'Nc6'], 'Bc4');
    expect(tag(t, 'threatens-mate')?.san).toBe('Qxf7#');
    // 2.Qh5 itself threatens nothing that mates (the king takes on f7)
    expect(kinds(ideas(['e4', 'e5'], 'Qh5'))).not.toContain('threatens-mate');
  });

  it('a check is tagged', () => {
    expect(kinds(ideas(['e4', 'e5', 'Nf3', 'd6'], 'Bb5+'))).toContain('check');
  });

  it('Caro-Kann Advance 3.e5 gains space but is not development', () => {
    const t = ideas(['e4', 'c6', 'd4', 'd5'], 'e5');
    expect(kinds(t)).not.toContain('develops');
    expect(kinds(t)).not.toContain('offers'); // the pawn on e5 is protected by d4
    expect(tag(t, 'centre')?.squares).toEqual(['e5']);
  });
});
