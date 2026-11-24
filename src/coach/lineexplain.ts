// Words for every move of a line, not only the first: what each move does, and
// where an idea set up earlier pays off (a skewered, pinned or trapped piece
// that is taken later, a defender lured away, a king pulled out, a check or
// capture played before taking back). Used by the sideline ("show me what's
// good here", and the note after each move) and by Review.
//
// Rule 1: each sentence states only what board code checked. The first
// sentences are `conceptNote`'s; the pay-offs below repeat the checks of
// `detectConcepts` (concepts.ts) with the squares kept, so they can be worded.
// When nothing is found, the step has no concept and the caller says so.
import { Chess, type Color, type PieceSymbol, type Square } from 'chess.js';
import { conceptNote, type NoteConcept } from './explain';
import { PIECE_NAME, VALUE, other, playAndDescribe, type MoveFacts } from './facts';
import type { TaughtLine } from './lines';
import { defendedBy, lineUps, trappedPieces } from './motifs';
import { pieceRef } from './templates';

/** Who is speaking: the coach across the board ("my queen"), or looking back at a game ("their queen"). */
export type Voice = 'coach' | 'review';

export interface LineStep {
  uci: string;
  san: string;
  color: Color;
  /** The player's own move (not the opponent's or the coach's). */
  mine: boolean;
  /** The words for this move; empty when there is nothing checked to say. */
  text: string;
  /** The concept named at this move (`conceptNote`'s, or a later pay-off's), if any. */
  concept?: NoteConcept | 'deflection' | 'attraction' | 'intermezzo' | 'cashedIn';
  /** Only the part of `text` that completes an idea set up earlier in the line. */
  payoff?: string;
}

interface Pending {
  concept: 'skewer' | 'pin' | 'trappedPiece';
  owner: Color;
  square: Square;
}

const the = (p: PieceSymbol) => `the ${PIECE_NAME[p]}`;

/**
 * Steps for `ucis` played from `rootFen`. `player` is the side the sentences
 * address as "you"; the other side is "my" (coach voice) or "their" (review).
 * `facts` for earlier moves can be passed to continue a line (not needed).
 */
