import { Chess } from 'chess.js';
import { describe, expect, it } from 'vitest';
import { gameToPgn } from './pgn';
import type { SavedGame } from './store';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const base: SavedGame = {
  version: 1,
  id: 'a',
  startedAt: new Date(2026, 10, 24).getTime(),
  updatedAt: 0,
  startFen: START,
  playerColor: 'white',
  level: 2,
  mode: 'lesson',
  moves: ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1c4', 'g8f6'],
  remarks: [],
  sidelines: [],
  moments: [],
  hintsUsed: 0,
};
const afterFour = 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3';

describe('gameToPgn', () => {
  it('writes headers and numbered moves', () => {
    const pgn = gameToPgn(base);
    expect(pgn).toContain('[White "You"]');
    expect(pgn).toContain('[Black "Coach (level 2)"]');
    expect(pgn).toContain('[Date "2026.11.24"]');
    expect(pgn).toContain('[Result "*"]');
    expect(pgn).not.toContain('[FEN');
    expect(pgn.trim().endsWith('1. e4 e5 2. Nf3 Nc6 3. Bc4 Nf6 *')).toBe(true);
  });

  it('puts the coach\'s remarks in as comments and repeats Black\'s move number after one', () => {
    const pgn = gameToPgn({ ...base, remarks: [{ ply: 1, remark: { kind: 'narration', text: 'I take {the} centre.', mood: 'neutral' } }] });
    expect(pgn).toContain('1. e4 {I take the centre.} 1... e5 2. Nf3');
  });

  it('writes a sideline as a variation to the game move that followed its position', () => {
    const g: SavedGame = {
      ...base,
      sidelines: [{ ply: 4, rootFen: afterFour, moves: [{ uci: 'f1b5', san: 'Bb5', mine: true }, { uci: 'a7a6', san: 'a6', mine: false }] }],
    };
    expect(gameToPgn(g).trim().endsWith('3. Bc4 (3. Bb5 a6) 3... Nf6 *')).toBe(true);
  });

  it('keeps a sideline from the end of the game, or off the game line, as a comment', () => {
    const end = new Chess();
    for (const u of base.moves) end.move({ from: u.slice(0, 2), to: u.slice(2, 4) });
    const g: SavedGame = {
      ...base,
      sidelines: [
        { ply: 6, rootFen: end.fen(), moves: [{ uci: 'd2d3', san: 'd3', mine: true }] },
        { ply: 4, rootFen: START, moves: [{ uci: 'd2d4', san: 'd4', mine: true }] }, // not the game's position at ply 4
      ],
    };
    const pgn = gameToPgn(g);
    expect(pgn).toContain('{Sideline tried here: 4. d3}');
    expect(pgn).toContain('{Sideline tried here: 1. d4}');
    expect(pgn).not.toContain('(1. d4');
  });

  it('writes the result and a FEN header for a game from a position', () => {
    const fen = 'r3kb1r/ppp2ppp/8/3N4/8/8/PPP2PPP/R3KB1R w KQkq - 0 1';
    const g: SavedGame = { ...base, startFen: fen, moves: ['d5c7', 'e8d7'], result: { winner: 'white', reason: 'checkmate' } };
    const pgn = gameToPgn(g);
    expect(pgn).toContain(`[FEN "${fen}"]`);
    expect(pgn).toContain('[SetUp "1"]');
    expect(pgn).toContain('[Result "1-0"]');
    expect(pgn.trim().endsWith('1. Nxc7+ Kd7 1-0')).toBe(true);
  });

  it('numbers from a Black start correctly', () => {
    const fen = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1';
    const pgn = gameToPgn({ ...base, startFen: fen, moves: ['e7e5', 'g1f3'] });
    expect(pgn.trim().endsWith('1... e5 2. Nf3 *')).toBe(true);
  });

  it('produces PGN that chess.js reads back to the same moves, with comments and variations', () => {
    const g: SavedGame = {
      ...base,
      remarks: [{ ply: 3, remark: { kind: 'narration', text: 'I develop a knight.', mood: 'neutral' } }],
      sidelines: [{ ply: 4, rootFen: afterFour, moves: [{ uci: 'f1b5', san: 'Bb5', mine: true }] }],
      result: { winner: null, reason: 'draw' },
    };
    const back = new Chess();
    back.loadPgn(gameToPgn(g));
    expect(back.history()).toEqual(['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Nf6']);
  });
});
