// The six levels from the spec, with the rating the opponent plays at.
// Maia's ratings are Lichess ratings, which run higher than Chess.com's at
// the low end. Below about 500 Maia's play turns erratic (feasibility test 2),
// so Level 1 uses 600 and the coach makes it easier in other ways.

import type { Motif } from '../coach/lines';

export interface Level {
  level: number;
  chessCom: string; // rough Chess.com rating band, shown to the player
  maiaElo: number;
  /** Longest line the coach teaches, in moves by both sides (spec: "Which lines get taught"). */
  maxPlies: number;
  /** Smallest material win (pawns) that counts as a tactic at this level. */
  minGain: number;
  /** A move that loses this many centipawns or more counts as a mistake. */
  mistakeCp: number;
  /** Patterns the player has reached; the coach only flags these. */
  motifs: Motif[];
}

const L1: Motif[] = ['mate-in-1', 'hanging-piece'];
const L2: Motif[] = [...L1, 'fork', 'mate-in-2'];
const L3: Motif[] = [...L2, 'discovered-attack', 'winning-material'];
const L4: Motif[] = [...L3, 'mate'];

export const LEVELS: Level[] = [
  { level: 1, chessCom: 'under 400', maiaElo: 600, maxPlies: 3, minGain: 3, mistakeCp: 250, motifs: L1 },
  { level: 2, chessCom: '400–700', maiaElo: 800, maxPlies: 4, minGain: 3, mistakeCp: 250, motifs: L2 },
  { level: 3, chessCom: '700–1000', maiaElo: 1100, maxPlies: 6, minGain: 2, mistakeCp: 200, motifs: L3 },
  { level: 4, chessCom: '1000–1300', maiaElo: 1350, maxPlies: 6, minGain: 2, mistakeCp: 200, motifs: L4 },
  { level: 5, chessCom: '1300–1600', maiaElo: 1600, maxPlies: 8, minGain: 1, mistakeCp: 150, motifs: L4 },
  { level: 6, chessCom: '1600+', maiaElo: 1850, maxPlies: 10, minGain: 1, mistakeCp: 120, motifs: L4 },
];

export const levelInfo = (n: number): Level => LEVELS.find((l) => l.level === n) ?? LEVELS[1];
