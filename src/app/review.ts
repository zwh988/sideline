// Review of a saved game (live or imported): walking through its moments.
// Pure helpers; the screen is in ui.ts. The coach asks first what the player
// was thinking, and says nothing about whether the move was good until the
// player taps "What happened?" (spec: Modes, Review). Every sentence here is a
// board fact (the move and its number); the verdict is the saved moment's text.
import { Chess } from 'chess.js';
import type { SavedGame, SavedMoment } from './store';
import type { ReviewedGame } from '../coach/review';
import { plyLabel } from './navigation';

export const KIND_LABEL: Record<SavedMoment['kind'], string> = {
  mistake: 'mistake',
  'missed-tactic': 'missed tactic',
  'found-tactic': 'good find',
  'their-tactic': 'their tactic',
  'their-blunder': 'their mistake',
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

/** The pawns a moment cost, as the engine rates it ("3.2"), or undefined when it is small or not a cost. */
export function costText(m: SavedMoment): string | undefined {
  return m.lossCp !== undefined && m.lossCp >= 100 ? (m.lossCp / 100).toFixed(1) : undefined;
}

/**
 * What the coach says at the position before the moment. No verdict and no
 * question about thoughts: the player looks at the position, tries a move in a
 * sideline if they like, or taps "What happened?".
 */
export function reviewPrompt(game: SavedGame, m: SavedMoment): string {
  const san = playedSan(m);
  if (!san) return 'Look at this position. Try a move in a sideline, or tap What happened?';
  const label = plyLabel(game.startFen, m.ply, san);
  const theirs = m.kind === 'their-tactic' || m.kind === 'their-blunder';
  const who = theirs ? (game.imported ? (game.playerColor === 'white' ? game.imported.black : game.imported.white) : undefined) ?? 'your opponent' : 'you';
  return `Here ${who} played ${label}. Look at the position first: what would you do? Try your idea in a sideline, or tap What happened?`;
}

/** The text over the board: where we are in the list, and the kind (and cost) once the answer is shown. */
export function reviewBarText(index: number, total: number, revealed: boolean, m?: SavedMoment): string {
  if (!total) return 'No moments found in this game.';
  if (index < 0) return `${total} moment${total === 1 ? '' : 's'} found`;
  const cost = revealed && m ? costText(m) : undefined;
  return `Moment ${index + 1} of ${total}${revealed && m ? ` · ${KIND_LABEL[m.kind]}${cost ? ` · about ${cost} pawns` : ''}` : ''}`;
}

/** A turning point of the game: the move after which White's evaluation changed most. */
export interface TurningPoint {
  /** Moves played (1-based) once the move was made. */
  ply: number;
  /** The change in White's evaluation across the move, centipawns. */
  swing: number;
}

/** The biggest swings of the evaluation curve (at least `minCp`), most dramatic first. */
export function turningPoints(curve: number[] | undefined, count = 3, minCp = 150): TurningPoint[] {
  if (!curve) return [];
  const all: TurningPoint[] = [];
  for (let i = 1; i < curve.length; i++) all.push({ ply: i, swing: curve[i] - curve[i - 1] });
  return all
    .filter((t) => Math.abs(t.swing) >= minCp)
    .sort((a, b) => Math.abs(b.swing) - Math.abs(a.swing))
    .slice(0, count)
    .sort((a, b) => a.ply - b.ply);
}

/** The labels ("14.Bc4") of the moves of a game, by ply. */
export function moveLabels(game: SavedGame): string[] {
  const chess = new Chess(game.startFen);
  const out: string[] = [];
  for (const uci of game.moves) {
    const san = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }).san;
    out.push(plyLabel(game.startFen, out.length + 1, san));
  }
  return out;
}

/** The coach's opening words for a reviewed game. */
export function reviewIntro(total: number, opponent: string | undefined, turning: string[] = []): string {
  const vs = opponent ? ` against ${opponent}` : '';
  const swings = turning.length ? ` The evaluation swung most at ${turning.join(', ')}.` : '';
  if (!total) return `Here is your game${vs}. I found no moments to look at in it.${swings} Step through the moves with the arrows, or try a sideline from any position.`;
  return `Here is your game${vs}. I found ${total} moment${total === 1 ? '' : 's'} worth a look.${swings} Tap Moment › to go through them, or step through the moves with the arrows.`;
}

/**
 * Puts a fresh analysis into a saved game: the curve, the new moments (what the
 * player chose after a live mistake is kept) and the coach's words for them.
 * Remarks that were not moments (the live game's thinking aloud) stay.
 */
export function mergeAnalysis(game: SavedGame, result: ReviewedGame): void {
  const old = new Map(game.moments.map((m) => [`${m.ply}:${m.played}`, m]));
  game.moments = result.moments.map((m) => {
    const before = old.get(`${m.ply}:${m.played}`);
    return before ? { ...m, ...(before.outcome ? { outcome: before.outcome } : {}), ...(before.showedMe ? { showedMe: true } : {}) } : m;
  });
  game.remarks = [...game.remarks.filter((r) => !r.remark.moment), ...result.remarks].sort((a, b) => a.ply - b.ply);
  game.curve = result.curve;
}
