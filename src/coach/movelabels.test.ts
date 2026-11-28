import { describe, expect, it } from 'vitest';
import { HEADLINE, LABEL_INFO, classifyMove, isOnlyMove, labelOfLoss, type MoveLabel } from './movelabels';

const quiet = { lossCp: 0, beforeCp: 30, afterCp: 30 };

describe('move labels', () => {
  it('the loss sets the label: Best, Excellent, Good, Inaccuracy, Mistake, Blunder', () => {
    expect([0, 10, 11, 60, 61, 100, 101, 150, 151, 299, 300, 900].map(labelOfLoss)).toEqual([
      'best', 'best', 'excellent', 'excellent', 'good', 'good', 'inaccuracy', 'inaccuracy', 'mistake', 'mistake', 'blunder', 'blunder',
    ]);
  });

  it('book and forced moves come first, whatever they cost', () => {
    expect(classifyMove({ ...quiet, book: true, lossCp: 80 })).toBe('book');
    expect(classifyMove({ ...quiet, forced: true, lossCp: 400 })).toBe('forced');
  });

  it('a sound sacrifice is brilliant, but not when already far ahead or when it loses', () => {
    expect(classifyMove({ ...quiet, sacrifice: true })).toBe('brilliant');
    expect(classifyMove({ ...quiet, sacrifice: true, lossCp: 40 })).toBe('brilliant');
    expect(classifyMove({ ...quiet, sacrifice: true, lossCp: 120 })).toBe('inaccuracy');
    expect(classifyMove({ ...quiet, sacrifice: true, beforeCp: 800, afterCp: 800 })).toBe('best');
    expect(classifyMove({ ...quiet, sacrifice: true, beforeCp: 99000, afterCp: 99000 })).toBe('brilliant'); // a queen given to force mate
    expect(classifyMove({ ...quiet, sacrifice: true, afterCp: -200 })).toBe('best');
  });

  it('the only move that holds is great', () => {
    expect(classifyMove({ ...quiet, onlyMove: true })).toBe('great');
    expect(isOnlyMove(50, -200)).toBe(true);
    expect(isOnlyMove(50, -100)).toBe(false); // the gap is too small
    expect(isOnlyMove(900, 500)).toBe(false); // the next-best still wins
    expect(isOnlyMove(50, undefined)).toBe(false);
  });

  it('letting a chance go is overlooked, but a blunder stays a blunder', () => {
    expect(classifyMove({ ...quiet, lossCp: 120, chance: true })).toBe('overlooked');
    expect(classifyMove({ ...quiet, lossCp: 200, chance: true })).toBe('overlooked');
    expect(classifyMove({ ...quiet, lossCp: 40, chance: true })).toBe('excellent');
    expect(classifyMove({ ...quiet, lossCp: 350, chance: true })).toBe('blunder');
    expect(classifyMove({ ...quiet, lossCp: 0, passedUp: true })).toBe('overlooked');
  });

  it('every label has its own mark; the headline is the important ones', () => {
    const labels = Object.keys(LABEL_INFO) as MoveLabel[];
    expect(new Set(labels.map((l) => LABEL_INFO[l].glyph)).size).toBe(labels.length);
    expect(HEADLINE).toEqual(['brilliant', 'great', 'blunder', 'overlooked', 'mistake']);
  });
});
