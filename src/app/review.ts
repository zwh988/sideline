// Review of a saved game (live or imported): walking through its moments.
// Pure helpers; the screen is in ui.ts. The coach asks first what the player
// was thinking, and says nothing about whether the move was good until the
// player taps "What happened?" (spec: Modes, Review). Every sentence here is a
// board fact (the move and its number); the verdict is the saved moment's text.
import { Chess } from 'chess.js';
import type { SavedGame, SavedMoment } from './store';
import { plyLabel } from './navigation';

export const KIND_LABEL: Record<SavedMoment['kind'], string> = {
  mistake: 'mistake',
  'missed-tactic': 'missed tactic',
  'found-tactic': 'good find',
};

/** The game's moments in the order they happened (a takeback can leave them out of order). */
export function sortedMoments(game: SavedGame): SavedMoment[] {
  return [...game.moments].filter((m) => m.ply >= 1 && m.ply <= game.moves.length).sort((a, b) => a.ply - b.ply);
}

/** The move the player made at this moment, in SAN ("Bc4"), or undefined if the record doesn't fit. */
export function playedSan(m: SavedMoment): string | undefined {
  try {
    return new Chess(m.fen).move({ from: m.played.slice(0, 2), to: m.played.slice(2, 4), promotion: m.played[4] }).san;
  } catch {
    return undefined;
  }
}

/** What the coach says at the position before the moment: the question, no verdict. */
export function reviewPrompt(game: SavedGame, m: SavedMoment): string {
  const san = playedSan(m);
  if (!san) return 'What were you thinking here?';
  const label = plyLabel(game.startFen, m.ply, san);
  return `Here you played ${label}. What were you thinking? Try your idea in a sideline, or tap What happened?`;
}

/** The text over the board: where we are in the list, and the kind once the answer is shown. */
export function reviewBarText(index: number, total: number, revealed: boolean, m?: SavedMoment): string {
  if (!total) return 'No moments found in this game.';
  if (index < 0) return `${total} moment${total === 1 ? '' : 's'} found`;
  return `Moment ${index + 1} of ${total}${revealed && m ? ` · ${KIND_LABEL[m.kind]}` : ''}`;
}

/** The coach's opening words for a reviewed game. */
export function reviewIntro(total: number, opponent: string | undefined): string {
  const vs = opponent ? ` against ${opponent}` : '';
  if (!total) return `Here is your game${vs}. I found no moments to look at in it. Step through the moves with the arrows, or try a sideline from any position.`;
  return `Here is your game${vs}. I found ${total} moment${total === 1 ? '' : 's'} worth a look. Tap Next moment to go through them, or step through the moves with the arrows.`;
}
