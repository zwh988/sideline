// The coach's words about a moment of a game already played (Review). Every
// sentence is built from the moment's saved facts (the position, the move, the
// engine's line from it) and board code (`explainLine`), in the past tense and
// about both sides: "You played 5.Bc4. After that your opponent can play Nxd4,
// winning a queen for a knight." Nothing here judges a position; when no
// detector found a reason, the text says so (rule 1).
import { Chess, type Color } from 'chess.js';
import { plyLabel } from '../app/navigation';
import { HABIT, type NoteConcept } from './explain';
import { explainLine, taughtFrom } from './lineexplain';
import type { Moment, Shape } from './coach';
import { winsPhrase } from './templates';

export interface WordsContext {
  /** The game's start position, for move numbers. */
  startFen: string;
  /** The player's colour (the one called "you"). */
  me: Color;
  /** The opponent's name, if the game has one. */
  opponent?: string;
  /** Concepts whose habit was already said in this game. */
  seen: Set<NoteConcept>;
}

/** A moment's concept (a Lichess theme) as the habit it belongs to. */
const HABIT_OF: Record<string, NoteConcept | undefined> = {
  hangingPiece: 'loosePiece',
  loosePiece: 'loosePiece',
  fork: 'fork',
  discoveredAttack: 'discoveredAttack',
  pin: 'pin',
  skewer: 'skewer',
  backRankMate: 'backRankMate',
  smotheredMate: 'smotheredMate',
  trappedPiece: 'trappedPiece',
  capturingDefender: 'capturingDefender',
  sacrifice: 'sacrifice',
};

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const pawns = (cp: number) => (Math.abs(cp) / 100).toFixed(1);

/** The text and arrows for one moment (`ply` = moves played once the player's or opponent's move was made). */
export function momentWords(m: Moment, ply: number, ctx: WordsContext): { text: string; shapes: Shape[] } {
  const before = new Chess(m.fen);
  const move = before.move({ from: m.played.slice(0, 2), to: m.played.slice(2, 4), promotion: m.played[4] });
  const fenAfter = before.fen();
  const label = plyLabel(ctx.startFen, ply, move.san);
  const opp = ctx.opponent ?? 'your opponent';
  const previous = { fen: m.fen, uci: m.played };
  const sentences: string[] = [];
  const shapes: Shape[] = [];

  /** What a line wins: "winning a rook and a pawn" / "ending in checkmate" / "" when material doesn't change. */
  const winning = (fen: string, ucis: string[]) => {
    const t = taughtFrom(fen, ucis);
    return !t ? '' : t.mate ? 'ending in checkmate' : t.gain >= 1 ? `winning ${winsPhrase(t)}` : '';
  };
  const wins = (fen: string, ucis: string[]) => (winning(fen, ucis) ? `, ${winning(fen, ucis)}` : '');
  const itWins = (fen: string, ucis: string[]) => {
    const t = taughtFrom(fen, ucis);
    return !t ? '' : t.mate ? ' It ends in checkmate.' : t.gain >= 1 ? ` It wins ${winsPhrase(t)}.` : '';
  };
  const sans = (fen: string, ucis: string[]) => explainLine(fen, ucis, { player: ctx.me, voice: 'review' }).map((s) => s.san).join(' ');
  /**
   * The concept sentences of a line: the first steps that name something (the idea is in the first
   * moves; later ones are follow-up), at most two, and the concept the habit belongs to.
   */
  const concepts = (fen: string, ucis: string[], prev?: typeof previous) => {
    const named = explainLine(fen, ucis, { player: ctx.me, voice: 'review', previous: prev })
      .slice(0, 3)
      .filter((s) => s.concept && s.text)
      .slice(0, 2);
    // Each sentence says which move of the line it is about: a later move is not on the board yet.
    const lower = (t: string) => t.charAt(0).toLowerCase() + t.slice(1);
    return { texts: named.map((s) => `${s.san}: ${lower(s.text)}`), first: named[0]?.concept as string | undefined };
  };
  const habit = (concept: string | undefined) => {
    const h = concept ? HABIT_OF[concept] : undefined;
    if (h && !ctx.seen.has(h)) {
      ctx.seen.add(h);
      sentences.push(HABIT[h]);
    }
  };
  const beyond = () => {
    if (m.beyond) sentences.push('This idea is a little beyond the patterns your level usually trains, but it was there.');
  };
  const slip = m.prompted ? `After ${opp === 'your opponent' ? 'their' : `${opp}'s`} mistake, you` : 'You';

  switch (m.kind) {
    case 'mistake': {
      sentences.push(`${slip} played ${label}.`);
      if (m.answer?.length) {
        const first = m.answer[0];
        const firstSan = sans(fenAfter, [first]);
        sentences.push(`After that, ${opp} can play ${firstSan}${wins(fenAfter, m.answer)}.`);
        if (m.answer.length > 1 && m.answer.length <= 4) sentences.push(`The line runs ${sans(fenAfter, m.answer)}.`);
        const c = concepts(fenAfter, m.answer, previous);
        sentences.push(...c.texts);
        shapes.push({ orig: first.slice(0, 2) as never, dest: first.slice(2, 4) as never, brush: 'red' });
        if (m.line?.length) sentences.push(`The engine preferred ${sans(m.fen, m.line)}.`);
        habit(c.first);
      } else if (m.line?.length) {
        sentences.push(`The engine preferred ${sans(m.fen, m.line)}, about ${pawns(m.lossCp ?? 0)} pawns better for you. I can't name a reason I can check.`);
      }
      beyond();
      break;
    }
    case 'missed-tactic': {
      const line = m.line ?? [];
      sentences.push(`${slip} played ${label}, but you had something stronger: ${sans(m.fen, line)}${wins(m.fen, line)}.`);
      const c = concepts(m.fen, line);
      sentences.push(...c.texts);
      habit(c.first);
      beyond();
      break;
    }
    case 'found-tactic': {
      const line = m.line ?? [m.played];
      sentences.push(`Good find: ${label}.${m.prompted ? ' Your opponent had just given something away.' : ''}${itWins(m.fen, line)}`);
      const c = concepts(m.fen, line, undefined);
      sentences.push(...c.texts);
      habit(c.first);
      break;
    }
    case 'their-tactic': {
      const line = m.line ?? [m.played];
      sentences.push(`${cap(opp)} played ${label}.${itWins(m.fen, line)}`);
      const c = concepts(m.fen, line, undefined);
      sentences.push(...c.texts);
      habit(c.first);
      beyond();
      break;
    }
    case 'their-blunder': {
      sentences.push(`${cap(opp)} played ${label}, which the engine rates about ${pawns(m.lossCp ?? 0)} pawns worse than ${m.better ? sans(m.fen, [m.better]) : 'the best move'}.`);
      if (m.line?.length) {
        sentences.push(`You could have punished it with ${sans(fenAfter, m.line)}${wins(fenAfter, m.line)}.`);
        const c = concepts(fenAfter, m.line);
        sentences.push(...c.texts);
        habit(c.first);
      } else {
        sentences.push("I can't name a reason I can check.");
      }
      beyond();
      break;
    }
  }
  return { text: sentences.filter(Boolean).join(' '), shapes };
}
