// Reading games from PGN text (pasted, uploaded, or returned by the Chess.com
// and Lichess APIs). Pure functions over chess.js: no network, no storage.
// Only the main line is kept; comments, variations, clock tags and symbols in
// the file are read past and dropped (the engine, not the annotator, decides
// what is true here).
import { Chess } from 'chess.js';
import { resultOf, type Color } from './game';
import type { ImportedInfo, SavedGame } from './store';

export interface ParsedGame {
  headers: Record<string, string>;
  startFen: string;
  /** Main-line moves, UCI and SAN. */
  moves: { uci: string; san: string }[];
}

export class ImportError extends Error {}

/** Header values chess.js fills in when a tag is missing. */
const UNKNOWN = new Set(['?', '????.??.??', '']);
const tagOf = (h: Record<string, string>, name: string): string | undefined => {
  const v = h[name];
  return v === undefined || UNKNOWN.has(v) ? undefined : v;
};

/** Splits text holding several games (one file, one paste) into one string per game. */
export function splitPgn(text: string): string[] {
  const games: string[] = [];
  let current: string[] = [];
  let seenMoves = false;
  for (const line of text.replace(/^﻿/, '').split(/\r?\n/)) {
    const isTag = /^\s*\[\w+\s+".*"\s*\]\s*$/.test(line);
    // A tag line after movetext starts the next game.
    if (isTag && seenMoves) {
      games.push(current.join('\n'));
      current = [];
      seenMoves = false;
    }
    if (!isTag && line.trim()) seenMoves = true;
    current.push(line);
  }
  games.push(current.join('\n'));
  return games.map((g) => g.trim()).filter((g) => g.length > 0);
}

/** Reads one game. Throws `ImportError` with a sentence the player can read. */
export function parseGame(text: string): ParsedGame {
  const chess = new Chess();
  try {
    chess.loadPgn(text);
  } catch (e) {
    const bad = /Invalid move in PGN: (\S+)/.exec((e as Error).message)?.[1];
    throw new ImportError(
      bad ? `The move ${bad} is not legal at that point in the game.` : 'This is not a game this app can read.',
    );
  }
  const headers = chess.getHeaders();
  const variant = headers.Variant?.toLowerCase();
  if (variant && !['standard', 'chess', 'from position'].includes(variant)) {
    throw new ImportError(`Only standard chess is supported (this game is ${headers.Variant}).`);
  }
  const verbose = chess.history({ verbose: true });
  if (!verbose.length) throw new ImportError('This game has no moves.');
  const startFen = headers.SetUp === '1' && headers.FEN ? headers.FEN : new Chess().fen();
  return {
    headers,
    startFen,
    moves: verbose.map((m) => ({ uci: m.from + m.to + (m.promotion ?? ''), san: m.san })),
  };
}

export interface ParsedFile {
  games: ParsedGame[];
  /** One message per game that could not be read, with its number in the file. */
  errors: string[];
}

export function parsePgn(text: string): ParsedFile {
  const out: ParsedFile = { games: [], errors: [] };
  const parts = splitPgn(text);
  parts.forEach((part, i) => {
    try {
      out.games.push(parseGame(part));
    } catch (e) {
      const where = parts.length > 1 ? `Game ${i + 1}: ` : '';
      out.errors.push(`${where}${e instanceof ImportError ? e.message : 'This is not a game this app can read.'}`);
    }
  });
  return out;
}

/** Same names, case aside ("Anonymous", "?" and empty never match). */
export function sameName(a: string | undefined, b: string | undefined): boolean {
  return !!a && !!b && a !== '?' && a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * Which side the player was, from their usernames (one per service they use).
 * Undefined when no name matches; the caller asks.
 */
export function guessColor(g: ParsedGame, names: string[]): Color | undefined {
  const white = names.some((n) => sameName(g.headers.White, n));
  const black = names.some((n) => sameName(g.headers.Black, n));
  return white === black ? undefined : white ? 'white' : 'black';
}

/** The game's date as a timestamp (UTC, with the time when the PGN has it), or undefined. */
function gameTime(h: Record<string, string>): number | undefined {
  const date = tagOf(h, 'UTCDate') ?? tagOf(h, 'Date');
  const m = date && /^(\d{4})\.(\d\d)\.(\d\d)$/.exec(date);
  if (!m) return undefined;
  const time = (tagOf(h, 'UTCTime') ?? tagOf(h, 'StartTime') ?? '00:00:00').split(':').map(Number);
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), time[0] || 0, time[1] || 0, time[2] || 0);
  return Number.isNaN(t) ? undefined : t;
}

/** A short stable id, so importing the same game again is recognised (FNV-1a). */
function hash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

/** The id an imported game gets: the same game and side always give the same id. */
export function importedId(g: ParsedGame, color: Color): string {
  return `i${hash(`${g.startFen}|${g.moves.map((m) => m.uci).join(' ')}|${color}|${g.headers.White}|${g.headers.Black}|${g.headers.Date}`)}`;
}

function resultFor(g: ParsedGame, moves: string[]): SavedGame['result'] {
  const board = new Chess(g.startFen);
  for (const u of moves) board.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] });
  const ended = resultOf(board);
  if (ended.over) return { winner: ended.winner, reason: ended.reason };
  // Resignation, time or agreement: the file says who won, the board does not.
  const tag = g.headers.Result;
  const reason = tagOf(g.headers, 'Termination')?.toLowerCase() ?? 'as recorded in the game';
  if (tag === '1-0') return { winner: 'white', reason };
  if (tag === '0-1') return { winner: 'black', reason };
  if (tag === '1/2-1/2') return { winner: null, reason };
  return undefined;
}

/** The record of an imported game, before the coach has looked at it (no remarks or moments yet). */
export function toSavedGame(
  g: ParsedGame,
  color: Color,
  level: number,
  source: ImportedInfo['source'],
  site?: string,
  now = Date.now(),
): SavedGame {
  const h = g.headers;
  const moves = g.moves.map((m) => m.uci);
  const when = gameTime(h) ?? now;
  return {
    version: 1,
    id: importedId(g, color),
    startedAt: when,
    updatedAt: now,
    startFen: g.startFen,
    playerColor: color,
    level,
    mode: 'review',
    moves,
    remarks: [],
    sidelines: [],
    moments: [],
    hintsUsed: 0,
    result: resultFor(g, moves),
    imported: {
      source,
      white: tagOf(h, 'White') ?? 'White',
      black: tagOf(h, 'Black') ?? 'Black',
      date: tagOf(h, 'UTCDate') ?? tagOf(h, 'Date'),
      event: tagOf(h, 'Event'),
      site: site ?? tagOf(h, 'Site'),
      whiteElo: tagOf(h, 'WhiteElo'),
      blackElo: tagOf(h, 'BlackElo'),
      timeControl: tagOf(h, 'TimeControl'),
    },
  };
}

/** A line to show in a list: "vs Opponent · 1-0 · 12 Jan · 31 moves". */
export function describeGame(g: ParsedGame, color: Color | undefined): string {
  const h = g.headers;
  const white = tagOf(h, 'White') ?? 'White';
  const black = tagOf(h, 'Black') ?? 'Black';
  const names = color === 'white' ? `you (${white}) vs ${black}` : color === 'black' ? `${white} vs you (${black})` : `${white} vs ${black}`;
  const t = gameTime(h);
  const date = t ? new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : undefined;
  const result = h.Result && h.Result !== '*' ? h.Result : undefined;
  return [names, result, date, `${Math.ceil(g.moves.length / 2)} moves`].filter(Boolean).join(' · ');
}
