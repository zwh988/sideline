// The puzzle pool (task 3.1): a broad sample of the Lichess puzzle database
// (CC0), every theme we may use × every rating band, built once by
// `npm run puzzle-pool` (scripts/build-puzzle-pool.mjs) into
// public/puzzles/pool/<band>.json. A coach's set is a filter over it at runtime
// (`coachSet`: the coach's themes at its band), so moving a theme between
// coaches is a data change in levels.ts, not a rebuild.
//
// Rule 1: the Lichess theme tags only choose puzzles. The coach names a concept
// only when our own detectors (coach/concepts.ts) confirm it.

/** The Lichess themes the pool samples (each is a bucket per band). Names checked against the CSV's theme column. */
export const POOL_THEMES = [
  // Mates
  'mateIn1', 'mateIn2', 'mateIn3', 'mateIn4', 'mateIn5',
  'backRankMate', 'smotheredMate', 'anastasiaMate', 'arabianMate', 'bodenMate', 'doubleBishopMate',
  'dovetailMate', 'hookMate', 'operaMate', 'pillsburysMate', 'epauletteMate',
  // Tactics
  'fork', 'discoveredAttack', 'discoveredCheck', 'doubleCheck', 'hangingPiece', 'pin', 'skewer',
  'capturingDefender', 'trappedPiece', 'sacrifice', 'intermezzo', 'deflection', 'attraction',
  'clearance', 'interference', 'xRayAttack', 'exposedKing', 'quietMove', 'defensiveMove', 'zugzwang',
  'attackingF2F7', 'kingsideAttack', 'queensideAttack',
  // Pawns and special moves
  'promotion', 'underPromotion', 'advancedPawn', 'enPassant', 'castling',
  // Phase and length
  'opening', 'endgame', 'pawnEndgame', 'rookEndgame', 'bishopEndgame', 'knightEndgame',
  'queenEndgame', 'queenRookEndgame', 'oneMove', 'long', 'veryLong',
] as const;

/**
 * Rating bands, Lichess puzzle ratings, [low, high). Steps of 200; the lowest band takes
 * everything under 600 (the database starts at about 400), the highest stops at 2200.
 */
export const POOL_BANDS: [number, number][] = [
  [0, 600], [600, 800], [800, 1000], [1000, 1200], [1200, 1400],
  [1400, 1600], [1600, 1800], [1800, 2000], [2000, 2200],
];

/** The file of a band, relative to the site root. */
export const bandFile = ([lo, hi]: [number, number]): string => `puzzles/pool/${lo}-${hi}.json`;

/** The pool's bands that overlap a range of puzzle ratings (a coach's band may span several files). */
export const bandsFor = ([lo, hi]: [number, number]): [number, number][] => POOL_BANDS.filter(([a, b]) => a < hi && b > lo);

/** One puzzle as the app uses it. `fen` is before the opponent's first move (`moves[0]`), as in the database. */
export interface Puzzle {
  id: string;
  fen: string;
  moves: string[];
  rating: number;
  themes: string[];
  /** Lichess's opening tags (family, then variation), for puzzles from the opening; empty otherwise. */
  openings: string[];
}

/**
 * A band file. Puzzles are rows `[id, fen, moves, rating, themeIdx[], openingIdx[]]`, where the
 * indices point into `themes` and `openings`, so the long names are written once per file.
 */
export interface BandFile {
  version: 1;
  band: [number, number];
  themes: string[];
  openings: string[];
  puzzles: [string, string, string, number, number[], number[]][];
}

export function encodeBand(band: [number, number], puzzles: Puzzle[]): BandFile {
  const themes: string[] = [];
  const openings: string[] = [];
  const index = (list: string[], map: Map<string, number>, name: string) => {
    let i = map.get(name);
    if (i === undefined) map.set(name, (i = list.push(name) - 1));
    return i;
  };
  const tMap = new Map<string, number>();
  const oMap = new Map<string, number>();
  return {
    version: 1,
    band,
    themes,
    openings,
    puzzles: puzzles.map((p) => [
      p.id, p.fen, p.moves.join(' '), p.rating,
      p.themes.map((t) => index(themes, tMap, t)),
      p.openings.map((o) => index(openings, oMap, o)),
    ]),
  };
}

export function decodeBand(file: BandFile): Puzzle[] {
  return file.puzzles.map(([id, fen, moves, rating, t, o]) => ({
    id, fen, moves: moves.split(' '), rating,
    themes: t.map((i) => file.themes[i]),
    openings: o.map((i) => file.openings[i]),
  }));
}

/** Theme → puzzles carrying it (every theme a puzzle has, not only the one it was sampled for). */
export function byTheme(puzzles: Puzzle[]): Map<string, Puzzle[]> {
  const map = new Map<string, Puzzle[]>();
  for (const p of puzzles) for (const t of p.themes) (map.get(t) ?? map.set(t, []).get(t)!).push(p);
  return map;
}

/** What a coach's puzzle set is chosen by: a `Level` (levels.ts) fits. */
export interface PuzzleFilter {
  specialty: { puzzleThemes: readonly string[] };
  /** Lichess puzzle ratings, [low, high). */
  puzzleBand: [number, number];
}

/** A coach's set: puzzles in its band with at least one of its themes. */
export function coachSet(puzzles: Puzzle[], f: PuzzleFilter): Puzzle[] {
  const [lo, hi] = f.puzzleBand;
  const want = new Set(f.specialty.puzzleThemes);
  return puzzles.filter((p) => p.rating >= lo && p.rating < hi && p.themes.some((t) => want.has(t)));
}

const files = new Map<string, Promise<Puzzle[]>>();

/** One band file (the site's own static file, rule 4), fetched once. */
export function loadBand(band: [number, number], base = import.meta.env.BASE_URL): Promise<Puzzle[]> {
  const name = bandFile(band);
  let p = files.get(name);
  if (!p) {
    p = fetch(`${base}${name}`).then(async (res) => {
      if (!res.ok) throw new Error(`Puzzle file ${name}: ${res.status}`);
      return decodeBand((await res.json()) as BandFile);
    });
    p.catch(() => files.delete(name)); // can be tried again
    files.set(name, p);
  }
  return p;
}

/** Loads the pool files a range of ratings needs. */
export async function loadPool(band: [number, number], base = import.meta.env.BASE_URL): Promise<Puzzle[]> {
  return (await Promise.all(bandsFor(band).map((b) => loadBand(b, base)))).flat();
}

const THEME_NAMES: Record<string, string> = {
  xRayAttack: 'X-ray attack',
  attackingF2F7: 'Attacking f2 or f7',
  oneMove: 'One-move puzzles',
  long: 'Long puzzles',
  veryLong: 'Very long puzzles',
  enPassant: 'En passant',
  pillsburysMate: "Pillsbury's mate",
  bodenMate: "Boden's mate",
};

/** A Lichess theme id in words: "mateIn1" → "Mate in 1", "hangingPiece" → "Hanging piece". */
export function themeName(theme: string): string {
  if (THEME_NAMES[theme]) return THEME_NAMES[theme];
  const words = theme.replace(/([A-Z])/g, ' $1').replace(/(\d)/g, ' $1').toLowerCase().trim();
  return words[0].toUpperCase() + words.slice(1);
}
