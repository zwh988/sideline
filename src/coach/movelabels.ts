// A label for every move of a reviewed game (and every move in a sideline): one vocabulary for how good a
// move was, drawn as a badge with its own mark and colour. Every label is a fact from the engine
// (centipawns lost against its best move, the only move that holds) or board code (the opening book, the
// only legal move, material offered); nothing here guesses.

export type MoveLabel = 'brilliant' | 'great' | 'best' | 'excellent' | 'good' | 'book' | 'forced' | 'inaccuracy' | 'mistake' | 'overlooked' | 'blunder';

export interface LabelInfo {
  /** The label in words, singular and plural ("1 Blunder", "2 Blunders"). */
  name: string;
  plural: string;
  /** The mark in the badge: short, and never a hue alone. */
  glyph: string;
  /** CSS colour (a token from style.css). */
  colour: string;
  /** What it means, for a tooltip. */
  means: string;
}

export const LABEL_INFO: Record<MoveLabel, LabelInfo> = {
  brilliant: { name: 'Brilliant', plural: 'Brilliants', glyph: '‼', colour: 'var(--mark-brilliant)', means: 'A strong move that gives up material, and it works' },
  great: { name: 'Great', plural: 'Greats', glyph: '!', colour: 'var(--mark-great)', means: 'The only move that holds: every other move is much worse' },
  best: { name: 'Best', plural: 'Bests', glyph: '★', colour: 'var(--mark-good)', means: "The engine's top move" },
  excellent: { name: 'Excellent', plural: 'Excellents', glyph: '✓', colour: 'var(--mark-excellent)', means: "Close to the engine's top move" },
  good: { name: 'Good', plural: 'Goods', glyph: '=', colour: 'var(--mark-ok)', means: 'A little worse than the best move' },
  book: { name: 'Book', plural: 'Book moves', glyph: '≡', colour: 'var(--mark-book)', means: 'A known opening move' },
  forced: { name: 'Forced', plural: 'Forced', glyph: '→', colour: 'var(--mark-forced)', means: 'The only legal move' },
  inaccuracy: { name: 'Inaccuracy', plural: 'Inaccuracies', glyph: '?!', colour: 'var(--mark-inacc)', means: 'Loses a little: about a pawn' },
  mistake: { name: 'Mistake', plural: 'Mistakes', glyph: '?', colour: 'var(--mark-bad)', means: 'Loses one and a half pawns or more' },
  overlooked: { name: 'Overlooked', plural: 'Overlooked', glyph: '⊘', colour: 'var(--mark-overlooked)', means: 'Something better was there (a tactic, or their mistake to punish) and this move let it go' },
  blunder: { name: 'Blunder', plural: 'Blunders', glyph: '??', colour: 'var(--mark-blunder)', means: 'Loses three pawns or more' },
};

/** Labels in order of importance, for a game's headline (the rest are shown on the moves only). */
export const HEADLINE: MoveLabel[] = ['brilliant', 'great', 'blunder', 'overlooked', 'mistake'];

/** Centipawns lost against the best move: up to `best` is Best, then Excellent, Good, Inaccuracy, Mistake; from `blunder` on, Blunder. */
export const LABEL_CP = { best: 10, excellent: 60, good: 100, inaccuracy: 150, blunder: 300 } as const;
/** The best move is the only one that holds when the next-best is this much worse and doesn't keep a clear edge. */
export const ONLY_MOVE_GAP = 200;
export const ONLY_MOVE_SECOND_MAX = 300;
/**
 * A sacrifice is not brilliant when the side was already this far ahead (centipawns), unless it forces mate
 * (Morphy's Qb8+), or when the side is behind after it.
 */
export const BRILLIANT_MAX_BEFORE = 500;
export const BRILLIANT_MIN_AFTER = -100;
/** Scores from here on are a forced mate. */
export const MATE_SCORE = 90000;

/** The sacrifice part of Brilliant: close to the best move, not behind after it, and not a gift while already winning (a mate is never that). */
export function brilliantSacrifice(lossCp: number, beforeCp: number, afterCp: number): boolean {
  return lossCp <= LABEL_CP.excellent && afterCp >= BRILLIANT_MIN_AFTER && (beforeCp < BRILLIANT_MAX_BEFORE || afterCp >= MATE_SCORE);
}

export function labelOfLoss(lossCp: number): 'best' | 'excellent' | 'good' | 'inaccuracy' | 'mistake' | 'blunder' {
  if (lossCp <= LABEL_CP.best) return 'best';
  if (lossCp <= LABEL_CP.excellent) return 'excellent';
  if (lossCp <= LABEL_CP.good) return 'good';
  if (lossCp <= LABEL_CP.inaccuracy) return 'inaccuracy';
  if (lossCp < LABEL_CP.blunder) return 'mistake';
  return 'blunder';
}

/** What is known about a move, all from the engine or board code. */
export interface MoveFactsForLabel {
  /** Centipawns worse than the engine's best move (0 for the best, and when the side stays far ahead or behind). */
  lossCp: number;
  /** The position after the move is in the opening book. */
  book?: boolean;
  /** It was the only legal move. */
  forced?: boolean;
  /** It is the engine's best move and the next-best is much worse (`onlyMove`). */
  onlyMove?: boolean;
  /** It offers material that the opponent can take (`offeredMaterial`). */
  sacrifice?: boolean;
  /** The mover's evaluation before the move (best play) and after it, centipawns. */
  beforeCp: number;
  afterCp: number;
  /** Something better was there and the move let it go: a tactic it didn't play, or the opponent's mistake just before. */
  chance?: boolean;
  /** It passed up a mate or a material win while staying far ahead (the loss counts as 0 there). */
  passedUp?: boolean;
}

/** The label of a move. Book and Forced first, then the finds (Brilliant, Great), then what was let go, then the loss. */
export function classifyMove(f: MoveFactsForLabel): MoveLabel {
  if (f.book) return 'book';
  if (f.forced) return 'forced';
  const base = labelOfLoss(f.lossCp);
  if (f.sacrifice && brilliantSacrifice(f.lossCp, f.beforeCp, f.afterCp)) return 'brilliant';
  if (f.onlyMove && base === 'best') return 'great';
  if (base === 'blunder') return 'blunder';
  if (f.passedUp) return 'overlooked';
  if (f.chance && (base === 'inaccuracy' || base === 'mistake')) return 'overlooked';
  return base;
}

/** Whether the best move is the only one that holds: the next-best line is much worse and no longer clearly ahead. */
export function isOnlyMove(bestCp: number, secondCp: number | undefined): boolean {
  return secondCp !== undefined && bestCp - secondCp >= ONLY_MOVE_GAP && secondCp < ONLY_MOVE_SECOND_MAX;
}
