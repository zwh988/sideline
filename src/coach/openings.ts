// Known openings and gambits: the Lichess opening names (CC0, built into
// `openings-data.json` by `scripts/build-openings.mjs`), looked up by position
// so a transposition finds the same name. Nothing is fetched at runtime; the
// data file is loaded the first time it is needed (a separate chunk).
import { Chess } from 'chess.js';

export interface Opening {
  eco: string;
  name: string;
}

type Data = Record<string, [string, string]>;

/** Board, side to move, castling and en passant of a FEN. */
const epdOf = (fen: string) => fen.split(' ').slice(0, 4).join(' ');

/** The same key function as in scripts/build-openings.mjs. */
function keyOf(epd: string): string {
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ 0xdeadbeef;
  for (let i = 0; i < epd.length; i++) {
    a = Math.imul(a ^ epd.charCodeAt(i), 0x01000193) >>> 0;
    b = Math.imul(b ^ epd.charCodeAt(i), 0x85ebca6b) >>> 0;
  }
  return `${a.toString(36)}.${b.toString(36)}`;
}

/**
 * The gambit a name belongs to, or undefined: "Italian Game: Evans Gambit" and
 * "Italian Game: Evans Gambit, Compromised Defense" are the Evans Gambit.
 * "Queen's Gambit Declined" counts as a Gambit name too (the caller checks
 * that the move really offers material).
 */
export function gambitOf(name: string): string | undefined {
  for (const part of name.split(': ')) {
    const m = /^(.*?Gambit(?: (?:Accepted|Declined|Refused))?)(?:,| |$)/.exec(part);
    if (m) return m[1];
  }
  return undefined;
}

export class OpeningBook {
  constructor(private data: Data) {}

  get size(): number {
    return Object.keys(this.data).length;
  }

  /** The named opening of exactly this position (not of a later or earlier one). */
  lookup(fen: string): Opening | undefined {
    const hit = this.data[keyOf(epdOf(fen))];
    return hit ? { eco: hit[0], name: hit[1] } : undefined;
  }

  /** True when the position is a named line of theory. */
  has(fen: string): boolean {
    return !!this.lookup(fen);
  }

  /**
   * The opening a game reached: the last named position along its moves
   * (`ply` = moves played there). Undefined for a game from a set-up position
   * or one that leaves theory at once.
   */
  openingOf(startFen: string, moves: string[]): (Opening & { ply: number }) | undefined {
    if (epdOf(startFen) !== epdOf(new Chess().fen())) return undefined; // only games from the normal start
    const chess = new Chess(startFen);
    let found: (Opening & { ply: number }) | undefined;
    for (let i = 0; i < moves.length; i++) {
      try {
        chess.move({ from: moves[i].slice(0, 2), to: moves[i].slice(2, 4), promotion: moves[i][4] });
      } catch {
        break;
      }
      const o = this.lookup(chess.fen());
      if (o) found = { ...o, ply: i + 1 };
    }
    return found;
  }

  /**
   * The gambit this move enters, if the position after it is a gambit line and
   * the position before it was not already that gambit.
   */
  gambitEntered(fenBefore: string, fenAfter: string): { gambit: string; opening: Opening } | undefined {
    const after = this.lookup(fenAfter);
    const gambit = after && gambitOf(after.name);
    if (!after || !gambit) return undefined;
    const before = this.lookup(fenBefore);
    if (before && gambitOf(before.name) === gambit) return undefined;
    return { gambit, opening: after };
  }
}

let loading: Promise<OpeningBook> | undefined;
let loaded: OpeningBook | undefined;

/** Loads the opening names (once). */
export function loadOpeningBook(): Promise<OpeningBook> {
  loading ??= import('./openings-data.json').then((m) => (loaded = new OpeningBook(m.default as unknown as Data)));
  return loading;
}

/** The book if it has been loaded already (for code that cannot wait). */
export const openingBookIfLoaded = (): OpeningBook | undefined => loaded;
