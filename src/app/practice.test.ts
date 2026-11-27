import { describe, expect, it } from 'vitest';
import { DAY_MS, INTERVAL_DAYS, PracticeDeck, dueOrder, newCard, review } from './practice';
import type { StorageLike } from './store';

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

const T0 = 1_800_000_000_000;
const day = (n: number) => T0 + n * DAY_MS;

describe('practice scheduler', () => {
  it('a new card is due a day after it was added', () => {
    const c = newCard('a', T0);
    expect(c.step).toBe(0);
    expect(c.due).toBe(day(1));
  });

  it('hits on due cards move out 1, 3, 7, 14, then 30 days and stay at 30', () => {
    let c = newCard('a', T0);
    let now = c.due;
    const gaps: number[] = [];
    for (let i = 0; i < 6; i++) {
      c = review(c, true, now);
      gaps.push((c.due - now) / DAY_MS);
      now = c.due;
    }
    expect(gaps).toEqual([3, 7, 14, 30, 30, 30]);
    expect(INTERVAL_DAYS).toEqual([1, 3, 7, 14, 30]);
    expect(c.hits).toBe(6);
  });

  it('a miss resets the card to step 0, due again in a day', () => {
    let c = newCard('a', T0);
    for (let i = 0; i < 3; i++) c = review(c, true, c.due);
    expect(c.step).toBe(3);
    const now = c.due + 5 * DAY_MS;
    c = review(c, false, now);
    expect(c.step).toBe(0);
    expect(c.due).toBe(now + DAY_MS);
    expect(c.misses).toBe(1);
    // and climbs again from the start
    c = review(c, true, c.due);
    expect(c.due - c.last!).toBe(3 * DAY_MS);
  });

  it('a hit before the card is due changes nothing; a miss before it still resets', () => {
    let c = newCard('a', T0);
    c = review(c, true, c.due); // step 1, due in 3 days
    const early = review(c, true, c.last! + DAY_MS);
    expect(early.step).toBe(1);
    expect(early.due).toBe(c.due);
    const missed = review(c, false, c.last! + DAY_MS);
    expect(missed.step).toBe(0);
    expect(missed.due).toBe(c.last! + 2 * DAY_MS);
  });

  it('due order: only due cards, most overdue first, then the shorter interval', () => {
    const a = { ...newCard('a', T0), due: day(3) };
    const b = { ...newCard('b', T0), due: day(1), step: 2 };
    const c = { ...newCard('c', T0), due: day(1), step: 0 };
    const notYet = { ...newCard('d', T0), due: day(9) };
    expect(dueOrder([a, b, c, notYet], day(4)).map((x) => x.id)).toEqual(['c', 'b', 'a']);
    expect(dueOrder([a, b, c, notYet], day(2)).map((x) => x.id)).toEqual(['c', 'b']);
  });

  it('the deck keeps cards on the device, adds once, and records reviews', () => {
    const storage = new MemoryStorage();
    const deck = new PracticeDeck(storage);
    deck.add('x', T0);
    deck.add('x', day(5)); // already there: kept as it was
    expect(deck.get('x')!.due).toBe(day(1));
    expect(deck.isDue('x', day(1))).toBe(true);
    deck.record('x', true, day(1));
    deck.record('y', false, day(2)); // a card reviewed before it was added
    const again = new PracticeDeck(storage);
    expect(again.get('x')!.step).toBe(1);
    expect(again.get('y')!.misses).toBe(1);
    expect(again.due(undefined, day(3)).map((c) => c.id)).toEqual(['y']);
    expect(again.due(['x'], day(3))).toEqual([]);
  });

  it('a damaged store starts empty; a backup merges with the later review winning', () => {
    const storage = new MemoryStorage();
    storage.setItem('sideline.practice', '{not json');
    const deck = new PracticeDeck(storage);
    expect(deck.all()).toEqual([]);
    deck.record('x', true, day(1));
    const other = new PracticeDeck(new MemoryStorage());
    other.record('x', false, day(4));
    other.record('z', true, day(2));
    expect(deck.importAll([...other.all(), { id: 'bad' }])).toBe(2);
    expect(deck.get('x')!.misses).toBe(1);
    // an older copy does not overwrite a newer one
    const old = new PracticeDeck(new MemoryStorage());
    old.record('x', true, day(0));
    expect(deck.importAll(old.all())).toBe(0);
    expect(deck.importAll('nope')).toBe(0);
  });
});
