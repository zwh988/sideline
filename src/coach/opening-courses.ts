// The opening courses (Phase 6): each opening learnable from both sides, a
// course per opening × side. The tree of each course is built by
// scripts/build-opening-trees.mjs into public/openings/<id>.json (task 6.1).
// The player's own moves are chosen by the build (Stockfish's top moves, the
// most played among the near-equal ones); `moves` and `prefer` steer it
// where the course teaches a system, and every choice is still checked by
// Stockfish (the build fails if one is a mistake).
import type { Color } from 'chess.js';

export interface CourseDef {
  id: string;
  /** The opening as the player knows it. */
  opening: string;
  /** The side the player learns. */
  side: Color;
  /** "Play it" (the side that chooses the opening) or "meet it" (the other side). */
  role: 'play' | 'meet';
  /** The moves that define the course (SAN from the start), shown, not quizzed. */
  defining: string[];
  /** The player's move at given positions (key: the SAN moves from the start, space-separated). */
  moves?: Record<string, string>;
  /** System moves (SAN) the player prefers, in this order, when they are near the best move. */
  prefer?: string[];
}

export const COURSES: CourseDef[] = [
  {
    id: 'vienna-white',
    opening: 'Vienna Game',
    side: 'w',
    role: 'play',
    defining: ['e4', 'e5', 'Nc3'],
    // The gambit where it works, the quiet Vienna where it doesn't (PLAN 6).
    moves: { 'e4 e5 Nc3 Nf6': 'f4', 'e4 e5 Nc3 Bc5': 'Bc4' },
  },
  {
    id: 'vienna-black',
    opening: 'Vienna Game',
    side: 'b',
    role: 'meet',
    defining: ['e4', 'e5', 'Nc3', 'Nf6'],
    moves: { 'e4 e5 Nc3 Nf6 f4': 'd5' }, // the counter-strike against the gambit
  },
  { id: 'caro-kann-black', opening: 'Caro-Kann Defence', side: 'b', role: 'play', defining: ['e4', 'c6'] },
  {
    id: 'caro-kann-white',
    opening: 'Caro-Kann Defence',
    side: 'w',
    role: 'meet',
    defining: ['e4', 'c6'],
    moves: { 'e4 c6': 'd4', 'e4 c6 d4 d5': 'e5' }, // one simple system: the Advance
  },
  { id: 'italian-white', opening: 'Italian Game', side: 'w', role: 'play', defining: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4'], moves: { 'e4 e5 Nf3 Nc6 Bc4 Bc5 c3 Nf6 d4 exd4 cxd4 Bb4+': 'Bd2' } },
  { id: 'italian-black', opening: 'Italian Game', side: 'b', role: 'meet', defining: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4'] },
  { id: 'scotch-white', opening: 'Scotch Game', side: 'w', role: 'play', defining: ['e4', 'e5', 'Nf3', 'Nc6', 'd4'] },
  { id: 'scotch-black', opening: 'Scotch Game', side: 'b', role: 'meet', defining: ['e4', 'e5', 'Nf3', 'Nc6', 'd4'] },
  {
    id: 'london-white',
    opening: 'London System',
    side: 'w',
    role: 'play',
    defining: ['d4'],
    prefer: ['Bf4', 'e3', 'Nf3', 'c3', 'Bd3', 'Nbd2', 'h3', 'O-O'],
  },
  { id: 'london-black', opening: 'London System', side: 'b', role: 'meet', defining: ['d4', 'd5', 'Bf4'] },
  { id: 'queens-gambit-white', opening: "Queen's Gambit", side: 'w', role: 'play', defining: ['d4', 'd5', 'c4'] },
  { id: 'queens-gambit-black', opening: "Queen's Gambit Declined", side: 'b', role: 'meet', defining: ['d4', 'd5', 'c4', 'e6'] },
  { id: 'scandinavian-black', opening: 'Scandinavian Defence', side: 'b', role: 'play', defining: ['e4', 'd5'] },
  { id: 'scandinavian-white', opening: 'Scandinavian Defence', side: 'w', role: 'meet', defining: ['e4', 'd5'] },
];
