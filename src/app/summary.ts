// The end-of-game summary (task 1.12b). Takebacks are free in Lesson, but every one is recorded with
// the concept of the move that was taken back, and the game ends with what the player did with
// the moments: facts from the record, worded plainly. Nothing here is judged by the engine again.
import type { SavedGame } from './store';

/** A move the player took back. `flagged`: the coach had said it was a mistake or a missed tactic. */
export interface Takeback {
  /** Moves played once the taken-back move was made. */
  ply: number;
  san: string;
  flagged: boolean;
  /** The Lichess-style theme of the flagged moment, when a detector named one. */
  concept?: string;
}

/** Concept (Lichess theme) as a plural noun for a sentence: "on loose pieces". */
const CONCEPT_PLURAL: Record<string, string> = {
  hangingPiece: 'loose pieces',
  fork: 'forks',
  pin: 'pins',
  skewer: 'skewers',
  discoveredAttack: 'discovered attacks',
  backRankMate: 'back-rank mates',
  smotheredMate: 'smothered mates',
  trappedPiece: 'trapped pieces',
  capturingDefender: 'pieces that guard others',
  deflection: 'deflections',
  attraction: 'attractions',
  intermezzo: 'in-between moves',
  sacrifice: 'sacrifices',
  doubleCheck: 'double checks',
  promotion: 'promotions',
  mate: 'checkmates',
};

export function conceptPlural(concept: string): string {
  if (CONCEPT_PLURAL[concept]) return CONCEPT_PLURAL[concept];
  if (/^mateIn\d$/.test(concept)) return 'checkmates';
  return concept.replace(/([A-Z])/g, ' $1').toLowerCase().trim();
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The most common concept among the entries, if at least `min` share it. */
function repeated(concepts: (string | undefined)[], min: number): { concept: string; n: number } | undefined {
  const count = new Map<string, number>();
  for (const c of concepts) if (c) count.set(c, (count.get(c) ?? 0) + 1);
  const top = [...count.entries()].sort((a, b) => b[1] - a[1])[0];
  return top && top[1] >= min ? { concept: top[0], n: top[1] } : undefined;
}

/**
 * What the game's moments and takebacks add up to, or nothing when there were none.
 * Example: "3 moments. You took back 2 moves, both on loose pieces. You played on after 1 flagged move."
 */
export function gameSummary(game: Pick<SavedGame, 'moments' | 'takebacks'>): string {
  const mine = game.moments.filter((m) => m.kind === 'mistake' || m.kind === 'missed-tactic' || m.kind === 'found-tactic');
  const flagged = mine.filter((m) => m.kind !== 'found-tactic');
  const takebacks = game.takebacks ?? [];
  if (!mine.length && !takebacks.length) return '';

  const parts: string[] = [];
  if (mine.length) parts.push(`${plural(mine.length, 'moment')}.`);

  if (takebacks.length) {
    let s = `You took back ${plural(takebacks.length, 'move')}`;
    const named = takebacks.filter((t) => t.concept);
    const top = repeated(takebacks.map((t) => t.concept), 2);
    if (top && top.n === takebacks.length) s += `, ${takebacks.length === 2 ? 'both' : 'all'} on ${conceptPlural(top.concept)}`;
    else if (top) s += `, ${top.n} of them on ${conceptPlural(top.concept)}`;
    else if (named.length === 1 && takebacks.length === 1) s += `, on ${conceptPlural(named[0].concept!)}`;
    parts.push(`${s}.`);
  }

  const playedOn = flagged.filter((m) => m.outcome === 'played-on').length;
  if (playedOn) parts.push(`You played on after ${plural(playedOn, 'flagged move')}.`);

  // A habit across the game's mistakes, taken back or not.
  const habit = repeated(flagged.map((m) => m.concept), 2);
  if (habit && flagged.length >= 2) parts.push(`${conceptPlural(habit.concept)[0].toUpperCase()}${conceptPlural(habit.concept).slice(1)} came up ${habit.n} times.`);
  return parts.join(' ');
}
