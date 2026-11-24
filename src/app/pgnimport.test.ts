import { Chess } from 'chess.js';
import { describe, expect, it } from 'vitest';
import {
  BAD_MOVE_PGN,
  CHESSCOM_PGN,
  FORK_FEN,
  FORK_PGN,
  LICHESS_PGN,
  OPERA_ANNOTATED,
} from './import-fixtures';
import { gameToPgn } from './pgn';
import { GameStore, type StorageLike } from './store';
import { guessColor, importedId, parseGame, parsePgn, splitPgn, toSavedGame, ImportError } from './pgnimport';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

describe('reading a PGN', () => {
  it('keeps the main line of an annotated game and drops comments, clocks, NAGs and variations', () => {
    const g = parseGame(OPERA_ANNOTATED);
    expect(g.moves).toHaveLength(33);
    expect(g.moves.slice(0, 6).map((m) => m.san)).toEqual(['e4', 'e5', 'Nf3', 'd6', 'd4', 'Bg4']);
    // 4.dxe5 follows the main line, not the variation 3...exd4
    expect(g.moves[6].san).toBe('dxe5');
    expect(g.moves.at(-1)?.san).toBe('Rd8#');
    expect(g.startFen).toBe(START);
    expect(g.headers.White).toBe('Paul Morphy');
  });

  it('starts from the FEN of a game set up from a position', () => {
    const g = parseGame(FORK_PGN);
    expect(g.startFen).toBe(FORK_FEN);
    expect(g.moves.map((m) => m.uci)).toEqual(['d5c7', 'e8d7', 'c7a8']);
  });

  it('reads promotions as UCI with the piece', () => {
    const g = parseGame('[SetUp "1"]\n[FEN "8/P6k/8/8/8/8/8/K7 w - - 0 1"]\n\n1. a8=Q *');
    expect(g.moves[0].uci).toBe('a7a8q');
  });

  it('reads Chess.com and Lichess games as the APIs return them', () => {
    const c = parseGame(CHESSCOM_PGN);
    expect(c.moves.map((m) => m.san)).toEqual(['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Nf6']);
    const l = parseGame(LICHESS_PGN);
    expect(l.moves).toHaveLength(6);
  });

  it('says plainly why a game cannot be read', () => {
    expect(() => parseGame('1. e4 e5 2. Ke4 *')).toThrow(ImportError);
    expect(() => parseGame('1. e4 e5 2. Ke4 *')).toThrow('The move Ke4 is not legal');
    expect(() => parseGame('[Event "x"]\n\n*')).toThrow('no moves');
    expect(() => parseGame('[Variant "Atomic"]\n\n1. e4 e5 *')).toThrow('Only standard chess');
    expect(() => parseGame('hello there')).toThrow(ImportError);
  });

  it('splits a file with several games and reports the unreadable ones', () => {
    const file = `${OPERA_ANNOTATED}\n\n${BAD_MOVE_PGN}\n\n[Event "Broken"]\n\n1. e4 e5 2. Ke4 *\n\n${FORK_PGN}`;
    expect(splitPgn(file)).toHaveLength(4);
    const { games, errors } = parsePgn(file);
    expect(games).toHaveLength(3);
    expect(errors).toEqual(['Game 3: The move Ke4 is not legal at that point in the game.']);
  });

  it('copes with Windows line endings and a byte-order mark', () => {
    const text = `﻿${BAD_MOVE_PGN.replace(/\n/g, '\r\n')}`;
    expect(parsePgn(text).games[0].moves).toHaveLength(12);
  });
});

describe('which side the player was', () => {
  const g = parseGame(BAD_MOVE_PGN);
  it('matches usernames, ignoring case', () => {
    expect(guessColor(g, ['Wei'])).toBe('white');
    expect(guessColor(g, ['other', 'RIVAL'])).toBe('black');
  });
  it('does not guess when no name matches or both do', () => {
    expect(guessColor(g, ['nobody'])).toBeUndefined();
    expect(guessColor(g, ['wei', 'rival'])).toBeUndefined();
    expect(guessColor(g, [])).toBeUndefined();
  });
});

