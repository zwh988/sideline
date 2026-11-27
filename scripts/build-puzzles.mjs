// Builds a small, reproducible sample of the Lichess puzzle database (CC0)
// for scoring the concept detectors (npm run concepts). Puzzles for practice
// come from the pool instead (scripts/build-puzzle-pool.mjs).
//
//   1. Download https://database.lichess.org/lichess_db_puzzle.csv.zst (~310 MB)
//      into data/ (git-ignored).
//   2. node scripts/build-puzzles.mjs [path-to-csv.zst] [perBucket]
//
// Output: public/puzzles/sample.json. Nothing here runs in the app; the app
// only ever loads our own static file (rule 4).
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { puzzleRows } from './lichess-puzzles.mjs';

const source = process.argv[2] ?? 'data/lichess_db_puzzle.csv.zst';
const perBucket = Number(process.argv[3] ?? 40);
if (!existsSync(source)) {
  console.error(`Not found: ${source}\nDownload lichess_db_puzzle.csv.zst from https://database.lichess.org/ first.`);
  process.exit(1);
}

// Note: the committed sample.json (2026-11-24) was built before lichess-puzzles.mjs read past the
// file's first zstd frame, so it holds puzzles from the first 176,448 rows only. A rebuild reads
// all of them (and gives a different sample, so `npm run concepts` numbers would move).

// Themes that matter below ~1600 (keep in sync with DETECTABLE / NOT_YET in src/coach/concepts.ts).
const THEMES = [
  'mateIn1', 'mateIn2', 'mateIn3', 'fork', 'discoveredAttack', 'hangingPiece', 'backRankMate',
  'smotheredMate', 'doubleCheck', 'promotion', 'pin', 'skewer', 'deflection', 'attraction',
  'capturingDefender', 'trappedPiece', 'sacrifice', 'quietMove', 'defensiveMove', 'interference',
  'clearance', 'intermezzo', 'xRayAttack', 'exposedKing', 'zugzwang',
];
// Lichess puzzle ratings run higher than Chess.com's at the low end.
const BANDS = [[0, 800], [800, 1200], [1200, 1600], [1600, 2000]];

// Seeded, so a rebuild from the same file gives the same sample.
let seed = 20261123;
const rand = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const buckets = new Map(); // "theme|band" -> { seen, items }
const wanted = new Set(THEMES);
let rows = 0;

for await (const row of puzzleRows(source)) {
  rows++;
  const [id, fen, moves, rating, rd, popularity, , themes] = row;
  const r = Number(rating);
  if (Number(rd) > 90 || Number(popularity) < 80) continue; // well-rated, liked puzzles only
  const band = BANDS.findIndex(([lo, hi]) => r >= lo && r < hi);
  if (band < 0) continue;
  const list = themes.split(' ');
  let rec;
  for (const theme of list) {
    if (!wanted.has(theme)) continue;
    const key = `${theme}|${band}`;
    const b = buckets.get(key) ?? { seen: 0, items: [] };
    buckets.set(key, b);
    b.seen++;
    rec ??= { id, fen, moves, rating: r, themes: list };
    // Reservoir sampling: every puzzle in the bucket is equally likely to stay.
    if (b.items.length < perBucket) b.items.push(rec);
    else {
      const j = Math.floor(rand() * b.seen);
      if (j < perBucket) b.items[j] = rec;
    }
  }
}

const unique = new Map();
for (const b of buckets.values()) for (const p of b.items) unique.set(p.id, p);
const puzzles = [...unique.values()].map((p) => ({ ...p, moves: p.moves.split(' ') }));

mkdirSync('public/puzzles', { recursive: true });
writeFileSync(
  'public/puzzles/sample.json',
  JSON.stringify({
    source: 'https://database.lichess.org/ (puzzles, CC0)',
    bands: BANDS,
    perBucket,
    totalRows: rows,
    puzzles,
  }),
);
const summary = [...buckets.entries()].map(([k, b]) => `${k}: ${b.items.length}/${b.seen}`).join('\n');
console.log(`${puzzles.length} puzzles from ${rows} rows\n${summary}`);
