// What an opening move does, from board code only (layer 1 of the opening
// text, task 6.1): develops a piece, fights for the centre, castles or
// prepares castling, opens a line for a piece, attacks something, pins,
// threatens mate, offers material, takes back. Each tag is a board fact the
// templates can word; nothing here is guessed or engine-dependent.
import { Chess, SQUARES, type Color, type PieceSymbol, type Square } from 'chess.js';
import { offeredMaterial } from './explain';
import { other } from './facts';
import { lineUps } from './motifs';

export const CENTRE: Square[] = ['d4', 'd5', 'e4', 'e5'];

export interface Placed {
  square: Square;
  piece: PieceSymbol;
}

export type IdeaTag =
  /** A knight or bishop leaves its starting square. */
  | { k: 'develops'; piece: PieceSymbol }
  /** Centre squares the moved piece now occupies or attacks (newly). */
  | { k: 'centre'; squares: Square[] }
  | { k: 'castles'; side: 'k' | 'q' }
  /** Castling on that side now only waits for the move (the squares between are empty). */
  | { k: 'prepares-castling'; side: 'k' | 'q' }
  /** Own bishops, rooks or queen that see at least two more squares after the move. */
  | { k: 'opens-line'; pieces: Placed[] }
  /** Enemy pieces and pawns the moved piece attacks that it did not before (`defended`: by their own side). */
  | { k: 'attacks'; targets: (Placed & { defended: boolean })[] }
  /** A new pin: `front` can't move without exposing `back` (the king or a bigger piece). */
  | { k: 'pins'; by: Square; front: Placed; back: Placed }
  /** If it were the mover's turn again, this move would mate. */
  | { k: 'threatens-mate'; san: string }
  /** The moved piece can be taken and not won back at once (a gambit, or a mistake: the engine decides which). */
  | { k: 'offers'; piece: PieceSymbol }
  /** Captures on the square where the other side just captured. */
  | { k: 'takes-back'; piece: PieceSymbol }
  | { k: 'captures'; piece: PieceSymbol }
  | { k: 'check' };

const HOME: Record<Color, Partial<Record<PieceSymbol, Square[]>>> = {
  w: { n: ['b1', 'g1'], b: ['c1', 'f1'] },
  b: { n: ['b8', 'g8'], b: ['c8', 'f8'] },
};

/** Squares between king and rook for castling on each side. */
const CASTLE_PATH: Record<Color, Record<'k' | 'q', Square[]>> = {
  w: { k: ['f1', 'g1'], q: ['b1', 'c1', 'd1'] },
  b: { k: ['f8', 'g8'], q: ['b8', 'c8', 'd8'] },
};

/** Squares (empty or not) the piece on `from` attacks. */
function attackedBy(chess: Chess, from: Square, color: Color): Set<Square> {
  const out = new Set<Square>();
  for (const sq of SQUARES) if (chess.attackers(sq, color).includes(from)) out.add(sq);
  return out;
}

const pathClear = (chess: Chess, color: Color, side: 'k' | 'q') => CASTLE_PATH[color][side].every((s) => !chess.get(s));

/** Same position with the other side to move (no en passant). */
function passTurn(fen: string): string {
  const parts = fen.split(' ');
  parts[1] = parts[1] === 'w' ? 'b' : 'w';
  parts[3] = '-';
  return parts.join(' ');
}

/**
 * The ideas of the move `uci` played from `fenBefore`. `previous` is the
 * other side's move that led to `fenBefore`, when known (for "takes back").
 */
