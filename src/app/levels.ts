// The six levels from the spec, with the rating the opponent plays at.
// Maia's ratings are Lichess ratings, which run higher than Chess.com's at
// the low end. Below about 500 Maia's play turns erratic (feasibility test 2),
// so Level 1 uses 600 and the coach makes it easier in other ways.

export interface Level {
  level: number;
  chessCom: string; // rough Chess.com rating band, shown to the player
  maiaElo: number;
}

export const LEVELS: Level[] = [
  { level: 1, chessCom: 'under 400', maiaElo: 600 },
  { level: 2, chessCom: '400–700', maiaElo: 800 },
  { level: 3, chessCom: '700–1000', maiaElo: 1100 },
  { level: 4, chessCom: '1000–1300', maiaElo: 1350 },
  { level: 5, chessCom: '1300–1600', maiaElo: 1600 },
  { level: 6, chessCom: '1600+', maiaElo: 1850 },
];

export const levelInfo = (n: number): Level => LEVELS.find((l) => l.level === n) ?? LEVELS[1];
