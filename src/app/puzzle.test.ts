import { describe, expect, it } from 'vitest';
import { PuzzleRun, judgeOther, puzzleHint, solvedWords } from './puzzle';
import { choosePuzzle, targetRating, START_AT, STEP_DOWN, STEP_UP } from './puzzlechoice';
import { PuzzleResults, isClean } from './puzzlestore';
import { themeName, type Puzzle } from './puzzlepool';

// Real puzzles from the Lichess database (CC0), as stored in the pool.
const P = (id: string, fen: string, moves: string, rating: number, themes: string[]): Puzzle => ({ id, fen, moves: moves.split(' '), rating, themes, openings: [] });
const MATE1 = P('nU4Fi', '6k1/8/4pK1Q/p3P3/8/8/2p3q1/8 b - - 1 55', 'g2g7 h6g7', 542, ['endgame', 'mate', 'mateIn1', 'oneMove', 'queenEndgame']);
const SMOTHERED = P('yC2F3', '3r1rk1/p4pp1/6np/1P6/PPq2Qn1/4p2R/1B4PP/1B4RK w - - 0 29', 'f4c4 g4f2', 722, ['mate', 'mateIn1', 'oneMove', 'smotheredMate']);
const KNIGHT = P('XzePZ', '6k1/p5p1/1p5p/5P2/5pP1/1Pn2P2/P1p4P/2N1K3 b - - 2 45', 'c3a2 c1a2 c2c1q a2c1', 688, ['crushing', 'endgame', 'hangingPiece', 'knightEndgame', 'short']);
const BACKRANK = P('BfUqY', 'r3k3/2p5/1pPp2q1/1P6/p6p/P7/7P/4RR1K b - - 1 42', 'e8d8 f1f8 g6e8 e1e8', 610, ['mate', 'mateIn2', 'short']);
const PROMO = P('msVMi', '2r2rk1/3R1pp1/p7/8/5P2/6PP/PP1p4/KR1q4 w - - 0 33', 'b1d1 c8c1 d1c1 d2c1q', 601, ['mate', 'mateIn2']);

describe('a puzzle run: checking moves against the solution', () => {
  it('starts after the opponent’s first move, with the solver to move', () => {
    const run = new PuzzleRun(MATE1);
    expect(run.firstMove).toBe('g2g7');
    expect(run.solverColor).toBe('white');
    expect(run.fen).toBe(run.solverFen);
    expect(run.solverFen.split(' ')[1]).toBe('w');
  });

  it('a one-move puzzle: the solution solves it, another move goes to the engine', () => {
    const run = new PuzzleRun(MATE1);
    expect(run.check('f6e7')).toBe('other');
    expect(run.check('h6g7')).toBe('correct');
    expect(run.advance('correct')).toBeUndefined();
    expect(run.solved).toBe(true);
  });

  it('a combination: each right move gets the opponent’s reply from the solution', () => {
    const run = new PuzzleRun(KNIGHT);
    expect(run.check('e1d2')).toBe('other'); // the king walks, the pawn queens
    expect(run.check('c1a2')).toBe('correct');
    expect(run.advance('correct')).toBe('c2c1q');
    expect(run.solved).toBe(false);
    expect(run.fen.split(' ')[0]).toBe('6k1/p5p1/1p5p/5P2/5pP1/1P3P2/N6P/2q1K3');
    expect(run.check('a2c1')).toBe('correct');
    expect(run.advance('correct')).toBeUndefined();
    expect(run.solved).toBe(true);
  });

  it('another mate on the last move counts (the other rook takes on e8)', () => {
    const run = new PuzzleRun(BACKRANK);
    run.advance(run.check('f1f8') as 'correct'); // Rf8+ Qe8
    expect(run.expected).toBe('e1e8');
    expect(run.check('f8e8')).toBe('mate');
    run.advance('mate');
    expect(run.solved).toBe(true);
  });

  it('a promotion: the right piece is the move; another piece that also mates counts too', () => {
    const run = new PuzzleRun(PROMO);
    run.advance(run.check('c8c1') as 'correct'); // Rxc1+ Rxc1
    expect(run.check('d2c1q')).toBe('correct');
    expect(run.check('d2c1r')).toBe('mate'); // dxc1=R# is mate as well
    expect(run.check('d2c1n')).toBe('other');
  });

  it('a move the engine puts among the moves that hold up is "also good", anything worse is wrong', () => {
    expect(judgeOther({ lane: 'best' })).toBe('also-good');
    expect(judgeOther({ lane: 'good' })).toBe('also-good');
    expect(judgeOther({ lane: 'other' })).toBe('wrong');
  });
});

