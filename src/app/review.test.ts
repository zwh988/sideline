import { describe, expect, it } from 'vitest';
import { BAD_MOVE_PGN } from './import-fixtures';
import { parseGame, toSavedGame } from './pgnimport';
import { gameStats, momentDot, momentUniverses, mergeAnalysis, moveLabels, needsAnalysis, playedSan, reviewableGames, reviewBarText, reviewIntro, reviewPrompt, sortedMoments, turningPoints } from './review';
import { REVIEW_VERSION } from '../coach/review';
import { SCOTCH_FEN } from './import-fixtures';
import type { SavedGame, SavedMoment } from './store';

const game = toSavedGame(parseGame(BAD_MOVE_PGN), 'white', 2, 'lichess');
const mistake: SavedMoment = { kind: 'mistake', fen: SCOTCH_FEN, played: 'f1c4', better: 'c6d4', ply: 9, text: 'Careful: …' };
game.moments = [{ ...mistake, ply: 11 }, mistake, { ...mistake, ply: 99 }];

describe('review helpers', () => {
  it('orders moments by ply and drops ones outside the game', () => {
    expect(sortedMoments(game).map((m) => m.ply)).toEqual([9, 11]);
  });

  it('names the played move in SAN, or nothing for a record that does not fit', () => {
    expect(playedSan(mistake)).toBe('Bc4');
    expect(playedSan({ ...mistake, played: 'a1a8' })).toBeUndefined();
  });

  it('names the move with its number, gives no verdict and does not ask what the player was thinking', () => {
    const text = reviewPrompt(game, mistake);
    expect(text).toContain('Here you played 5.Bc4. Look at the position first');
    expect(text).not.toMatch(/mistake|careful|queen|better|thinking/i);
    expect(reviewPrompt(game, { ...mistake, played: 'a1a8' })).toBe('Look at this position. Try a move in a sideline, or tap What happened?');
    expect(reviewPrompt(game, { ...mistake, kind: 'their-tactic' })).toContain('Here rival played 5.Bc4.');
  });

  it('says the kind of moment only after the answer is shown', () => {
    expect(reviewBarText(0, 2, false, mistake)).toBe('Moment 1 of 2');
    expect(reviewBarText(0, 2, true, mistake)).toBe('Moment 1 of 2 · mistake');
    expect(reviewBarText(0, 2, true, { ...mistake, lossCp: 640 })).toBe('Moment 1 of 2 · mistake · about 6.4 pawns');
    expect(reviewBarText(-1, 2, false)).toBe('2 moments found');
    expect(reviewBarText(-1, 0, false)).toBe('No moments found in this game.');
  });

  it('introduces the game with the number of moments and where it swung', () => {
    expect(reviewIntro(1, 'rival')).toContain('I found 1 moment worth a look');
    expect(reviewIntro(0, undefined)).toContain('no moments');
    expect(reviewIntro(2, undefined, ['5.Bc4', '9…Nxd4'])).toContain('The evaluation swung most at 5.Bc4, 9…Nxd4.');
  });

  it('finds the turning points of a curve: the biggest swings, in game order, none below 1.5 pawns', () => {
    const curve = [0, 20, 40, -560, -600, -100, -150, -1000];
    expect(turningPoints(curve)).toEqual([
      { ply: 3, swing: -600 },
      { ply: 5, swing: 500 },
      { ply: 7, swing: -850 },
    ]);
    expect(turningPoints([0, 50, 100, 120])).toEqual([]);
    expect(turningPoints(undefined)).toEqual([]);
  });

  it('labels the moves of a game by ply', () => {
    expect(moveLabels(game).slice(0, 4)).toEqual(['1.e4', '1…e5', '2.Nf3', '2…d6']);
  });

  it('merges an analysis: new moments and words, the live outcome kept, thinking-aloud remarks kept', () => {
    const g = toSavedGame(parseGame(BAD_MOVE_PGN), 'white', 2, 'lichess');
    g.moments = [{ ...mistake, outcome: 'taken-back', showedMe: true }];
    g.remarks = [
      { ply: 3, remark: { kind: 'narration', text: 'I am putting a pawn in the centre.', mood: 'thinking' } },
      { ply: 9, remark: { kind: 'mistake', text: 'Careful: after Bc4…', mood: 'concerned', moment: { kind: 'mistake', fen: SCOTCH_FEN, played: 'f1c4' } } },
    ];
    const fresh = { ...mistake, text: 'You played 5.Bc4. …' };
    mergeAnalysis(g, { moments: [fresh], remarks: [{ ply: 9, remark: { kind: 'mistake', text: fresh.text, mood: 'concerned', moment: fresh } }], curve: [0, 10], labels: ['best'] });
    expect(g.labels).toEqual(['best']);
    expect(g.moments).toEqual([{ ...fresh, outcome: 'taken-back', showedMe: true }]);
    expect(g.remarks.map((r) => r.remark.text)).toEqual(['I am putting a pawn in the centre.', 'You played 5.Bc4. …']);
    expect(g.curve).toEqual([0, 10]);
  });
});

