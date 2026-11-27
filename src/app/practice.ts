// The practice scheduler (task 6.3; Puzzles' task 3.3 reuses it): cards,
// their due dates and results, on this device (localStorage, in the backup).
//
// A card is anything to recall: an opening move learned in a course
// (`opening:<course>:<path>`), later a missed puzzle. A card starts on step 0
// and is first due a day after it was added. A hit on a due card moves it one
// step out (1, 3, 7, 14, then 30 days, and it stays at 30); a miss resets it
// to step 0, due again in a day. A hit on a card that is not due yet changes
// nothing (practising early neither pushes it out nor counts against it).
import type { StorageLike } from './store';

export const INTERVAL_DAYS = [1, 3, 7, 14, 30] as const;
export const DAY_MS = 24 * 60 * 60 * 1000;

export interface Card {
  id: string;
  /** Index into `INTERVAL_DAYS`: the interval the card is on now. */
  step: number;
  /** When it is due (ms). */
  due: number;
  added: number;
  /** The last review (hit or miss), if any. */
  last?: number;
  hits: number;
  misses: number;
}

/** A new card: step 0, due one interval after it was added. */
export const newCard = (id: string, at: number): Card => ({ id, step: 0, due: at + INTERVAL_DAYS[0] * DAY_MS, added: at, hits: 0, misses: 0 });

export const isDue = (card: Card, now: number): boolean => card.due <= now;

/** The card after a review at `now`. */
export function review(card: Card, hit: boolean, now: number): Card {
  const c = { ...card, last: now };
  if (!hit) return { ...c, step: 0, due: now + INTERVAL_DAYS[0] * DAY_MS, misses: card.misses + 1 };
  if (!isDue(card, now)) return { ...c, hits: card.hits + 1 };
  const step = Math.min(card.step + 1, INTERVAL_DAYS.length - 1);
  return { ...c, step, due: now + INTERVAL_DAYS[step] * DAY_MS, hits: card.hits + 1 };
}

/** The due cards, most overdue first (then the shorter interval, the weaker card, first). */
export function dueOrder(cards: Iterable<Card>, now: number): Card[] {
  return [...cards].filter((c) => isDue(c, now)).sort((a, b) => a.due - b.due || a.step - b.step || a.id.localeCompare(b.id));
}

const isCard = (v: unknown): v is Card => {
  const c = v as Partial<Card>;
  return !!c && typeof c.id === 'string' && typeof c.step === 'number' && typeof c.due === 'number' && typeof c.added === 'number' && typeof c.hits === 'number' && typeof c.misses === 'number';
};

const KEY = 'sideline.practice';

export class PracticeDeck {
  private cache?: Map<string, Card>;

  constructor(private storage: StorageLike | undefined = browserStorage()) {}

  private load(): Map<string, Card> {
    if (this.cache) return this.cache;
    const m = new Map<string, Card>();
    try {
      const raw = JSON.parse(this.storage?.getItem(KEY) ?? 'null');
      if (raw && Array.isArray(raw.cards)) for (const c of raw.cards) if (isCard(c)) m.set(c.id, { ...c, step: clampStep(c.step) });
    } catch {
      /* damaged or blocked: start empty */
    }
    return (this.cache = m);
  }

  private write(): void {
    try {
      this.storage?.setItem(KEY, JSON.stringify({ version: 1, cards: [...this.load().values()] }));
    } catch {
      /* full or blocked: kept for this visit only */
    }
  }

  get(id: string): Card | undefined {
    return this.load().get(id);
  }

  /** Adds a card (nothing if it exists). Returns it. */
  add(id: string, at = Date.now()): Card {
    const m = this.load();
    let c = m.get(id);
    if (!c) {
      m.set(id, (c = newCard(id, at)));
      this.write();
    }
    return c;
  }

  /** Records a review (adding the card first if it is new). */
  record(id: string, hit: boolean, now = Date.now()): Card {
    const c = review(this.load().get(id) ?? newCard(id, now), hit, now);
    this.load().set(id, c);
    this.write();
    return c;
  }

  isDue(id: string, now = Date.now()): boolean {
    const c = this.get(id);
    return !!c && isDue(c, now);
  }

  /** Due cards among `ids` (all cards when left out), most overdue first. */
  due(ids?: Iterable<string>, now = Date.now()): Card[] {
    const m = this.load();
    const cards = ids ? [...ids].map((id) => m.get(id)).filter((c): c is Card => !!c) : m.values();
    return dueOrder(cards, now);
  }

  /** For the backup file. */
  all(): Card[] {
    return [...this.load().values()];
  }

  /** Merges a backup's cards in: per card, the one reviewed (or added) last wins. Returns cards added or changed. */
  importAll(data: unknown): number {
    if (!Array.isArray(data)) return 0;
    const m = this.load();
    let n = 0;
    const when = (c: Card) => c.last ?? c.added;
    for (const v of data) {
      if (!isCard(v)) continue;
      const old = m.get(v.id);
      if (old && when(old) >= when(v)) continue;
      m.set(v.id, { ...v, step: clampStep(v.step) });
      n++;
    }
    this.write();
    return n;
  }
}

const clampStep = (s: number) => Math.max(0, Math.min(INTERVAL_DAYS.length - 1, Math.floor(s)));

function browserStorage(): StorageLike | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}