describe('puzzle hints: what to look for, the piece, the square, the move', () => {
  const run = new PuzzleRun(SMOTHERED);

  it('step 1 names a concept only when the detectors find it in the move', () => {
    expect(puzzleHint(run.fen, 'g4f2', 1).text).toBe('Look for a smothered mate.');
    // The queen move in KNIGHT is a plain capture that saves the day: no concept, the general advice.
    const k = new PuzzleRun(KNIGHT);
    expect(puzzleHint(k.fen, 'c1a2', 1).text).toBe('Look for something you can take for free.');
    expect(puzzleHint(new PuzzleRun(MATE1).fen, 'h6g7', 1).text).toBe('There is a checkmate in one move here.');
  });

  it('steps 2 to 4 show the piece, then where it goes, then the move', () => {
    expect(puzzleHint(run.fen, 'g4f2', 2)).toEqual({ text: 'The piece to move is your knight on g4.', shapes: [{ orig: 'g4', brush: 'green' }] });
    expect(puzzleHint(run.fen, 'g4f2', 3).text).toBe('Your knight goes to f2.');
    expect(puzzleHint(run.fen, 'g4f2', 4)).toEqual({ text: 'The move is Nf2#.', shapes: [{ orig: 'g4', dest: 'f2', brush: 'green' }] });
  });
});