describe('momentUniverses', () => {
  it('a mistake: what happened (with their answer) and what the engine wanted', () => {
    expect(momentUniverses({ ...mistake, answer: ['c6d4', 'f3d4'], line: ['d4a4'] })).toEqual([
      { label: 'What happened', ucis: ['f1c4', 'c6d4', 'f3d4'] },
      { label: 'What the engine wanted', ucis: ['d4a4'] },
    ]);
  });
  it('a missed tactic, a found tactic and their blunder', () => {
    expect(momentUniverses({ ...mistake, kind: 'missed-tactic', line: ['a1a2', 'a8a7'] }).map((u) => u.label)).toEqual(['What happened', 'The tactic']);
    expect(momentUniverses({ ...mistake, kind: 'found-tactic', line: ['d5c7'] })).toEqual([{ label: 'What happened', ucis: ['d5c7'] }]);
    expect(momentUniverses({ ...mistake, kind: 'their-blunder', better: 'h2h3', line: ['x1x2'] })[1]).toEqual({ label: 'What they should have played', ucis: ['h2h3'] });
  });
});

describe('the timeline dots', () => {
  it('marks moments like the board badges', () => {
    expect(momentDot({ kind: 'mistake', lossCp: 150 })).toEqual({ glyph: '?', tone: 'bad' });
    expect(momentDot({ kind: 'mistake', lossCp: 450 })).toEqual({ glyph: '??', tone: 'blunder' });
    expect(momentDot({ kind: 'missed-tactic', lossCp: undefined })).toEqual({ glyph: '?', tone: 'bad' });
    expect(momentDot({ kind: 'found-tactic' })).toEqual({ glyph: '!', tone: 'good' });
    expect(momentDot({ kind: 'their-tactic' }).tone).toBe('theirs');
    expect(momentDot({ kind: 'their-blunder' }).tone).toBe('theirs');
  });

  it('the intro carries the game summary', () => {
    const text = reviewIntro(3, undefined, [], '3 moments. You took back 2 moves, both on loose pieces.');
    expect(text).toContain('You took back 2 moves, both on loose pieces.');
    expect(text).toContain('a dot on the line');
    expect(text).not.toContain('3 moments.'); // the count is already said once
  });
});

describe('Game review list and accuracy', () => {
  const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  const base = (over: Partial<SavedGame>): SavedGame => ({
    version: 1, id: 'x', startedAt: 0, updatedAt: 0, startFen: START, playerColor: 'white', level: 2, mode: 'lesson',
    moves: ['e2e4'], remarks: [], sidelines: [], moments: [], hintsUsed: 0, ...over,
  });

  it('lists finished games only, newest first', () => {
    const games = [
      base({ id: 'old', startedAt: 1, result: { winner: 'white', reason: 'checkmate' } }),
      base({ id: 'open', startedAt: 3 }),
      base({ id: 'new', startedAt: 2, result: { winner: null, reason: 'stalemate' } }),
      base({ id: 'empty', startedAt: 4, moves: [], result: { winner: 'black', reason: 'resign' } }),
    ];
    expect(reviewableGames(games).map((g) => g.id)).toEqual(['new', 'old']);
  });

  it('a level game played perfectly is 100% for both sides', () => {
    const s = gameStats([20, 20, 20, 20], START)!;
    expect(s.white).toMatchObject({ accuracy: 100, moves: 2, counts: {} });
    expect(s.black).toMatchObject({ accuracy: 100, moves: 1 });
  });

  it("a blunder counts against the side that made it, and pulls its accuracy down", () => {
    // White keeps +0.2; Black's move drops from +0.2 to +5.0 for White.
    const s = gameStats([20, 20, 500, 500, 500], START, ['best', 'blunder', 'best', 'excellent'])!;
    expect(s.black.counts).toEqual({ blunder: 1, excellent: 1 });
    expect(s.white.counts).toEqual({ best: 2 });
    expect(s.white.accuracy).toBe(100);
    expect(s.black.accuracy).toBeLessThan(60);
  });

  it('starts with Black when the position does', () => {
    const s = gameStats([0, 600], '4k3/8/8/8/8/8/4P3/4K3 b - - 0 1', ['blunder'])!;
    expect(s.black.counts.blunder).toBe(1);
    expect(s.white.moves).toBe(0);
  });

  it('a stale or missing analysis needs doing again', () => {
    expect(needsAnalysis(base({}))).toBe(true);
    expect(needsAnalysis(base({ curve: [0, 0], labels: ['book'], reviewVersion: REVIEW_VERSION }))).toBe(false);
    expect(needsAnalysis(base({ curve: [0, 0], labels: ['book'], reviewVersion: REVIEW_VERSION - 1 }))).toBe(true);
    expect(needsAnalysis(base({ curve: [0, 0], reviewVersion: REVIEW_VERSION }))).toBe(true); // no labels yet
  });
});
