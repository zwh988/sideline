// The coach's words for one move played in a sideline ("Try a sideline"):
// what the engine says about it, and the concept behind it. The scores and
// refutations come from linecheck.ts (Stockfish, one move at a time); the
// concept sentences from explain.ts (board code). Nothing is worded that
// neither of them found, and when no concept is found the coach says so.
import { Chess } from 'chess.js';
import { conceptNote, HABIT, type NoteConcept } from './explain';
import type { MoveFacts } from './facts';
import type { LineVerdict } from './linecheck';
import { evalPhrase, moveWithWhich, winsPhrase } from './templates';

/**
 * The verdict on the player's move `v.checks[0]`, played from `fenBefore`.
 * `seen` holds the concepts already named this game: a concept's spotting
 * habit is said only the first time.
 */
export function narrateSidelineMove(fenBefore: string, v: LineVerdict, seen: Set<NoteConcept>): string {
  if (v.kind === 'empty') return '';
  const move = v.checks[0].facts;
  const sentences: string[] = [];
  let note: ReturnType<typeof conceptNote>;

  if (v.kind === 'refuted') {
    sentences.push(`${move.san} doesn't hold up.`);
    const after = new Chess(fenBefore);
    after.move({ from: move.from, to: move.to, promotion: move.promotion });
    note = v.reply ? conceptNote(after.fen(), v.reply.uci, 'me') : undefined;
    if (v.refutation && v.reply && v.refutation.moves[0].uci === v.reply.uci) {
      sentences.push(
        v.refutation.mate
          ? `I'd answer with ${v.reply.san}, and it ends in checkmate.`
          : `I'd answer with ${v.reply.san}, winning ${winsPhrase(v.refutation)}.`,
      );
    } else if (v.reply) {
      sentences.push(`I'd answer with ${moveWithWhich(v.reply)}, and the engine then rates the position ${evalPhrase(v.replyCp, 'me')}.`);
      if (!note) sentences.push("I can't name a reason I can check.");
    } else {
      sentences.push(`The engine rates the position ${evalPhrase(v.replyCp, 'me')} after it.`);
    }
  } else if (v.kind === 'good') {
    note = conceptNote(fenBefore, move.uci, 'you');
    if (v.mate) sentences.push('Checkmate!');
    else if (v.allTop) sentences.push(`The engine agrees with ${move.san}.`);
    else if (v.weaker) sentences.push(`${move.san} holds up, though the engine would pick ${moveWithWhich(v.weaker.best)}.`);
    else sentences.push(`The engine finds nothing wrong with ${move.san}.`);
    if (!v.mate && v.won && !note) sentences.push(`It wins ${winsPhrase(v.won)}.`);
  } else {
    return ''; // 'better-reply' needs an opponent move in the line; a sideline checks one move at a time
  }

  if (note) {
    sentences.push(note.text);
    if (!seen.has(note.concept)) {
      seen.add(note.concept);
      sentences.push(HABIT[note.concept]);
    }
  }
  return sentences.join(' ');
}

/** The coach's own move in a sideline: "I'd play Nxd4, which takes the queen." plus the concept, if one is found. */
export function sidelineReplyText(fenBefore: string, f: MoveFacts, seen: Set<NoteConcept>): string {
  const sentences = [`I'd play ${moveWithWhich(f)}.`];
  const note = conceptNote(fenBefore, f.uci, 'me');
  if (note) {
    sentences.push(note.text);
    if (!seen.has(note.concept)) {
      seen.add(note.concept);
      sentences.push(HABIT[note.concept]);
    }
  }
  return sentences.join(' ');
}
