// Saved games, on this device only (localStorage; no server, no accounts).
// One record per game, a pointer to the game in progress, and a backup file
// format. Every storage call is wrapped: private windows and full or blocked
// storage must never break the game, they just mean nothing is saved.
import type { Moment, Remark } from '../coach/coach';
import type { ModeId } from './modes';

export interface SavedMoment extends Moment {
  /** Moves played when the coach said it. */
  ply: number;
  text: string;
  /** What the player chose after a mistake: take it back or play on (Lesson only). */
  outcome?: 'taken-back' | 'played-on';
  /** The player asked the coach to show the answer in a sideline. */
  showedMe?: boolean;
}

/** A sideline the player tried, rooted at the position after `ply` moves of the game. */
export interface SavedSideline {
  ply: number;
  rootFen: string;
  moves: { uci: string; san: string; mine: boolean }[];
}

export interface SavedGame {
  version: 1;
  id: string;
  startedAt: number;
  updatedAt: number;
  /** The position the game started from (the normal start unless set by `?fen=`). */
  startFen: string;
  playerColor: 'white' | 'black';
  level: number;
  mode: ModeId;
  /** The game's moves, UCI. */
  moves: string[];
  remarks: { ply: number; remark: Remark }[];
  sidelines: SavedSideline[];
  moments: SavedMoment[];
  hintsUsed: number;
  result?: { winner: 'white' | 'black' | null; reason: string };
}

export interface BackupFile {
  app: 'sideline';
  version: 1;
  exportedAt: number;
  games: SavedGame[];
}

/** The part of localStorage used here (tests pass a Map-backed one). */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const INDEX_KEY = 'sideline.index';
const CURRENT_KEY = 'sideline.current';
const gameKey = (id: string) => `sideline.game.${id}`;
/** Oldest games beyond this many are dropped (the game in progress is never dropped). */
export const MAX_GAMES = 100;

export function newGameId(now = Date.now()): string {
  return `${now.toString(36)}${Math.floor(Math.random() * 1296).toString(36).padStart(2, '0')}`;
}

/** A record that has the shape this version reads; anything else is ignored. */
export function isSavedGame(x: unknown): x is SavedGame {
  const g = x as Partial<SavedGame> | null;
  return (
    !!g &&
    g.version === 1 &&
    typeof g.id === 'string' &&
    typeof g.startFen === 'string' &&
    (g.playerColor === 'white' || g.playerColor === 'black') &&
    typeof g.level === 'number' &&
    Array.isArray(g.moves) &&
    Array.isArray(g.remarks) &&
    Array.isArray(g.sidelines) &&
    Array.isArray(g.moments)
  );
}

export class GameStore {
  constructor(private storage: StorageLike | undefined = browserStorage()) {}

  private read<T>(key: string): T | undefined {
    try {
      const raw = this.storage?.getItem(key);
      return raw ? (JSON.parse(raw) as T) : undefined;
    } catch {
      return undefined; // blocked storage or a damaged entry
    }
  }

  private write(key: string, value: unknown): boolean {
    try {
      this.storage?.setItem(key, JSON.stringify(value));
      return !!this.storage;
    } catch {
      return false; // full or blocked
    }
  }

  /** Ids of the saved games, newest first. */
  ids(): string[] {
    const ids = this.read<unknown>(INDEX_KEY);
    return Array.isArray(ids) ? ids.filter((i): i is string => typeof i === 'string') : [];
  }

  get(id: string): SavedGame | undefined {
    const g = this.read<unknown>(gameKey(id));
    return isSavedGame(g) ? g : undefined;
  }

  /** All saved games, newest first. */
  list(): SavedGame[] {
    return this.ids()
      .map((id) => this.get(id))
      .filter((g): g is SavedGame => !!g);
  }

  /** Saves (or updates) a game and moves it to the front of the list. Returns false if nothing could be saved. */
  save(game: SavedGame): boolean {
    game.updatedAt = Date.now();
    let ok = this.write(gameKey(game.id), game);
    if (!ok) {
      // Storage full: drop the oldest game that is not this one, once, and try again.
      const victim = this.ids().filter((i) => i !== game.id).at(-1);
      if (victim) {
        this.delete(victim);
        ok = this.write(gameKey(game.id), game);
      }
    }
    if (!ok) return false;
    const ids = [game.id, ...this.ids().filter((i) => i !== game.id)];
    const current = this.currentId();
    while (ids.length > MAX_GAMES) {
      const victim = ids.findLast((i) => i !== current && i !== game.id);
      if (!victim) break;
      ids.splice(ids.indexOf(victim), 1);
      this.remove(gameKey(victim));
    }
    return this.write(INDEX_KEY, ids);
  }

  private remove(key: string): void {
    try {
      this.storage?.removeItem(key);
    } catch {
      /* nothing to do */
    }
  }

  delete(id: string): void {
    this.remove(gameKey(id));
    this.write(INDEX_KEY, this.ids().filter((i) => i !== id));
    if (this.currentId() === id) this.setCurrent(undefined);
  }

  currentId(): string | undefined {
    const id = this.read<unknown>(CURRENT_KEY);
    return typeof id === 'string' ? id : undefined;
  }

  /** The game in progress, if one was left unfinished. */
  current(): SavedGame | undefined {
    const id = this.currentId();
    return id ? this.get(id) : undefined;
  }

  /** Marks the game in progress, or clears it (the game ended). */
  setCurrent(id: string | undefined): void {
    if (id) this.write(CURRENT_KEY, id);
    else this.remove(CURRENT_KEY);
  }

  exportAll(): BackupFile {
    return { app: 'sideline', version: 1, exportedAt: Date.now(), games: this.list() };
  }

  /** Adds the games of a backup that are not already here. Returns how many were added and skipped. */
  importAll(data: unknown): { added: number; skipped: number } | undefined {
    const b = data as Partial<BackupFile> | null;
    if (!b || b.app !== 'sideline' || b.version !== 1 || !Array.isArray(b.games)) return undefined;
    const have = new Set(this.ids());
    let added = 0;
    let skipped = 0;
    // Oldest first, so the newest ends up first in the list.
    for (const g of [...b.games].reverse()) {
      if (!isSavedGame(g) || have.has(g.id)) {
        skipped++;
        continue;
      }
      const keepStamp = g.updatedAt;
      if (this.save(g)) {
        g.updatedAt = keepStamp;
        added++;
        have.add(g.id);
      } else skipped++;
    }
    return { added, skipped };
  }
}

function browserStorage(): StorageLike | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined; // access can throw when site data is blocked
  }
}