describe('the coach’s words when a puzzle is solved', () => {
  it('names the pattern of a mate before what the checks on the way showed', () => {
    const run = new PuzzleRun(P('pLuFV', 'r2r2k1/2B1Rppp/1pp5/2P5/1p6/8/5PPP/R5K1 w - - 0 26', 'c7d8 a8a1 e7e1 a1e1', 755, ['backRankMate', 'mateIn2']));
    expect(solvedWords(run, run.solution)).toEqual({ text: "Solved! That's a back-rank mate: the king can't escape because its own pieces block the squares in front of it. Checkmate.", theme: 'backRankMate' });
  });

  it('names a concept the detectors found, and says what the line achieved', () => {
    const run = new PuzzleRun(SMOTHERED);
    const w = solvedWords(run, ['g4f2']);
    expect(w.text).toMatch(/^Solved! That's a smothered mate: .*Checkmate\.$/);
    expect(w.theme).toBe('smotheredMate');
  });

  it('says what material the line wins, counting a promoted piece taken back as a pawn', () => {
    const run = new PuzzleRun(KNIGHT);
    const w = solvedWords(run, run.solution);
    // The queen the pawn became is taken back at once: it counts as the pawn it was.
    expect(w.text).toBe('Solved! That queen was a loose piece: nothing defended it. That wins a knight and a pawn.');
    expect(w.theme).toBe('hangingPiece');
  });

  it('words another mate as played, not the solution’s', () => {
    const run = new PuzzleRun(BACKRANK);
    expect(solvedWords(run, ['f1f8', 'g6e8', 'f8e8']).text).toMatch(/Checkmate\.$/);
  });
});

describe('choosing the next puzzle', () => {
  const band: [number, number] = [800, 1200];
  const set = Array.from({ length: 40 }, (_, i) => P(`p${i}`, '8/8/8/8/8/8/8/8 w - - 0 1', 'a1a2 a2a3', 800 + i * 10, ['fork']));
  const none = () => undefined;

  it('starts low in the band, goes up after clean solves and down after misses, never leaving the band', () => {
    expect(targetRating(band, [])).toBe(800 + START_AT * 400);
    expect(targetRating(band, [true, true])).toBe(800 + START_AT * 400 + 2 * STEP_UP);
    expect(targetRating(band, [true, false])).toBe(800 + START_AT * 400 - STEP_DOWN);
    expect(targetRating(band, [false, false, false, false, false])).toBe(800);
    expect(targetRating(band, Array(20).fill(true))).toBeLessThan(1200);
  });

  it('picks near the target, never a puzzle of this session, unseen ones first', () => {
    const p = choosePuzzle(set, none, { band, recent: [], exclude: new Set(), rand: () => 0 })!;
    expect(Math.abs(p.rating - 920)).toBeLessThanOrEqual(40);
    const seen = new Set(set.filter((x) => x.rating < 1150).map((x) => x.id));
    const q = choosePuzzle(set, (id) => (seen.has(id) ? ({ clean: 1 } as never) : undefined), { band, recent: [], exclude: new Set(), rand: () => 0 })!;
    expect(q.rating).toBeGreaterThanOrEqual(1150);
    const all = new Set(set.map((x) => x.id));
    expect(choosePuzzle(set, none, { band, recent: [], exclude: all })).toBeUndefined();
  });

  it('gives puzzles not yet solved cleanly before ones already mastered', () => {
    const results = new Map(set.map((x) => [x.id, { clean: x.id === 'p39' ? 0 : 1 }]));
    const p = choosePuzzle(set, (id) => results.get(id) as never, { band, recent: [], exclude: new Set() });
    expect(p?.id).toBe('p39');
  });
});

describe('puzzle results on the device', () => {
  const storage = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
  };

  it('a clean solve needs no wrong move and fewer than 3 hints', () => {
    expect(isClean({ solved: true, misses: 0, hints: 2 })).toBe(true);
    expect(isClean({ solved: true, misses: 0, hints: 3 })).toBe(false);
    expect(isClean({ solved: true, misses: 1, hints: 0 })).toBe(false);
    expect(isClean({ solved: false, misses: 0, hints: 0 })).toBe(false);
  });

  it('adds up tries, keeps only pool themes, and survives a reload', () => {
    const s = storage();
    const r = new PuzzleResults(s);
    r.record(KNIGHT, { solved: true, misses: 1, hints: 0 }, 1);
    r.record(KNIGHT, { solved: true, misses: 0, hints: 1 }, 2);
    const back = new PuzzleResults(s).get('XzePZ')!;
    expect(back).toMatchObject({ tries: 2, solved: 2, clean: 1, misses: 1, hintsMax: 1, last: 'clean', lastAt: 2 });
    expect(back.themes).toEqual(['endgame', 'hangingPiece', 'knightEndgame']); // not 'crushing' or 'short'
  });

  it('counts solved and missed puzzles per theme within a band', () => {
    const r = new PuzzleResults(storage());
    r.record(KNIGHT, { solved: true, misses: 1, hints: 0 });
    r.record(SMOTHERED, { solved: true, misses: 0, hints: 0 });
    r.record(MATE1, { solved: false, misses: 0, hints: 0 });
    const p = r.progress(['hangingPiece', 'mateIn1', 'fork'], [600, 800]);
    expect(p.get('hangingPiece')).toEqual({ solved: 1, missed: 1 });
    expect(p.get('mateIn1')).toEqual({ solved: 1, missed: 0 }); // MATE1 (542) is under the band
    expect(p.get('fork')).toEqual({ solved: 0, missed: 0 });
  });

  it('restores a backup, keeping whichever try of a puzzle came last', () => {
    const a = new PuzzleResults(storage());
    a.record(KNIGHT, { solved: false, misses: 2, hints: 0 }, 5);
    const b = new PuzzleResults(storage());
    b.record(KNIGHT, { solved: true, misses: 0, hints: 0 }, 9);
    b.record(MATE1, { solved: true, misses: 0, hints: 0 }, 9);
    expect(a.importAll(b.all())).toBe(2);
    expect(a.get('XzePZ')!.solved).toBe(1);
    expect(a.importAll([{ junk: true }, ...b.all()])).toBe(0);
  });
});

describe('theme names', () => {
  it('reads Lichess theme ids as words', () => {
    expect(themeName('mateIn1')).toBe('Mate in 1');
    expect(themeName('hangingPiece')).toBe('Hanging piece');
    expect(themeName('xRayAttack')).toBe('X-ray attack');
    expect(themeName('attackingF2F7')).toBe('Attacking f2 or f7');
    expect(themeName('veryLong')).toBe('Very long puzzles');
  });
});
