import { describe, expect, it } from 'vitest';
import { BAD_MOVE_PGN } from './import-fixtures';
import { parseGame, toSavedGame } from './pgnimport';
import { mergeAnalysis, moveLabels, playedSan, reviewBarText, reviewIntro, reviewPrompt, sortedMoments, turningPoints } from './review';
import { SCOTCH_FEN } from './import-fixtures';
import type { SavedMoment } from './store';

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
    mergeAnalysis(g, { moments: [fresh], remarks: [{ ply: 9, remark: { kind: 'mistake', text: fresh.text, mood: 'concerned', moment: fresh } }], curve: [0, 10] });
    expect(g.moments).toEqual([{ ...fresh, outcome: 'taken-back', showedMe: true }]);
    expect(g.remarks.map((r) => r.remark.text)).toEqual(['I am putting a pawn in the centre.', 'You played 5.Bc4. …']);
    expect(g.curve).toEqual([0, 10]);
  });
});