export function openingIdeas(fenBefore: string, uci: string, previous?: { to: Square; captured: boolean }): IdeaTag[] {
  const before = new Chess(fenBefore);
  const color = before.turn();
  const enemy = other(color);
  const from = uci.slice(0, 2) as Square;
  const to = uci.slice(2, 4) as Square;
  const sliders = SQUARES.filter((s) => {
    const p = before.get(s);
    return p && p.color === color && s !== from && (p.type === 'b' || p.type === 'r' || p.type === 'q');
  });
  const seenBefore = new Map(sliders.map((s) => [s, attackedBy(before, s, color).size]));
  const attackedFromBefore = attackedBy(before, from, color);
  const pinsBefore = lineUps(before, color).filter((l) => l.kind === 'pin');

  const after = new Chess(fenBefore);
  const move = after.move({ from, to, promotion: uci[4] as PieceSymbol | undefined });
  const piece = (move.promotion ?? move.piece) as PieceSymbol;
  const tags: IdeaTag[] = [];

  if (move.isKingsideCastle() || move.isQueensideCastle()) {
    tags.push({ k: 'castles', side: move.isKingsideCastle() ? 'k' : 'q' });
  } else {
    if (HOME[color][move.piece as PieceSymbol]?.includes(from)) tags.push({ k: 'develops', piece });

    const attackedNow = attackedBy(after, to, color);
    const centre = CENTRE.filter((s) => (s === to || attackedNow.has(s)) && !(s === from || attackedFromBefore.has(s)));
    if (centre.length) tags.push({ k: 'centre', squares: centre });

    const rights = before.getCastlingRights(color);
    for (const side of ['k', 'q'] as const) {
      if (rights[side === 'k' ? 'k' : 'q'] && after.getCastlingRights(color)[side] && !pathClear(before, color, side) && pathClear(after, color, side)) {
        tags.push({ k: 'prepares-castling', side });
      }
    }

    const opened = sliders.filter((s) => attackedBy(after, s, color).size - seenBefore.get(s)! >= 2);
    if (opened.length) tags.push({ k: 'opens-line', pieces: opened.map((s) => ({ square: s, piece: after.get(s)!.type })) });

    const targets = [...attackedNow]
      .filter((s) => !attackedFromBefore.has(s) || from === s)
      .map((s) => ({ s, p: after.get(s) }))
      .filter(({ p }) => p && p.color === enemy && p.type !== 'k')
      .map(({ s, p }) => ({ square: s, piece: p!.type, defended: after.attackers(s, enemy).length > 0 }));
    if (targets.length) tags.push({ k: 'attacks', targets });
  }

  const key = (l: { by: Square; front: { square: Square } }) => `${l.by}${l.front.square}`;
  const oldPins = new Set(pinsBefore.map(key));
  for (const l of lineUps(after, color)) {
    if (l.kind === 'pin' && !oldPins.has(key(l))) {
      tags.push({ k: 'pins', by: l.by, front: { square: l.front.square, piece: l.front.type }, back: { square: l.back.square, piece: l.back.type } });
    }
  }

  if (move.captured) {
    const taken = move.captured as PieceSymbol;
    tags.push(previous?.captured && previous.to === to ? { k: 'takes-back', piece: taken } : { k: 'captures', piece: taken });
  }
  if (after.inCheck()) tags.push({ k: 'check' });
  else if (!after.isGameOver()) {
    const again = new Chess(passTurn(after.fen()));
    const mate = again.moves({ verbose: true }).find((m) => {
      again.move(m);
      const yes = again.isCheckmate();
      again.undo();
      return yes;
    });
    if (mate) tags.push({ k: 'threatens-mate', san: mate.san });
  }

  const offer = offeredMaterial(fenBefore, uci);
  if (offer && !after.isCheckmate()) tags.push({ k: 'offers', piece: offer.offered });
  return tags;
}

/**
 * The player's pieces and pawns (not the king) that the other side attacks before `uci` and that the moved piece
 * defends after it (a goal the coach can state: "Your pawn on e4 is attacked: defend it"). Board code only.
 */
export function defends(fenBefore: string, uci: string): Placed[] {
  const before = new Chess(fenBefore);
  const color = before.turn();
  const enemy = other(color);
  const from = uci.slice(0, 2) as Square;
  const to = uci.slice(2, 4) as Square;
  const after = new Chess(fenBefore);
  after.move({ from, to, promotion: uci[4] as PieceSymbol | undefined });
  const out: Placed[] = [];
  for (const sq of SQUARES) {
    const p = before.get(sq);
    if (!p || p.color !== color || p.type === 'k' || sq === from) continue;
    if (!before.attackers(sq, enemy).length) continue;
    if (after.get(sq)?.color !== color) continue;
    if (after.attackers(sq, color).includes(to)) out.push({ square: sq, piece: p.type });
  }
  return out;
}
