// What stands out in a quiet position (task 1.9d): facts about the position that board code can
// check, for the moments when the engine says one side is better and no tactic explains it.
// Each fact is geometry, worded as the geometry (rule 1): it never claims that it is *why* the
// engine likes the position, only that it is there. The caller picks facts that favour the side
// the engine prefers.
import { Chess, type Color, type PieceSymbol, type Square } from 'chess.js';

export interface PositionFact {
  kind: 'passed-pawn' | 'isolated-pawn' | 'doubled-pawns' | 'open-king' | 'bishop-pair';
  /** The side the fact is good for. */
  favours: Color;
  /** The squares to light up on the board. */
  squares: Square[];
  /** One sentence, from the checked geometry only. */
  text: string;
}

const SIDE: Record<Color, string> = { w: 'White', b: 'Black' };
const FILES = 'abcdefgh';

interface Pawn {
  file: number;
  rank: number; // 1..8
  color: Color;
}

function board(fen: string) {
  const c = new Chess(fen);
  const pawns: Pawn[] = [];
  const pieces: { type: PieceSymbol; color: Color; square: Square }[] = [];
  for (const row of c.board()) {
    for (const p of row) {
      if (!p) continue;
      pieces.push({ type: p.type, color: p.color, square: p.square });
      if (p.type === 'p') pawns.push({ file: FILES.indexOf(p.square[0]), rank: Number(p.square[1]), color: p.color });
    }
  }
  return { pieces, pawns };
}

const sq = (p: Pawn) => (FILES[p.file] + p.rank) as Square;
/** Ranks a pawn of `color` still has to pass (0 on its last step). */
const toGo = (p: Pawn) => (p.color === 'w' ? 8 - p.rank : p.rank - 1);

/**
 * Facts about the position, for both sides. Passed pawn: no enemy pawn on its file or the files beside it
 * stands ahead of it (nothing can block it or take it with a pawn). Isolated pawn: no pawn of its own side on
 * the files beside it. Doubled pawns: two pawns of one side on a file. Open king: the king stands on a file
 * with no pawn of either side while the enemy still has a queen or a rook. Bishop pair: two bishops against
 * fewer.
 */
export function positionFacts(fen: string): PositionFact[] {
  const { pieces, pawns } = board(fen);
  const facts: PositionFact[] = [];
  for (const color of ['w', 'b'] as Color[]) {
    const other: Color = color === 'w' ? 'b' : 'w';
    const mine = pawns.filter((p) => p.color === color);
    const theirs = pawns.filter((p) => p.color === other);
    // Passed pawns.
    const passed = mine.filter((p) => !theirs.some((t) => Math.abs(t.file - p.file) <= 1 && (color === 'w' ? t.rank > p.rank : t.rank < p.rank)));
    if (passed.length) {
      const p = passed.sort((a, b) => toGo(a) - toGo(b))[0];
      const files = [p.file - 1, p.file, p.file + 1].filter((f) => f >= 0 && f <= 7).map((f) => FILES[f]);
      facts.push({
        kind: 'passed-pawn',
        favours: color,
        squares: [sq(p)],
        text: `${SIDE[color]} has a passed pawn on ${sq(p)}: no ${SIDE[other].toLowerCase()} pawn on the ${files.join(', ')} files is ahead of it.`,
      });
    }
    // Isolated and doubled pawns are the owner's weaknesses: they favour the other side.
    const isolated = mine.filter((p) => !mine.some((m) => Math.abs(m.file - p.file) === 1));
    if (isolated.length) {
      const p = isolated[0];
      facts.push({ kind: 'isolated-pawn', favours: other, squares: [sq(p)], text: `${SIDE[color]}'s pawn on ${sq(p)} is isolated: no ${SIDE[color].toLowerCase()} pawn stands on the files beside it.` });
    }
    const doubledFile = [...new Set(mine.map((p) => p.file))].find((f) => mine.filter((p) => p.file === f).length > 1);
    if (doubledFile !== undefined) {
      const squares = mine.filter((p) => p.file === doubledFile).map(sq);
      facts.push({ kind: 'doubled-pawns', favours: other, squares, text: `${SIDE[color]} has doubled pawns on the ${FILES[doubledFile]}-file (${squares.join(' and ')}).` });
    }
    // The king on a file with no pawns, against a queen or a rook.
    const king = pieces.find((p) => p.type === 'k' && p.color === color);
    if (king && pieces.some((p) => p.color === other && (p.type === 'q' || p.type === 'r'))) {
      const file = FILES.indexOf(king.square[0]);
      if (!pawns.some((p) => p.file === file)) {
        facts.push({ kind: 'open-king', favours: other, squares: [king.square], text: `${SIDE[color]}'s king stands on the open ${FILES[file]}-file: there is no pawn in front of it.` });
      }
    }
    // The bishop pair.
    const bishops = pieces.filter((p) => p.type === 'b' && p.color === color);
    if (bishops.length >= 2 && pieces.filter((p) => p.type === 'b' && p.color === other).length < 2) {
      facts.push({ kind: 'bishop-pair', favours: color, squares: bishops.map((b) => b.square), text: `${SIDE[color]} has both bishops.` });
    }
  }
  return facts;
}

/** The facts that favour `better`, most telling first (a passed pawn, then the other side's weaknesses). */
export function reasonsFor(fen: string, better: Color): PositionFact[] {
  const order: PositionFact['kind'][] = ['passed-pawn', 'open-king', 'doubled-pawns', 'isolated-pawn', 'bishop-pair'];
  return positionFacts(fen)
    .filter((f) => f.favours === better)
    .sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
}
