// Template sentences: fixed wording filled from board facts. This is the
// coach's main voice (feasibility test 3 showed small AI models still get
// facts wrong); an AI model may later rephrase, never add facts.
import type { PieceSymbol, Square } from 'chess.js';
import { PIECE_NAME, VALUE, type FailedRecapture, type MoveFacts, type Target } from './facts';
import type { Motif, TaughtLine } from './lines';
import type { CoachMoveFacts, Intent } from './narration';

const a = (p: PieceSymbol) => `a ${PIECE_NAME[p]}`;
const listAnd = (items: string[]) =>
  items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;

/**
 * "your knight on d5" / "my rook on a8", from the player's point of view.
 * `opp` is how the other side is called: "my" when the coach is the opponent,
 * "their" when the coach looks back at a game against someone else.
 */
export function pieceRef(piece: PieceSymbol, square: Square, mine: boolean, opp: 'my' | 'their' = 'my'): string {
  return `${mine ? 'your' : opp} ${PIECE_NAME[piece]} on ${square}`;
}

/** King first, then the most valuable pieces. */
export function byImportance(targets: Target[]): Target[] {
  const rank = (t: Target) => (t.piece === 'k' ? 100 : VALUE[t.piece]);
  return [...targets].sort((x, y) => rank(y) - rank(x));
}

export function targetList(targets: Target[], mine: boolean, opp: 'my' | 'their' = 'my'): string {
  return listAnd(byImportance(targets).map((t) => pieceRef(t.piece, t.square, mine, opp)));
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

/** Why taking back doesn't help: "if you recapture with Qxd4, I take your queen with Qxd4". */
export function failedRecapturePhrase(f: FailedRecapture): string {
  return `if you recapture with ${f.recapture.san}, I take your ${PIECE_NAME[f.recapture.piece]} with ${f.reply.san}`;
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
  skewer: 'skewer',
  pin: 'pin',
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

// --- The coach thinking aloud on its own moves -----------------------------
// Honest narration (spec): the coach plays human-like moves at the player's
// level, so it states what its move does and why, never that it is good.

export type NarrationPriority = 'high' | 'medium' | 'low';

export interface Narration {
  text: string;
  priority: NarrationPriority;
  /** What the narration is about, for "say this only once or twice a game" limits. */
  topic: 'threat' | 'capture' | 'promotion' | Intent;
}

/**
 * The coach's own move in words, from facts only. Most important first:
 * how it answered the player's threat, then captures and promotions, then
 * the idea behind a quiet move. Returns nothing for moves with nothing to say.
 */
export function narrateCoachMove(f: CoachMoveFacts): Narration | undefined {
  const m = f.move;
  if (m.mate) return undefined; // the game screen announces the result

  if (f.threat) {
    return { text: `${threatSentence(f)} ${handledSentence(f)}`, priority: 'high', topic: 'threat' };
  }

  const sentences: string[] = [];
  if (m.captured) sentences.push(captureSentence(f));
  if (m.promotion) sentences.push(`My pawn becomes a ${PIECE_NAME[m.promotion]}.`);
  if (sentences.length) {
    return { text: sentences.join(' '), priority: 'medium', topic: m.captured ? 'capture' : 'promotion' };
  }

  // A purposeful-sounding reason for a clear mistake would read as approval.
  if (f.intent && f.quality !== 'mistake') {
    return { text: intentSentence(f.intent, m), priority: 'low', topic: f.intent };
  }
  return undefined;
}

function threatSentence(f: CoachMoveFacts): string {
  const line = f.threat!.line;
  const first = line.moves[0];
  // The threat is in the position; the last move didn't necessarily create it.
  const who = f.lastMove ? `After your ${f.lastMove.san}, you were` : 'You were';
  if (line.mate) {
    return line.motif === 'mate-in-1'
      ? `${who} threatening checkmate with ${first.san}.`
      : `${who} threatening a mating attack, starting with ${first.san}.`;
  }
  return `${who} threatening to win ${winsPhrase(line)} with ${first.san}.`;
}

function handledSentence(f: CoachMoveFacts): string {
  const { handled, victim, line } = f.threat!;
  const first = line.moves[0];
  const san = f.move.san;
  switch (handled) {
    case 'took-attacker':
      return `So I took your ${PIECE_NAME[first.piece]} on ${first.from} first.`;
    case 'moved':
      return `${san} moves my ${PIECE_NAME[victim!.piece]} out of danger.`;
    case 'defended':
      return `${san} defends my ${PIECE_NAME[victim!.piece]} on ${victim!.square}.`;
    case 'blocked':
      return `${san} blocks it.`;
    case 'other':
      return `${san} stops that.`;
  }
}

function captureSentence(f: CoachMoveFacts): string {
  const m = f.move;
  const check = m.check ? ', with check' : '';
  if (f.recapture) return `I take back on ${m.to}${check}.`;
  if (f.capturedOn && f.capturedOn !== m.to) return `I take your pawn on ${f.capturedOn} en passant${check}.`;
  const what = `your ${PIECE_NAME[m.captured!]} on ${f.capturedOn ?? m.to}`;
  if (m.capturedUndefended) return `${capitalize(what)} wasn't defended, so I took it${check}.`;
  return `I take ${what}${check}.`;
}

function intentSentence(intent: Intent, m: MoveFacts): string {
  switch (intent) {
    case 'castle':
      return "I'm castling, so my king leaves the centre.";
    case 'develop':
      return `I'm bringing my ${PIECE_NAME[m.piece]} out to ${m.to}.`;
    case 'centre-pawn':
      return `I'm putting a pawn in the centre, on ${m.to}.`;
  }
}

// --- Engine scores in words (sideline verdicts are in sideline.ts) ---------
// Numbers are the engine's, stated as such; the move facts are board code.

/** An engine score from the point of view of `who` ("you" or "me"): "+1.4 for you", "a forced mate for me". */
export function evalPhrase(cp: number, who: 'you' | 'me' = 'you'): string {
  if (Math.abs(cp) >= 90000) return `a forced mate for ${(cp > 0) === (who === 'you') ? 'you' : 'me'}`;
  return `${signed(cp)} for ${who}`;
}

function signed(cp: number): string {
  const pawns = (Math.abs(cp) / 100).toFixed(1);
  return cp >= 5 ? `+${pawns}` : cp <= -5 ? `-${pawns}` : '0.0';
}
