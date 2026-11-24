import { Chess } from 'chess.js';
import { describe, expect, it } from 'vitest';
import data from './openings-data.json';
import { gambitOf, OpeningBook } from './openings';

const book = new OpeningBook(data as never);

/** The FEN after the moves (SAN, space separated) from the start. */
function after(moves: string): string {
  const c = new Chess();
  for (const m of moves.split(' ')) c.move(m);
  return c.fen();
}

describe('opening names by position', () => {
  it('loads the whole list', () => {
    expect(book.size).toBeGreaterThan(3000);
  });

  it('names a line of theory', () => {
    expect(book.lookup(after('e4 e5 Nf3 Nc6 Bc4'))?.name).toBe('Italian Game');
    expect(book.lookup(after('d4 d5 c4'))?.name).toBe("Queen's Gambit");
    expect(book.lookup(after('e4 e5 Nf3 Nc6 Bc4 Bc5 b4'))?.name).toBe('Italian Game: Evans Gambit');
  });

  it('finds the same opening after a transposition', () => {
    // 1.e4 e5 2.Nf3 Nc6 3.Bb5 and 1.Nf3 Nc6 2.e4 e5 3.Bb5 reach the same Ruy Lopez position.
    const a = book.lookup(after('e4 e5 Nf3 Nc6 Bb5'));
    const b = book.lookup(after('Nf3 Nc6 e4 e5 Bb5'));
    expect(a?.name).toBe('Ruy Lopez');
    expect(b).toEqual(a);
  });

  it('knows nothing of a position outside theory', () => {
    expect(book.lookup(after('a4 h5 Ra3 Rh6 Rb3'))).toBeUndefined();
    expect(book.has(after('e4 e5 Nf3 Nc6 Bc4 Nf6 Ng5 d5 exd5 Na5 Bb5+ c6 dxc6 bxc6 Be2 h6 Nf3 e4 Ne5 Bd6 d4 exd3'))).toBe(false);
  });

  it('reaches the deepest named position of a game', () => {
    const moves = 'e2e4 e7e5 g1f3 b8c6 f1c4 f8c5 b2b4 c5b4 c2c3 b4a5 a2a3 h7h6'.split(' ');
    const o = book.openingOf(new Chess().fen(), moves);
    expect(o?.name).toContain('Evans Gambit');
    expect(o!.ply).toBeLessThan(moves.length);
    // 1.a4 is the Ware Opening; after 1...h5 the game is out of theory, so the last named position is ply 1.
    expect(book.openingOf(new Chess().fen(), ['a2a4', 'h7h5'])).toMatchObject({ name: 'Ware Opening', ply: 1 });
    // A game from a set-up position is not matched against openings by accident.
    expect(book.openingOf('4k3/8/8/8/8/8/4P3/4K3 w - - 0 1', ['e2e4'])).toBeUndefined();
  });
});

describe('gambits', () => {
  it('takes the gambit out of a name', () => {
    expect(gambitOf('Italian Game: Evans Gambit')).toBe('Evans Gambit');
    expect(gambitOf('Italian Game: Evans Gambit, Compromised Defense')).toBe('Evans Gambit');
    expect(gambitOf("Queen's Gambit Declined: Slav Defense")).toBe("Queen's Gambit Declined");
    expect(gambitOf('Sicilian Defense: Smith-Morra Gambit')).toBe('Smith-Morra Gambit');
    expect(gambitOf('Italian Game')).toBeUndefined();
    expect(gambitOf('Ruy Lopez: Berlin Defense')).toBeUndefined();
  });

  it('sees the move that enters a gambit, once', () => {
    const entered = book.gambitEntered(after('d4 d5'), after('d4 d5 c4'));
    expect(entered?.gambit).toBe("Queen's Gambit");
    // The next move of the same gambit does not enter it again.
    expect(book.gambitEntered(after('d4 d5 c4'), after('d4 d5 c4 e6'))?.gambit).not.toBe("Queen's Gambit");
    expect(book.gambitEntered(after('e4 e5 Nf3 Nc6 Bc4 Bc5'), after('e4 e5 Nf3 Nc6 Bc4 Bc5 b4'))?.gambit).toBe('Evans Gambit');
    expect(book.gambitEntered(after('e4'), after('e4 e5'))).toBeUndefined();
  });

  it('enters a gambit as Black too (the Englund)', () => {
    const e = book.gambitEntered(after('d4'), after('d4 e5'));
    expect(e?.gambit).toBe('Englund Gambit');
  });
});
