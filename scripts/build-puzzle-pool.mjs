// Builds the puzzle pool (task 3.1) from the Lichess puzzle database (CC0).
//
//   1. Download https://database.lichess.org/lichess_db_puzzle.csv.zst (~310 MB)
//      into data/ (git-ignored). The app never fetches it (rule 4).
//   2. npm run puzzle-pool [-- path-to-csv.zst]
//
// Output: public/puzzles/pool/<lo>-<hi>.json, one file per rating band, and
// public/puzzles/pool/index.json (bands, counts per theme and band, the options).
// The choice (themes, bands, quality thresholds, seed) is in
// src/app/puzzlepool-build.ts; the same database file gives the same pool.
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runnerImport } from 'vite';
import { puzzleRows } from './lichess-puzzles.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public/puzzles/pool');
const source = process.argv[2] ?? join(ROOT, 'data/lichess_db_puzzle.csv.zst');
if (!existsSync(source)) {
  console.error(`Not found: ${source}\nDownload lichess_db_puzzle.csv.zst from https://database.lichess.org/ first.`);
  process.exit(1);
}

const load = async (path) => (await runnerImport(join(ROOT, path), { configFile: false, logLevel: 'error' })).module;
const { PoolBuilder, POOL_OPTIONS } = await load('src/app/puzzlepool-build.ts');
const { encodeBand, bandFile } = await load('src/app/puzzlepool.ts');

const builder = new PoolBuilder(POOL_OPTIONS);
const started = Date.now();
for await (const row of puzzleRows(source)) {
  builder.add(row);
  if (builder.rows % 1_000_000 === 0) console.log(`${builder.rows / 1_000_000}M rows…`);
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const bands = builder.result();
const files = [];
let raw = 0;
let gz = 0;
bands.forEach((puzzles, i) => {
  const band = POOL_OPTIONS.bands[i];
  const json = JSON.stringify(encodeBand(band, puzzles));
  const name = bandFile(band).slice('puzzles/pool/'.length);
  writeFileSync(join(OUT, name), json);
  const zipped = gzipSync(json).length;
  raw += json.length;
  gz += zipped;
  files.push({ band, file: name, puzzles: puzzles.length, bytes: json.length, gzipBytes: zipped });
});

const counts = builder.counts();
writeFileSync(join(OUT, 'index.json'), JSON.stringify({
  source: 'https://database.lichess.org/ (puzzles, CC0)',
  databaseRows: builder.rows,
  passedQuality: builder.passed,
  options: { ...POOL_OPTIONS, themes: undefined },
  themes: POOL_OPTIONS.themes,
  files,
  sampled: counts,
}, null, 1));

const kb = (n) => `${Math.round(n / 1024)} KB`;
console.log(`\n${builder.rows} rows, ${builder.passed} pass the quality filter (${Math.round((Date.now() - started) / 1000)} s)`);
for (const f of files) console.log(`${f.file.padEnd(16)} ${String(f.puzzles).padStart(6)} puzzles  ${kb(f.bytes).padStart(8)}  gzip ${kb(f.gzipBytes)}`);
console.log(`total ${files.reduce((s, f) => s + f.puzzles, 0)} puzzles, ${kb(raw)}, gzip ${kb(gz)}`);
const thin = Object.entries(counts).flatMap(([t, c]) => c.map((n, i) => [t, i, n]).filter(([, , n]) => n < POOL_OPTIONS.perBucket));
if (thin.length) console.log(`\nBuckets under ${POOL_OPTIONS.perBucket}:\n` + thin.map(([t, i, n]) => `  ${t} ${POOL_OPTIONS.bands[i].join('-')}: ${n}`).join('\n'));
