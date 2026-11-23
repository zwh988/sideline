import { describe, expect, it } from 'vitest';
import type { Remark } from '../coach/coach';
import { Navigation, RemarkLog, plyLabel } from './navigation';

const remark = (text: string, kind: Remark['kind'] = 'praise'): Remark => ({ kind, text, mood: 'neutral' });

function navAt(live: number): Navigation {
  const nav = new Navigation();
  nav.setLive(live);
  return nav;
}

describe('Navigation', () => {
  it('starts live and follows new moves', () => {
    const nav = navAt(0);
    expect(nav.viewing).toBe(false);
    nav.setLive(3);
    expect(nav.ply).toBe(3);
    expect(nav.viewing).toBe(false);
    expect(nav.hasNewMove).toBe(false);
  });

  it('clamps at both ends', () => {
    const nav = navAt(4);
    nav.start();
    expect(nav.ply).toBe(0);
    nav.back();
    expect(nav.ply).toBe(0);
    expect(nav.canBack).toBe(false);
    nav.goTo(99);
    expect(nav.ply).toBe(4);
    expect(nav.viewing).toBe(false);
    nav.goTo(-5);
    expect(nav.ply).toBe(0);
  });

  it('back leaves live, forward past the last move returns to live', () => {
    const nav = navAt(4);
    nav.back();
    expect(nav.ply).toBe(3);
    expect(nav.viewing).toBe(true);
    expect(nav.canForward).toBe(true);
    nav.forward();
    expect(nav.ply).toBe(4);
    expect(nav.viewing).toBe(false);
    nav.forward(); // already live: nothing happens
    expect(nav.ply).toBe(4);
    expect(nav.canForward).toBe(false);
  });

  it('stays on the viewed position when the coach moves, and says a move came in', () => {
    const nav = navAt(6);
    nav.goTo(2);
    nav.setLive(7);
    expect(nav.ply).toBe(2);
    expect(nav.viewing).toBe(true);
    expect(nav.hasNewMove).toBe(true);
    nav.forward();
    nav.goTo(6);
    expect(nav.live).toBe(7);
    expect(nav.viewing).toBe(true);
    nav.goLive();
    expect(nav.ply).toBe(7);
    expect(nav.hasNewMove).toBe(false);
  });

  it('snaps to live when a takeback removes the viewed position', () => {
    const nav = navAt(6);
    nav.goTo(5);
    nav.setLive(4); // takeback of two plies
    expect(nav.viewing).toBe(false);
    expect(nav.ply).toBe(4);
  });

  it('keeps an earlier viewed position after a takeback', () => {
    const nav = navAt(6);
    nav.goTo(2);
    nav.setLive(4);
    expect(nav.ply).toBe(2);
    expect(nav.viewing).toBe(true);
    expect(nav.hasNewMove).toBe(false);
  });

  it('reset returns to live at the given ply', () => {
    const nav = navAt(6);
    nav.goTo(1);
    nav.reset(0);
    expect(nav.live).toBe(0);
    expect(nav.viewing).toBe(false);
  });
});

describe('plyLabel', () => {
  const start = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  it('numbers white and black moves', () => {
    expect(plyLabel(start, 0, undefined)).toBe('Start position');
    expect(plyLabel(start, 1, 'e4')).toBe('1.e4');
    expect(plyLabel(start, 2, 'e5')).toBe('1…e5');
    expect(plyLabel(start, 3, 'Nf3')).toBe('2.Nf3');
  });
  it('follows the start position (Greek gift FEN: move 7, white to move)', () => {
    const fen = 'rnbq1rk1/pppn1ppp/4p3/3pP3/1b1P4/2NB1N2/PPP2PPP/R1BQK2R w KQ - 0 7';
    expect(plyLabel(fen, 1, 'Bxh7+')).toBe('7.Bxh7+');
    expect(plyLabel(fen, 2, 'Kxh7')).toBe('7…Kxh7');
    expect(plyLabel(fen, 3, 'Ng5+')).toBe('8.Ng5+');
  });
  it('starts a game with Black to move', () => {
    const fen = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
    expect(plyLabel(fen, 1, 'e5')).toBe('1…e5');
    expect(plyLabel(fen, 2, 'Nf3')).toBe('2.Nf3');
  });
});

describe('RemarkLog', () => {
  it("keeps the remark on the player's move when the coach replies", () => {
    const log = new RemarkLog();
    log.add(6, remark('Your move.'));
    log.add(7, remark('Bold! Bxh7+ offers your bishop for a pawn.')); // player's move
    log.add(8, remark('After Kxh7, I took your bishop.')); // coach's narration
    const shown = log.recent(8).map((e) => e.remark.text);
    expect(shown).toEqual(['Bold! Bxh7+ offers your bishop for a pawn.', 'After Kxh7, I took your bishop.']);
  });

  it('shows the latest remark when the last turn had none', () => {
    const log = new RemarkLog();
    log.add(2, remark('Careful.'));
    expect(log.recent(6).map((e) => e.remark.text)).toEqual(['Careful.']);
    expect(new RemarkLog().recent(0)).toEqual([]);
  });

  it('gives back what was said at a position', () => {
    const log = new RemarkLog();
    log.add(3, remark('a'));
    log.add(3, remark('b'));
    log.add(4, remark('c'));
    expect(log.at(3).map((e) => e.remark.text)).toEqual(['a', 'b']);
    expect(log.at(5)).toEqual([]);
  });

  it('forgets positions removed by a takeback', () => {
    const log = new RemarkLog();
    log.add(3, remark('a'));
    log.add(4, remark('b'));
    log.truncate(3);
    expect(log.all.map((e) => e.ply)).toEqual([3]);
  });

  it('replaces the previous hint step at the same position', () => {
    const log = new RemarkLog();
    log.add(3, remark('step 1', 'hint'));
    log.add(3, remark('step 2', 'hint'));
    log.add(5, remark('step 1', 'hint'));
    expect(log.all.map((e) => e.remark.text)).toEqual(['step 2', 'step 1']);
  });
});
