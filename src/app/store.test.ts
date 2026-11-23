import { describe, expect, it } from 'vitest';
import { GameStore, MAX_GAMES, isSavedGame, newGameId, type SavedGame, type StorageLike } from './store';

class MemoryStorage implements StorageLike {
  data = new Map<string, string>();
  /** Writes of more than this many characters throw, like a full quota. */
  limit = Infinity;
  getItem(k: string) {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    if (v.length > this.limit) throw new DOMException('full', 'QuotaExceededError');
    this.data.set(k, v);
  }
  removeItem(k: string) {
    this.data.delete(k);
  }
}

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const game = (id: string, extra: Partial<SavedGame> = {}): SavedGame => ({
  version: 1,
  id,
  startedAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
  startFen: START,
  playerColor: 'white',
  level: 2,
  mode: 'lesson',
  moves: ['e2e4'],
  remarks: [],
  sidelines: [],
  moments: [],
  hintsUsed: 0,
  ...extra,
});

describe('GameStore', () => {
  it('saves and loads a game, newest first', () => {
    const store = new GameStore(new MemoryStorage());
    store.save(game('a'));
    store.save(game('b', { moves: ['d2d4', 'd7d5'] }));
    expect(store.ids()).toEqual(['b', 'a']);
    expect(store.get('b')?.moves).toEqual(['d2d4', 'd7d5']);
    store.save(game('a', { moves: ['e2e4', 'e7e5'] })); // an update moves it to the front
    expect(store.ids()).toEqual(['a', 'b']);
    expect(store.list().map((g) => g.id)).toEqual(['a', 'b']);
  });

  it('remembers the game in progress and forgets it when told', () => {
    const store = new GameStore(new MemoryStorage());
    store.save(game('a'));
    store.setCurrent('a');
    expect(store.current()?.id).toBe('a');
    store.setCurrent(undefined);
    expect(store.current()).toBeUndefined();
  });

  it('deleting a game also clears it as the current one', () => {
    const store = new GameStore(new MemoryStorage());
    store.save(game('a'));
    store.setCurrent('a');
    store.delete('a');
    expect(store.ids()).toEqual([]);
    expect(store.currentId()).toBeUndefined();
  });

  it('ignores damaged or foreign entries instead of throwing', () => {
    const mem = new MemoryStorage();
    const store = new GameStore(mem);
    store.save(game('a'));
    mem.data.set('sideline.game.a', '{not json');
    expect(store.get('a')).toBeUndefined();
    mem.data.set('sideline.game.b', JSON.stringify({ version: 2, id: 'b' }));
    expect(store.get('b')).toBeUndefined();
    mem.data.set('sideline.index', '"not a list"');
    expect(store.ids()).toEqual([]);
    expect(isSavedGame(game('x'))).toBe(true);
    expect(isSavedGame({ ...game('x'), moves: 'e2e4' })).toBe(false);
  });

  it('works without any storage (private window, blocked site data)', () => {
    const store = new GameStore(undefined);
    expect(store.save(game('a'))).toBe(false);
    expect(store.list()).toEqual([]);
    expect(store.current()).toBeUndefined();
  });

  it('keeps at most MAX_GAMES, dropping the oldest but never the game in progress', () => {
    const store = new GameStore(new MemoryStorage());
    store.save(game('first'));
    store.setCurrent('first');
    for (let i = 0; i < MAX_GAMES + 5; i++) store.save(game(`g${i}`));
    const ids = store.ids();
    expect(ids).toHaveLength(MAX_GAMES);
    expect(ids).toContain('first');
    expect(ids).toContain(`g${MAX_GAMES + 4}`);
    expect(ids).not.toContain('g0');
  });

  it('when storage is full it drops the oldest game and saves the new one', () => {
    const mem = new MemoryStorage();
    const store = new GameStore(mem);
    store.save(game('old'));
    store.save(game('mid'));
    mem.limit = JSON.stringify(game('new')).length + 10;
    // Make the write fail once: a bigger record than the limit is refused until space is "freed".
    const big = game('new', { moves: ['e2e4'] });
    let first = true;
    const realSet = mem.setItem.bind(mem);
    mem.setItem = (k, v) => {
      if (k === 'sideline.game.new' && first) {
        first = false;
        throw new DOMException('full', 'QuotaExceededError');
      }
      realSet(k, v);
    };
    expect(store.save(big)).toBe(true);
    expect(store.ids()).toEqual(['new', 'mid']); // the oldest was dropped
  });

  it('backs up and restores, skipping games it already has', () => {
    const a = new GameStore(new MemoryStorage());
    a.save(game('a'));
    a.save(game('b'));
    const backup = JSON.parse(JSON.stringify(a.exportAll()));
    const b = new GameStore(new MemoryStorage());
    b.save(game('b'));
    expect(b.importAll(backup)).toEqual({ added: 1, skipped: 1 });
    expect(b.ids().sort()).toEqual(['a', 'b']);
    expect(b.importAll({ app: 'other' })).toBeUndefined();
    expect(b.importAll({ app: 'sideline', version: 1, games: [{ nonsense: true }] })).toEqual({ added: 0, skipped: 1 });
  });

  it('makes distinct ids', () => {
    expect(newGameId(1)).not.toBe(newGameId(2));
  });
});
