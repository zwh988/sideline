import { describe, expect, it } from 'vitest';
import { BAD_MOVE_PGN } from './import-fixtures';
import { parseGame, toSavedGame } from './pgnimport';
import { playedSan, reviewBarText, reviewIntro, reviewPrompt, sortedMoments } from './review';
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

  it('asks what the player was thinking, with the move number, and gives no verdict', () => {
    const text = reviewPrompt(game, mistake);
    expect(text).toContain('Here you played 5.Bc4. What were you thinking?');
    expect(text).not.toMatch(/mistake|careful|queen|better/i);
    expect(reviewPrompt(game, { ...mistake, played: 'a1a8' })).toBe('What were you thinking here?');
  });

  it('says the kind of moment only after the answer is shown', () => {
    expect(reviewBarText(0, 2, false, mistake)).toBe('Moment 1 of 2');
    expect(reviewBarText(0, 2, true, mistake)).toBe('Moment 1 of 2 · mistake');
    expect(reviewBarText(-1, 2, false)).toBe('2 moments found');
    expect(reviewBarText(-1, 0, false)).toBe('No moments found in this game.');
  });

  it('introduces the game with the number of moments', () => {
    expect(reviewIntro(1, 'rival')).toContain('I found 1 moment worth a look');
    expect(reviewIntro(0, undefined)).toContain('no moments');
  });
});