export function explainLine(
  rootFen: string,
  ucis: string[],
  opts: { player: Color; voice?: Voice; /** The move that led to `rootFen`, when known (an intermezzo or a recapture is judged against it). */ previous?: { fen: string; uci: string } },
): LineStep[] {
  const opp = opts.voice === 'review' ? 'their' : 'my';
  // Play the whole line first, so a step can look ahead (deflection, attraction, intermezzo).
  const chess = new Chess(rootFen);
  const fens: string[] = [];
  const facts: MoveFacts[] = [];
  const afters: string[] = [];
  let before: MoveFacts | undefined;
  if (opts.previous) {
    try {
      before = playAndDescribe(new Chess(opts.previous.fen), opts.previous.uci);
    } catch {
      /* an unusable previous move */
    }
  }
  for (const uci of ucis) {
    fens.push(chess.fen());
    try {
      facts.push(playAndDescribe(chess, uci));
    } catch {
      break; // the line stops being legal: explain what is there
    }
    afters.push(chess.fen());
  }

  const steps: LineStep[] = [];
  const pending: Pending[] = [];
  const extra: string[][] = facts.map(() => []); // sentences added to a step by an earlier look-ahead
  const payoffs: string[][] = facts.map(() => []);
  const concepts: (LineStep['concept'] | undefined)[] = facts.map(() => undefined);

  const ref = (p: PieceSymbol, sq: Square, owner: Color) => pieceRef(p, sq, owner === opts.player, opp);

  facts.forEach((f, i) => {
    const prev = i > 0 ? facts[i - 1] : before;
    const mine = f.color === opts.player;
    const after = new Chess(afters[i]);

    // Pay-offs of ideas set up earlier: the line takes the piece that was skewered, pinned or trapped.
    for (const p of [...pending]) {
      if (p.owner !== f.color) {
        // The other side's move: a piece that moved takes its square along.
        if (f.from === p.square) p.square = f.to;
        continue;
      }
      if (f.captured && f.to === p.square) {
        const what = { skewer: 'The skewer pays off', pin: 'The pin pays off', trappedPiece: 'The trap pays off' }[p.concept];
        payoffs[i].push(`${what}: ${f.san} takes ${the(f.captured)}.`);
        concepts[i] = 'cashedIn';
        pending.splice(pending.indexOf(p), 1);
      }
    }

    // The idea this move sets up (the same line-ups conceptNote names).
    // Taking back on the square just taken on is a trade, not "a loose piece".
    const recapture = !!prev?.captured && prev.to === f.to;
    let note = conceptNote(fens[i], f.uci, mine ? 'you' : 'me', opp);
    if (recapture && note && (note.concept === 'loosePiece' || note.concept === 'sacrifice')) note = undefined;
    if (note) {
      if (!payoffs[i].length) concepts[i] = note.concept;
      if (note.concept === 'skewer') {
        for (const l of lineUps(after, f.color)) if (l.kind === 'skewer' && l.by === f.to) pending.push({ concept: 'skewer', owner: f.color, square: l.front.square }, { concept: 'skewer', owner: f.color, square: l.back.square });
      } else if (note.concept === 'pin') {
        for (const l of lineUps(after, f.color)) if (l.kind === 'pin' && l.by === f.to) pending.push({ concept: 'pin', owner: f.color, square: l.front.square });
      } else if (note.concept === 'trappedPiece') {
        const t = trappedPieces(after, f.color).sort((x, y) => VALUE[y.type] - VALUE[x.type])[0];
        if (t) pending.push({ concept: 'trappedPiece', owner: f.color, square: t.square });
      }
    }

    // Deflection: this move is forcing, the reply moves a piece that defended something, and the next
    // move takes what lost its defender.
    const reply = facts[i + 1];
    const next = facts[i + 2];
    if (reply && next && next.color === f.color && (f.check || f.captured || f.attacks.length)) {
      const enemy = other(f.color);
      const afterReply = new Chess(afters[i + 1]);
      const stranded = defendedBy(after, reply.from, enemy).find(
        (d) =>
          VALUE[d.type] >= 3 &&
          afterReply.get(d.square)?.color === enemy &&
          afterReply.attackers(d.square, enemy).length === 0 &&
          next.captured &&
          next.to === d.square,
      );
      if (stranded) {
        const moved = the(reply.piece);
        extra[i + 1].push(`${moved[0].toUpperCase()}${moved.slice(1)} left ${reply.from}, where it defended ${ref(stranded.type, stranded.square, enemy)}, so that piece is now undefended.`);
        payoffs[i + 2].push(`${next.san} takes it: that is a deflection, the defender was drawn away first.`);
        concepts[i + 1] = 'deflection';
      }
    }

    // Attraction: a piece is offered to the king, which takes it, and the next move gives check or mate.
    const follow = facts[i + 1];
    if (f.captured && f.piece === 'k' && prev && f.to === prev.to && follow && (follow.check || follow.mate)) {
      extra[i].push(`The king was pulled to ${f.to}: that is an attraction.`);
      concepts[i] = 'attraction';
    }

    // Intermezzo: a piece was just taken and could be taken back, but this move (a check or a capture
    // elsewhere) comes first, and the line takes back afterwards.
    if (prev?.captured && f.to !== prev.to) {
      const canTakeBack = new Chess(fens[i]).moves({ verbose: true }).some((m) => m.to === prev.to && m.captured);
      const takesBackLater = facts.slice(i + 1).some((g) => g.color === f.color && g.captured && g.to === prev.to);
      if (canTakeBack && (f.check || f.captured) && takesBackLater) {
        extra[i].push(`Instead of taking back on ${prev.to} at once, this comes first (${f.check ? 'it gives check' : `it takes ${the(f.captured!)}`}); the takeback follows.`);
        concepts[i] = 'intermezzo';
      }
    }

    // Plain facts when no concept was named.
    // A capture that cashes in an earlier idea needs no "loose piece" or "traps" sentence of its own.
    const own = payoffs[i].length && note && (note.concept === 'loosePiece' || note.concept === 'capturingDefender') ? undefined : note;
    let text = own?.text ?? (payoffs[i].length ? '' : plainFacts(f, prev, mine, opp));
    if (extra[i].length) text = [text, ...extra[i]].filter(Boolean).join(' ');
    const payoff = payoffs[i].join(' ');
    if (payoff) text = [text, payoff].filter(Boolean).join(' ');
    steps.push({ uci: f.uci, san: f.san, color: f.color, mine, text, concept: concepts[i], payoff: payoff || undefined });
  });
  return steps;
}

/** What a move did, from facts only, when no concept applies: a capture, a check, checkmate. */
function plainFacts(f: MoveFacts, prev: MoveFacts | undefined, mine: boolean, opp: 'my' | 'their'): string {
  if (f.mate) return 'That is checkmate.';
  const check = f.check ? ', with check' : '';
  if (f.captured) {
    if (prev?.captured && prev.to === f.to) return `That takes back on ${f.to}${check}.`;
    const what = pieceRef(f.captured, f.to, !mine, opp);
    return `That takes ${what}${f.capturedUndefended ? ', which nothing defended' : ''}${check}.`;
  }
  if (f.check) return 'That gives check.';
  return '';
}

/** A line as a TaughtLine, so `winsPhrase` can name what it wins (material only, from the moves played). */
export function taughtFrom(rootFen: string, ucis: string[]): TaughtLine | undefined {
  const chess = new Chess(rootFen);
  const side = chess.turn();
  const start = materialOf(chess, side);
  const moves: MoveFacts[] = [];
  try {
    for (const uci of ucis) moves.push(playAndDescribe(chess, uci));
  } catch {
    /* use what was legal */
  }
  if (!moves.length) return undefined;
  const mate = moves.at(-1)!.mate && moves.at(-1)!.color === side;
  return {
    rootFen,
    side,
    moves,
    gain: mate ? 0 : materialOf(chess, side) - start,
    mate,
    motif: 'winning-material',
    positionalRest: false,
    laterLoss: 0,
  };
}

function materialOf(chess: Chess, color: Color): number {
  let sum = 0;
  for (const row of chess.board()) for (const sq of row) if (sq) sum += sq.color === color ? VALUE[sq.type] : -VALUE[sq.type];
  return sum;
}
