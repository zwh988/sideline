import { describe, expect, it } from 'vitest';
import { COMMON_P, LineTree, MAX_FORKS, badgeOf, isCommon, laneOf, rateOptions, rateOther } from './linetree';

// White to move after 4…d6 (a Scotch game): the queen on d4 is attacked by the knight on c6.
const SCOTCH = 'r1bqkbnr/ppp2ppp/2np4/8/3QP3/5N2/PPP2PPP/RNB1KB1R w KQkq - 1 5';
const cp = (value: number) => ({ kind: 'cp' as const, value });

describe('laneOf', () => {
  it('puts a move in a lane by how much worse it is than the best', () => {
    expect(laneOf(0)).toBe('best');
    expect(laneOf(10)).toBe('best');
    expect(laneOf(11)).toBe('great');
    expect(laneOf(60)).toBe('great');
    expect(laneOf(61)).toBe('good');
    expect(laneOf(150)).toBe('good');
    expect(laneOf(151)).toBe('other');
    expect(laneOf(900)).toBe('other');
  });
});

describe('rateOptions', () => {
  // The side to move is White; scores are from White's point of view (the side to move).
  const lines = [
    { pv: ['f1b5', 'c8d7'], score: cp(150) },
    { pv: ['d4d3'], score: cp(110) },
    { pv: ['d4e3'], score: cp(10) },
    { pv: ['f1c4'], score: cp(-460) },
  ];

  it('ranks each move against the best and words them for the player', () => {
    const o = rateOptions(SCOTCH, lines, 'white');
    expect(o.map((x) => [x.san, x.lane, x.lossCp])).toEqual([
      ['Bb5', 'best', 0],
      ['Qd3', 'great', 40],
      ['Qe3', 'good', 140],
      ['Bc4', 'other', 610],
    ]);
    expect(o[0].evalCp).toBe(150);
    expect(o[0].bestSan).toBeUndefined();
    expect(o[3].bestSan).toBe('Bb5');
  });

  it('gives the score for the player, whichever side moves', () => {
    const o = rateOptions(SCOTCH, lines, 'black');
    expect(o[0].evalCp).toBe(-150);
    expect(o[3].evalCp).toBe(460);
  });

  it('skips a repeated first move and an empty list', () => {
    expect(rateOptions(SCOTCH, [], 'white')).toEqual([]);
    expect(rateOptions(SCOTCH, [lines[0], { pv: lines[0].pv, score: cp(100) }], 'white')).toHaveLength(1);
  });
});

describe('badges and the only move', () => {
  const cp = (value: number) => ({ kind: 'cp' as const, value });
  it('marks the best move as the only move when the next is 200 or more worse', () => {
    const o = rateOptions(SCOTCH, [{ pv: ['f1b5'], score: cp(150) }, { pv: ['d4d3'], score: cp(-60) }], 'white');
    expect(o[0].onlyMove).toBe(true);
    expect(o[1].onlyMove).toBeUndefined();
    const close = rateOptions(SCOTCH, [{ pv: ['f1b5'], score: cp(150) }, { pv: ['d4d3'], score: cp(-40) }], 'white');
    expect(close[0].onlyMove).toBeUndefined(); // 190 apart
  });

  it('gives a mark only to notable moves', () => {
    const base = { evalCp: 0 };
    expect(badgeOf({ ...base, lane: 'best', lossCp: 0, onlyMove: true })).toBe('!');
    expect(badgeOf({ ...base, lane: 'best', lossCp: 0 })).toBeUndefined();
    expect(badgeOf({ ...base, lane: 'good', lossCp: 120 })).toBeUndefined();
    expect(badgeOf({ ...base, lane: 'other', lossCp: 200 })).toBe('?');
    expect(badgeOf({ ...base, lane: 'other', lossCp: 610 })).toBe('??');
    expect(badgeOf(undefined)).toBeUndefined();
  });
});

describe('isCommon', () => {
  it('counts a move Maia gives at least the common probability', () => {
    const likely = [{ uci: 'e2e4', p: 0.4 }, { uci: 'd2d4', p: COMMON_P }, { uci: 'g1f3', p: 0.1 }];
    expect(isCommon(likely, 'e2e4')).toBe(true);
    expect(isCommon(likely, 'd2d4')).toBe(true);
    expect(isCommon(likely, 'g1f3')).toBe(false);
    expect(isCommon(likely, 'a2a3')).toBe(false);
    expect(isCommon([], 'e2e4')).toBe(false);
  });
});

