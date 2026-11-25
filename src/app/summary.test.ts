import { describe, expect, it } from 'vitest';
import { conceptPlural, gameSummary } from './summary';
import type { SavedMoment } from './store';

const moment = (over: Partial<SavedMoment>): SavedMoment => ({
  kind: 'mistake',
  fen: '',
  played: 'a2a3',
  ply: 10,
  text: '',
  ...over,
});

describe('gameSummary', () => {
  it('says nothing when there were no moments and no takebacks', () => {
    expect(gameSummary({ moments: [] })).toBe('');
  });

  it('counts moments, takebacks on one concept and playing on', () => {
    const summary = gameSummary({
      moments: [
        moment({ concept: 'hangingPiece', outcome: 'taken-back' }),
        moment({ concept: 'hangingPiece', outcome: 'taken-back', ply: 14 }),
        moment({ concept: 'fork', outcome: 'played-on', ply: 20 }),
      ],
      takebacks: [
        { ply: 10, san: 'Bc4', flagged: true, concept: 'hangingPiece' },
        { ply: 14, san: 'Qd3', flagged: true, concept: 'hangingPiece' },
      ],
    });
    expect(summary).toBe('3 moments. You took back 2 moves, both on loose pieces. You played on after 1 flagged move. Loose pieces came up 2 times.');
  });

  it('a single takeback on a named concept, and one without', () => {
    expect(gameSummary({ moments: [moment({ concept: 'fork', outcome: 'taken-back' })], takebacks: [{ ply: 10, san: 'a3', flagged: true, concept: 'fork' }] })).toBe(
      '1 moment. You took back 1 move, on forks.',
    );
    // A takeback the coach had not flagged: counted, no concept claimed.
    expect(gameSummary({ moments: [], takebacks: [{ ply: 6, san: 'h3', flagged: false }] })).toBe('You took back 1 move.');
  });

  it('three takebacks with mixed concepts name only what repeats', () => {
    const summary = gameSummary({
      moments: [],
      takebacks: [
        { ply: 4, san: 'a', flagged: true, concept: 'fork' },
        { ply: 8, san: 'b', flagged: true, concept: 'fork' },
        { ply: 12, san: 'c', flagged: false },
      ],
    });
    expect(summary).toBe('You took back 3 moves, 2 of them on forks.');
  });

  it('found tactics are moments but never flagged moves', () => {
    expect(gameSummary({ moments: [moment({ kind: 'found-tactic', concept: 'fork' })] })).toBe('1 moment.');
  });

  it('words concepts, with a fallback for unknown themes', () => {
    expect(conceptPlural('hangingPiece')).toBe('loose pieces');
    expect(conceptPlural('mateIn2')).toBe('checkmates');
    expect(conceptPlural('xRayAttack')).toBe('x ray attack');
  });
});
