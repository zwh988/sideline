// Names the concept behind one move, in words, from board facts only. Each
// sentence states exactly what the board code checked (a double attack, a
// piece lined up behind another, a king boxed in by its own pieces) and
// nothing it didn't (rule 1). Whether the move is good is the engine's call
// and is said elsewhere. `who` is whose move it is: the player's ("you") or
// the coach's ("me").
import { Chess, type Color, type PieceSymbol } from 'chess.js';
import { PIECE_NAME, VALUE, other, playAndDescribe } from './facts';
import { detectConcepts, type PreviousMove } from './concepts';
import { defendedBy, lineUps, trappedPieces } from './motifs';
import { pieceRef, targetList } from './templates';

export type NoteConcept =
  | 'fork'
  | 'discoveredAttack'
  | 'pin'
  | 'skewer'
  | 'backRankMate'
  | 'smotheredMate'
  | 'loosePiece'
  | 'trappedPiece'
  | 'capturingDefender'
  | 'sacrifice';

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
  trappedPiece: 'Habit: look for enemy pieces with no safe square to go to, then attack them.',
  capturingDefender: 'Habit: when a piece is guarded, ask what happens if you take its guard.',
  sacrifice: 'Habit: when you offer material, know exactly what you get for it.',
};

/** The concept the move shows, worded; nothing when no detector fires. `fenBefore` is the position before `uci`. */
export function conceptNote(fenBefore: string, uci: string, who: 'you' | 'me', opp: 'my' | 'their' = 'my'): ConceptNote | undefined {
  const before = new Chess(fenBefore);
  const color: Color = before.turn();
  const found = detectConcepts(fenBefore, [uci]);
  const chess = new Chess(fenBefore);
  const m = playAndDescribe(chess, uci);
  const mine = who === 'you';
  const piece = pieceRef(m.piece, m.to, mine, opp);

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
    // An x-ray: behind one of the forked pieces, on the forking piece's line, stands a bigger piece.
    const xray = lineUps(chess, color).find(
      (l) => l.by === m.to && l.kind === 'pin' && l.back.type !== 'k' && m.attacks.some((t) => t.square === l.front.square),
    );
    const behind = xray
      ? `, and behind the ${PIECE_NAME[xray.front.type]} on ${xray.front.square} stands ${pieceRef(xray.back.type, xray.back.square, !mine, opp)}`
      : '';
    return { concept: 'fork', text: `That's a fork: ${piece} attacks ${targetList(m.attacks, !mine, opp)} at once${behind}.` };
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
  // A piece that is attacked and has nowhere safe to go (the board shows it; whether it is won is the engine's call).
  const trapped = trappedPieces(chess, color).sort((x, y) => VALUE[y.type] - VALUE[x.type])[0];
  if (trapped) {
    return {
      concept: 'trappedPiece',
      text: `That traps ${pieceRef(trapped.type, trapped.square, !mine, opp)}: it is attacked and has no safe square to go to.`,
    };
  }
  // Taking a guard: the captured piece defended another, which is now undefended.
  if (m.captured) {
    const enemy = other(color);
    const left = defendedBy(before, m.to, enemy).find((d) => VALUE[d.type] >= 3 && chess.attackers(d.square, enemy).length === 0);
    if (left) {
      return {
        concept: 'capturingDefender',
        text: `That takes the only defender of ${pieceRef(left.type, left.square, !mine, opp)}: it is now undefended.`,
      };
    }
  }
  // Offering material: the moved piece can be taken at once and is worth at least two pawns more than what it took.
  const offer = offeredMaterial(fenBefore, uci);
  if (offer) {
    const worth = offer.won ? `, and it is worth more than the ${PIECE_NAME[offer.won]} it takes` : '';
    return {
      concept: 'sacrifice',
      text: `That offers material: ${pieceRef(offer.offered, m.to, mine, opp)} can be taken${worth}.`,
    };
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
  skewer: 'skewer',
  pin: 'pin',
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

/**
 * The move offers material (board facts only): the other side can take the
 * moved piece, and the mover can't win back as much on that square (counting
 * the move's own capture, and at most one recapture of the taker). Whether the
 * taker should take is the engine's business.
 */
export function offeredMaterial(fenBefore: string, uci: string): { offered: PieceSymbol; won?: PieceSymbol } | undefined {
  const chess = new Chess(fenBefore);
  const move = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
  const takesOn = () => chess.moves({ verbose: true }).filter((m) => m.to === move.to && m.captured);
  const take = takesOn().sort((x, y) => VALUE[x.piece] - VALUE[y.piece])[0];
  if (!take) return undefined;
  const offered = (move.promotion ?? move.piece) as PieceSymbol;
  const won = move.captured as PieceSymbol | undefined;
  chess.move(take);
  const back = takesOn().length ? VALUE[take.piece] : 0;
  if ((won ? VALUE[won] : 0) - VALUE[offered] + back > -1) return undefined;
  return { offered, won };
}

/** Which concept to record when a line shows several: the most specific first. */
const RECORD_ORDER = [
  'smotheredMate',
  'backRankMate',
  'attraction',
  'deflection',
  'skewer',
  'pin',
  'intermezzo',
  'fork',
  'discoveredAttack',
  'doubleCheck',
  'trappedPiece',
  'capturingDefender',
  'mateIn1',
  'mateIn2',
  'mateIn3',
  'mateIn4',
  'mateIn5',
  'sacrifice',
  'hangingPiece',
  'promotion',
] as const;

/**
 * The concept to record for a whole line (a refutation, or a tactic the
 * player found or missed): the most specific one the detectors find in it,
 * else what `conceptOf` says about its first move. `ucis` start with the
 * move of the side to move at `fen`; `previous` is the opponent's last move
 * when known.
 */
export function lineConceptOf(fen: string, ucis: string[], previous?: PreviousMove, motif?: string): string | undefined {
  // A line found as a loose-piece win (a capture the opponent can't answer) is recorded as that, unless a
  // more specific tactic is in it: the weak "side" concepts would hide the lesson.
  const weak = ['trappedPiece', 'capturingDefender', 'sacrifice', 'loosePiece'];
  const keepLoose = (c: string | undefined) => (motif === 'hanging-piece' && (!c || weak.includes(c)) ? 'hangingPiece' : c);
  try {
    const found = detectConcepts(fen, ucis, previous);
    const pick = RECORD_ORDER.find((c) => found.has(c));
    if (pick) return keepLoose(pick);
  } catch {
    /* an unreadable line: fall back to the first move */
  }
  return keepLoose(ucis.length ? conceptOf(fen, ucis[0], 'you', motif) : undefined);
}