describe('rateOther', () => {
  it('rates a move that is not among the lines by what the opponent can do after it', () => {
    // 5.Be2: after it, Black (to move) is +460 by the engine: the move is worth -460 to White.
    const r = rateOther(SCOTCH, 150, cp(460), 'white', 'Bb5');
    expect(r.lane).toBe('other');
    expect(r.lossCp).toBe(610);
    expect(r.evalCp).toBe(-460);
    expect(r.bestSan).toBe('Bb5');
  });

  it('a move as good as the best is Best (no best-move hint)', () => {
    const r = rateOther(SCOTCH, 150, cp(-150), 'white', 'Bb5');
    expect(r.lane).toBe('best');
    expect(r.bestSan).toBeUndefined();
  });
});

describe('LineTree', () => {
  it('opens moves from the cursor, once each, with labels and columns', () => {
    const t = new LineTree(SCOTCH, 'white');
    const bc4 = t.open(t.root, 'f1c4', 'game');
    expect(bc4).toMatchObject({ san: 'Bc4', label: '5.Bc4', depth: 1, color: 'w', author: 'game' });
    expect(t.open(t.root, 'f1c4', 'you')).toBe(bc4);
    const nxd4 = t.open(bc4, 'c6d4', 'game');
    expect(nxd4).toMatchObject({ san: 'Nxd4', label: '5…Nxd4', depth: 2, color: 'b' });
    expect(t.all().map((n) => n.san)).toEqual(['Bc4', 'Nxd4']);
    expect(() => t.open(t.root, 'a1a8', 'you')).toThrow();
  });

  it('keeps the cursor and its position, and steps along the path', () => {
    const t = new LineTree(SCOTCH, 'white');
    const a = t.open(t.root, 'f1c4', 'game');
    const b = t.open(a, 'c6d4', 'game');
    t.goto(b);
    expect(t.fen).toBe(b.fen);
    expect(t.ucis()).toEqual(['f1c4', 'c6d4']);
    t.prev();
    expect(t.cursor).toBe(a);
    t.start();
    expect(t.cursor).toBe(t.root);
    expect(t.nextOf(t.root)).toBe(a);
    t.end();
    expect(t.cursor).toBe(b);
    expect(t.isPlayerTurn).toBe(true); // White (the player) to move after 5...Nxd4
  });

  it('› follows the kid last visited, so a fork remembers where the player was', () => {
    const t = new LineTree(SCOTCH, 'white');
    const bc4 = t.open(t.root, 'f1c4', 'game');
    const bb5 = t.open(t.root, 'f1b5', 'engine');
    expect(t.nextOf(t.root)).toBe(bc4);
    t.goto(bb5);
    t.start();
    expect(t.nextOf(t.root)).toBe(bb5);
  });

  it('counts forks and stops opening new ones at the cap', () => {
    const t = new LineTree(SCOTCH, 'white');
    t.open(t.root, 'f1c4', 'game');
    expect(t.forks).toBe(0);
    for (const uci of ['f1b5', 'd4d3', 'd4e3', 'd4a4', 'd4c4']) {
      expect(t.canOpen(t.root, uci)).toBe(true);
      t.open(t.root, uci, 'engine');
    }
    expect(t.forks).toBe(MAX_FORKS);
    expect(t.canOpen(t.root, 'f1e2')).toBe(false);
    expect(t.canOpen(t.root, 'f1b5')).toBe(true); // already open
  });

  it('says whose turn it is and what the legal moves are at the cursor', () => {
    const t = new LineTree(SCOTCH, 'white');
    expect(t.isPlayerTurn).toBe(true);
    expect(t.dests.get('f1' as never)).toContain('b5');
    const a = t.open(t.root, 'f1b5', 'engine');
    t.goto(a);
    expect(t.isPlayerTurn).toBe(false);
    expect(t.result).toEqual({ over: false });
  });

  it('removes a move and its Line, moving the cursor out of it', () => {
    const t = new LineTree(SCOTCH, 'white');
    const a = t.open(t.root, 'f1c4', 'game');
    const b = t.open(a, 'c6d4', 'game');
    t.goto(b);
    t.removeFrom(a);
    expect(t.all()).toEqual([]);
    expect(t.cursor).toBe(t.root);
  });

  it('labels a first move by Black with the dots', () => {
    const t = new LineTree('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1', 'white');
    expect(t.open(t.root, 'e7e5', 'game').label).toBe('1…e5');
  });
});