describe('the saved record of an imported game', () => {
  it('has the moves, the side, the result and where it came from', () => {
    const g = parseGame(BAD_MOVE_PGN);
    const saved = toSavedGame(g, 'white', 2, 'lichess', 'https://lichess.org/AbCdEfGh', 1_800_000_000_000);
    expect(saved.mode).toBe('review');
    expect(saved.playerColor).toBe('white');
    expect(saved.moves).toHaveLength(12);
    expect(saved.result).toEqual({ winner: 'black', reason: 'normal' });
    expect(saved.imported).toMatchObject({ source: 'lichess', white: 'wei', black: 'rival', whiteElo: '800', site: 'https://lichess.org/AbCdEfGh' });
    expect(new Date(saved.startedAt).getUTCFullYear()).toBe(2026);
    expect(saved.moments).toEqual([]);
  });

  it('records a mate as a mate and an unfinished game as unfinished', () => {
    expect(toSavedGame(parseGame(OPERA_ANNOTATED), 'white', 2, 'pgn').result).toEqual({ winner: 'white', reason: 'checkmate' });
    expect(toSavedGame(parseGame(FORK_PGN), 'white', 2, 'pgn').result).toBeUndefined();
  });

  it('gives the same game and side the same id, and the other side another', () => {
    const g = parseGame(BAD_MOVE_PGN);
    expect(importedId(g, 'white')).toBe(importedId(parseGame(BAD_MOVE_PGN), 'white'));
    expect(importedId(g, 'white')).not.toBe(importedId(g, 'black'));
    expect(importedId(g, 'white')).not.toBe(importedId(parseGame(LICHESS_PGN), 'white'));
  });

  it('exports with the original names and details, and chess.js reads the export back to the same moves', () => {
    for (const [pgn, color] of [[OPERA_ANNOTATED, 'white'], [FORK_PGN, 'white'], [BAD_MOVE_PGN, 'white']] as const) {
      const g = parseGame(pgn);
      const out = gameToPgn(toSavedGame(g, color, 2, 'pgn'));
      const back = new Chess();
      back.loadPgn(out);
      expect(back.history()).toEqual(g.moves.map((m) => m.san));
    }
    const out = gameToPgn(toSavedGame(parseGame(BAD_MOVE_PGN), 'white', 2, 'lichess', 'https://lichess.org/AbCdEfGh'));
    expect(out).toContain('[White "wei"]');
    expect(out).toContain('[Black "rival"]');
    expect(out).toContain('[Site "https://lichess.org/AbCdEfGh"]');
    expect(out).toContain('[WhiteElo "800"]');
    expect(out).toContain('[Result "0-1"]');
  });
});

class MemoryStorage implements StorageLike {
  data = new Map<string, string>();
  getItem(k: string) {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.data.set(k, v);
  }
  removeItem(k: string) {
    this.data.delete(k);
  }
}

describe('imported games in the store', () => {
  it('are listed with live games, keep their details through a backup, and are recognised when imported again', () => {
    const store = new GameStore(new MemoryStorage());
    const game = toSavedGame(parseGame(BAD_MOVE_PGN), 'white', 2, 'lichess');
    game.moments = [{ kind: 'mistake', fen: 'x', played: 'f1c4', ply: 9, text: 'Careful' }];
    expect(store.save(game)).toBe(true);
    expect(store.ids()).toContain(importedId(parseGame(BAD_MOVE_PGN), 'white'));
    const other = new GameStore(new MemoryStorage());
    expect(other.importAll(JSON.parse(JSON.stringify(store.exportAll())))).toEqual({ added: 1, skipped: 0 });
    expect(other.list()[0].imported?.white).toBe('wei');
    expect(other.list()[0].moments).toHaveLength(1);
    expect(other.importAll(JSON.parse(JSON.stringify(store.exportAll())))).toEqual({ added: 0, skipped: 1 });
  });
});
