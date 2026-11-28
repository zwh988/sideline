import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import { boardSound, cueSound, recipe, TIMBRES, type MomentSound, type SoundEvent } from './sound';

const COACHES = ['coach1', 'coach2', 'coach3', 'coach4', 'coach5', 'coach6'];
const MOMENTS: MomentSound[] = ['blunder', 'solved', 'missed', 'win', 'loss', 'draw'];
const ALL: SoundEvent[] = ['move', 'capture', 'check', ...MOMENTS];

describe('boardSound', () => {
  it('reads real moves: plain, capture, check, mate, castling, promotion', () => {
    const c = new Chess();
    const san = (m: string) => c.move(m).san;
    expect(boardSound(san('e4'))).toBe('move');
    expect(boardSound(san('d5'))).toBe('move');
    expect(boardSound(san('exd5'))).toBe('capture');
    expect(boardSound(san('Qxd5'))).toBe('capture');
    expect(boardSound(san('Bb5+'))).toBe('check'); // check wins over a plain move
    // The king takes a queen: a capture.
    const k = new Chess('4k3/8/8/8/8/8/3q4/R3K3 w Q - 0 1');
    expect(boardSound(k.move('Kxd2').san)).toBe('capture');
    const m = new Chess('6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1');
    expect(boardSound(m.move('Ra8').san)).toBe('check'); // Ra8#
    const castle = new Chess('4k3/8/8/8/8/8/8/R3K2R w KQ - 0 1');
    expect(boardSound(castle.move('O-O').san)).toBe('move');
    const promo = new Chess('8/4P2k/8/8/8/8/8/4K3 w - - 0 1');
    expect(boardSound(promo.move('e8=Q').san)).toBe('move');
    expect(boardSound('exd8=Q+')).toBe('check');
  });
});

describe('cueSound', () => {
  it('maps the moment cues and leaves the rest silent', () => {
    expect(cueSound('blunder')).toBe('blunder');
    expect(cueSound('solved')).toBe('solved');
    expect(cueSound('solvedFirstTry')).toBe('solved');
    expect(cueSound('missed')).toBe('missed');
    expect(cueSound('win')).toBe('win');
    expect(cueSound('loss')).toBe('loss');
    expect(cueSound('draw')).toBe('draw');
    for (const quiet of ['mistake', 'good', 'tactic', 'start', 'thinking', 'sawThreat', 'ownSlip', 'lessonRight', 'openingDone', 'endgame'] as const) {
      expect(cueSound(quiet)).toBeUndefined();
    }
    expect(cueSound(undefined)).toBeUndefined();
  });
});

describe('recipe', () => {
  it('every coach has every sound, short and audible', () => {
    for (const id of COACHES) {
      for (const e of ALL) {
        const tones = recipe(e, id);
        expect(tones.length).toBeGreaterThan(0);
        const end = Math.max(...tones.map((t) => t.at + t.dur));
        expect(end).toBeLessThan(e === 'move' || e === 'capture' || e === 'check' ? 0.3 : 1.6);
        for (const t of tones) {
          expect(t.freq).toBeGreaterThan(60);
          expect(t.freq).toBeLessThan(5000);
          expect(t.gain).toBeGreaterThan(0);
          expect(t.gain).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('board sounds are the same for every coach, moments differ', () => {
    for (const e of ['move', 'capture', 'check'] as const) {
      for (const id of COACHES) expect(recipe(e, id)).toEqual(recipe(e, 'coach1'));
    }
    for (const e of MOMENTS) {
      const distinct = new Set(COACHES.map((id) => JSON.stringify(recipe(e, id))));
      expect(distinct.size).toBe(COACHES.length);
    }
    expect(Object.keys(TIMBRES).sort()).toEqual(COACHES);
  });

  it('a solve rises, a loss falls, a blunder sits below the root', () => {
    for (const id of COACHES) {
      const last = (e: SoundEvent) => recipe(e, id).at(-1)!;
      const first = (e: SoundEvent) => recipe(e, id)[0];
      const pitch = (t: { freq: number; slideTo?: number }) => t.slideTo ?? t.freq;
      expect(pitch(last('solved'))).toBeGreaterThan(pitch(first('solved')));
      expect(pitch(last('loss'))).toBeLessThan(pitch(first('loss')));
      expect(pitch(first('blunder'))).toBeLessThan(TIMBRES[id].root);
    }
  });

  it('an unknown coach falls back to a timbre', () => {
    expect(recipe('win', '')).toEqual(recipe('win', 'coach1'));
  });
});
