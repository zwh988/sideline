// Names the concept behind one move, in words, from board facts only. Each
// sentence states exactly what the board code checked (a double attack, a
// piece lined up behind another, a king boxed in by its own pieces) and
// nothing it didn't (rule 1). Whether the move is good is the engine's call
// and is said elsewhere. `who` is whose move it is: the player's ("you") or
// the coach's ("me").
import { Chess, type Color } from 'chess.js';
import { PIECE_NAME, VALUE, playAndDescribe } from './facts';
import { lineUps } from './motifs';
import { detectConcepts } from './concepts';
import { pieceRef, targetList } from './templates';

export type NoteConcept = 'fork' | 'discoveredAttack' | 'pin' | 'skewer' | 'backRankMate' | 'smotheredMate' | 'loosePiece';

export interface ConceptNote {
  concept: NoteConcept;
  /** "That's a fork: your knight on c7 attacks my king and my rook on a8 at once." */
  text: string;
}

/** A habit that spots the concept next time. Said once per concept per game. */
export const HABIT: Record<NoteConcept, string> = {
  fork: 'Habit: look for a square where one piece can attack two things at once.',
  discoveredAttack: 'Habit: before you move a piece, ask what it is blocking.',
  pin: "Habit: ask which of their pieces can't move because something more valuable stands behind it.",
  skewer: 'Habit: look for checks that line up a more valuable piece with something standing behind it.',
  backRankMate: 'Habit: check that your king has a square to escape to.',
  smotheredMate: 'Habit: a king surrounded by its own pieces is in danger from a knight check.',
  loosePiece: 'Habit: before every move, ask what is undefended.',
};

/** The concept the move shows, worded; nothing when no detector fires. `fenBefore` is the position before `uci`. */
export function conceptNote(fenBefore: string, uci: string, who: 'you' | 'me'): ConceptNote | undefined {
  const before = new Chess(fenBefore);
  const color: Color = before.turn();
  const found = detectConcepts(fenBefore, [uci]);
  const chess = new Chess(fenBefore);
  const m = playAndDescribe(chess, uci);
  const mine = who === 'you';
  const piece = pieceRef(m.piece, m.to, mine);

  if (found.has('smotheredMate')) {
    return { concept: 'smotheredMate', text: "That's a smothered mate: the king is boxed in by its own pieces, so it can't escape the knight's check." };
  }
  if (found.has('backRankMate')) {
    return { concept: 'backRankMate', text: "That's a back-rank mate: the king can't escape because its own pieces block the squares in front of it." };
  }
  if (m.discovered) {
    const d = m.discovered;
    return {
      concept: 'discoveredAttack',
      text: `That's a discovered attack: moving the ${PIECE_NAME[m.piece]} uncovers the ${PIECE_NAME[d.piece]} on ${d.by}, which now attacks the ${PIECE_NAME[d.target.piece]} on ${d.target.square}.`,
    };
  }
  if (m.doubleAttack && !m.mate) {
    return { concept: 'fork', text: `That's a fork: ${piece} attacks ${targetList(m.attacks, !mine)} at once.` };
  }
  for (const l of lineUps(chess, color)) {
    if (l.by !== m.to) continue;
    const front = `the ${PIECE_NAME[l.front.type]} on ${l.front.square}`;
    const back = `the ${PIECE_NAME[l.back.type]} on ${l.back.square}`;
    if (l.kind === 'skewer') {
      return { concept: 'skewer', text: `That's a skewer: ${piece} attacks ${front}, and ${back} is lined up behind it.` };
    }
    if (l.back.type === 'k') {
      return { concept: 'pin', text: `That's a pin: ${piece} attacks ${front}, which is pinned to the king and can't leave that line.` };
    }
    if (VALUE[l.back.type] > VALUE[l.front.type]) {
      return { concept: 'pin', text: `That's a pin: ${piece} attacks ${front}, and moving it would expose ${back}.` };
    }
  }
  if (m.captured && m.capturedUndefended && !m.mate) {
    return { concept: 'loosePiece', text: `That ${PIECE_NAME[m.captured]} was a loose piece: nothing defended it.` };
  }
  return undefined;
}

/** The Lichess-style theme name recorded for a moment, from the motif the line was found under. */
const MOTIF_THEME: Record<string, string | undefined> = {
  'mate-in-1': 'mateIn1',
  'mate-in-2': 'mateIn2',
  mate: 'mate',
  fork: 'fork',
  'discovered-attack': 'discoveredAttack',
  'hanging-piece': 'hangingPiece',
  'winning-material': undefined,
};

/**
 * The concept to record for a move: the one worded by `conceptNote` when a
 * detector fires, else the motif the line was found under. Undefined when
 * neither names anything (the record then says "no concept").
 */
export function conceptOf(fenBefore: string, uci: string, who: 'you' | 'me', motif?: string): string | undefined {
  const note = conceptNote(fenBefore, uci, who);
  if (note) return note.concept === 'loosePiece' ? 'hangingPiece' : note.concept;
  return motif ? MOTIF_THEME[motif] : undefined;
}
