// Template sentences: fixed wording filled from board facts. This is the
// coach's main voice (feasibility test 3 showed small AI models still get
// facts wrong); an AI model may later rephrase, never add facts.
import type { PieceSymbol, Square } from 'chess.js';
import { PIECE_NAME, VALUE, type MoveFacts, type Target } from './facts';
import type { Motif, TaughtLine } from './lines';

const a = (p: PieceSymbol) => `a ${PIECE_NAME[p]}`;
const listAnd = (items: string[]) =>
  items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;

/** "your knight on d5" / "my rook on a8", from the player's point of view. */
export function pieceRef(piece: PieceSymbol, square: Square, mine: boolean): string {
  return `${mine ? 'your' : 'my'} ${PIECE_NAME[piece]} on ${square}`;
}

/** King first, then the most valuable pieces. */
export function byImportance(targets: Target[]): Target[] {
  const rank = (t: Target) => (t.piece === 'k' ? 100 : VALUE[t.piece]);
  return [...targets].sort((x, y) => rank(y) - rank(x));
}

export function targetList(targets: Target[], mine: boolean): string {
  return listAnd(byImportance(targets).map((t) => pieceRef(t.piece, t.square, mine)));
}

/** What the line wins, from the pieces actually captured: "a rook and a pawn for a bishop". */
export function winsPhrase(line: TaughtLine): string {
  if (line.mate) return 'checkmate';
  const won: PieceSymbol[] = [];
  const lost: PieceSymbol[] = [];
  for (const m of line.moves) {
    if (!m.captured) continue;
    (m.color === line.side ? won : lost).push(m.captured);
  }
  // Cancel equal trades (e.g. a knight for a knight) so only the net result is named.
  for (let i = won.length - 1; i >= 0; i--) {
    const j = lost.indexOf(won[i]);
    if (j >= 0) {
      lost.splice(j, 1);
      won.splice(i, 1);
    }
  }
  const byValue = (x: PieceSymbol, y: PieceSymbol) => VALUE[y] - VALUE[x];
  const w = listAnd(won.sort(byValue).map(a));
  const l = listAnd(lost.sort(byValue).map(a));
  if (!w) return 'material';
  return l ? `${w} for ${l}` : w;
}

/** A short description of what one move does, from facts only: "Nxc7+ attacks …". */
export function describeMove(m: MoveFacts): string {
  const what = moveEffects(m);
  return what ? `${m.san} ${what}` : m.san;
}

/** The same as a clause, for use after a verb: "Nxc7+, which attacks …". */
export function moveWithWhich(m: MoveFacts): string {
  const what = moveEffects(m);
  return what ? `${m.san}, which ${what}` : m.san;
}

function moveEffects(m: MoveFacts): string {
  const parts: string[] = [];
  if (m.mate) return 'is checkmate';
  if (m.doubleAttack) {
    const names = byImportance(m.attacks).map((t) => `the ${PIECE_NAME[t.piece]}`);
    parts.push(`attacks ${listAnd(names)} at once`);
  } else if (m.check) {
    parts.push('gives check');
  }
  if (m.discovered) {
    parts.push(`opens an attack by the ${PIECE_NAME[m.discovered.piece]} on the ${PIECE_NAME[m.discovered.target.piece]}`);
  }
  if (m.captured && !parts.length) {
    parts.push(m.capturedUndefended ? `takes the ${PIECE_NAME[m.captured]} for free` : `takes the ${PIECE_NAME[m.captured]}`);
  }
  return listAnd(parts);
}

/** Narrates a taught line: "Nxc7+ attacks the king and the rook at once. After Kd7 (forced), Nxa8 wins a rook and a pawn." */
export function narrateLine(line: TaughtLine): string {
  const [first, ...rest] = line.moves;
  const sentences = [capitalize(describeMove(first)) + '.'];
  for (let i = 0; i < rest.length; i += 2) {
    const reply = rest[i];
    const follow = rest[i + 1];
    const replyText = `${reply.san}${reply.forced ? ' (forced)' : ''}`;
    if (follow) sentences.push(`After ${replyText}, ${describeMove(follow)}.`);
    else sentences.push(`Then ${replyText}.`);
  }
  if (!line.mate) sentences.push(`That wins ${winsPhrase(line)}.${givesBackNote(line)}`);
  return sentences.join(' ');
}

/** Honest caveat when the engine's line loses some of the gain later. */
function givesBackNote(line: TaughtLine): string {
  return line.laterLoss >= 1 ? ' Watch your pieces afterwards: you may give some of it back.' : '';
}

export const MOTIF_NAME: Record<Motif, string> = {
  'mate-in-1': 'mate in one',
  'mate-in-2': 'mate in two',
  mate: 'a mating attack',
  fork: 'fork',
  'discovered-attack': 'discovered attack',
  'hanging-piece': 'loose piece',
  'winning-material': 'tactic',
};

/** Short praise that names the pattern (spec: "Nice, that pin wins material."). */
export function praise(line: TaughtLine): string {
  switch (line.motif) {
    case 'mate-in-1':
    case 'mate-in-2':
    case 'mate':
      return `Nice, you found ${MOTIF_NAME[line.motif]}!`;
    case 'hanging-piece':
      // Free only if nobody defended it; otherwise name the trade honestly.
      return line.moves[0].capturedUndefended
        ? `Good eye: that ${PIECE_NAME[line.moves[0].captured!]} was free.`
        : `Good eye: that wins ${winsPhrase(line)}.`;
    default:
      return `Nice, that ${MOTIF_NAME[line.motif]} wins ${winsPhrase(line)}.${givesBackNote(line)}`;
  }
}

export function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
