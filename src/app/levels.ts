// The six levels from the spec (tiers, each with its own coach and theme), with the rating the opponent plays at.
// The shown rating is the middle of the level's Chess.com band (under 400, 400–700, …, 1600+).
// Maia's ratings are Lichess ratings, which run higher than Chess.com's at
// the low end. Below about 500 Maia's play turns erratic (feasibility test 2),
// so Level 1 uses 600 and the coach makes it easier in other ways.

import type { Motif } from '../coach/lines';

/**
 * The coach of a tier (task 1.14). Placeholders until the personas are chosen: the name, the art
 * (`public/themes/<theme>/portraits/`) and later the voice and playing style change, not the code.
 */
export interface CoachPersona {
  id: string;
  name: string;
}

export interface Level {
  level: number;
  /** The tier's coach: each tier has its own (no generic "Coach"). */
  coach: CoachPersona;
  /** The strength shown to the player: about this Chess.com rating (the coach plays at `maiaElo` on Lichess's scale). */
  shownRating: number;
  /** The theme pack in `public/themes/<id>/`: board, pieces, accent, portraits. */
  theme: string;
  maiaElo: number;
  /** Longest line the coach teaches, in moves by both sides (spec: "Which lines get taught"). */
  maxPlies: number;
  /** Smallest material win (pawns) that counts as a tactic at this level. */
  minGain: number;
  /** A move that loses this many centipawns or more counts as a mistake. */
  mistakeCp: number;
  /** Patterns the player has reached; the coach only flags these. */
  motifs: Motif[];
  /** What the coach specialises in (task 1.14): its puzzle set ("Coach 3's tricks") uses these Lichess themes. */
  specialty: { puzzleThemes: string[] };
  /**
   * The coach's puzzle difficulty, Lichess puzzle ratings [low, high) (task 3.1). Lichess puzzle
   * ratings run higher than Chess.com game ratings at the low end, so each band sits around the
   * coach's Maia (Lichess game) rating rather than its shown rating; the lowest stays easy.
   */
  puzzleBand: [number, number];
}

const L1: Motif[] = ['mate-in-1', 'hanging-piece'];
const L2: Motif[] = [...L1, 'fork', 'mate-in-2'];
const L3: Motif[] = [...L2, 'discovered-attack', 'skewer', 'pin', 'winning-material'];
const L4: Motif[] = [...L3, 'mate'];

export const LEVELS: Level[] = [
  { level: 1, coach: { id: 'coach1', name: 'Coach 1' }, shownRating: 300, theme: 'coach1', maiaElo: 600, maxPlies: 3, minGain: 3, mistakeCp: 250, motifs: L1, specialty: { puzzleThemes: ['hangingPiece', 'mateIn1', 'oneMove'] }, puzzleBand: [0, 800] },
  { level: 2, coach: { id: 'coach2', name: 'Coach 2' }, shownRating: 550, theme: 'coach2', maiaElo: 800, maxPlies: 4, minGain: 3, mistakeCp: 250, motifs: L2, specialty: { puzzleThemes: ['fork', 'mateIn2', 'backRankMate', 'trappedPiece'] }, puzzleBand: [600, 1000] },
  { level: 3, coach: { id: 'coach3', name: 'Coach 3' }, shownRating: 850, theme: 'coach3', maiaElo: 1100, maxPlies: 6, minGain: 2, mistakeCp: 200, motifs: L3, specialty: { puzzleThemes: ['pin', 'skewer', 'discoveredAttack', 'sacrifice', 'opening', 'kingsideAttack'] }, puzzleBand: [800, 1200] },
  { level: 4, coach: { id: 'coach4', name: 'Coach 4' }, shownRating: 1150, theme: 'coach4', maiaElo: 1350, maxPlies: 6, minGain: 2, mistakeCp: 200, motifs: L4, specialty: { puzzleThemes: ['capturingDefender', 'deflection', 'defensiveMove', 'pawnEndgame', 'endgame'] }, puzzleBand: [1200, 1600] },
  { level: 5, coach: { id: 'coach5', name: 'Coach 5' }, shownRating: 1450, theme: 'coach5', maiaElo: 1600, maxPlies: 8, minGain: 1, mistakeCp: 150, motifs: L4, specialty: { puzzleThemes: ['quietMove', 'rookEndgame', 'advancedPawn', 'promotion', 'intermezzo'] }, puzzleBand: [1400, 1800] },
  { level: 6, coach: { id: 'coach6', name: 'Coach 6' }, shownRating: 1750, theme: 'coach6', maiaElo: 1850, maxPlies: 10, minGain: 1, mistakeCp: 120, motifs: L4, specialty: { puzzleThemes: ['long', 'veryLong', 'zugzwang', 'clearance', 'interference', 'xRayAttack'] }, puzzleBand: [1600, 2000] },
];

/** How a tier is named in menus and lists: "Tier 3 · Coach 3 · about 850". */
export const levelLabel = (l: Level): string => `Tier ${l.level} · ${l.coach.name} · about ${l.shownRating}`;

export const levelInfo = (n: number): Level => LEVELS.find((l) => l.level === n) ?? LEVELS[1];
