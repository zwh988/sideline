// Builds the opening course trees (task 6.1) into public/openings/<course>.json.
// Build time only: the app never fetches any of this (rule 4).
//
//   npm run openings                      all courses
//   npm run openings -- --only vienna-white,caro-kann-black
//   npm run openings -- --depth 18 --engines 6
//
// Sources:
// - Reply frequencies per coach tier: the Lichess opening explorer (Lichess
//   games, CC0) when LICHESS_TOKEN is set (a personal API token, no scopes;
//   the explorer refuses anonymous requests; or a LICHESS_TOKEN=… line in
//   .env.local, git-ignored), else Maia at the tier's rating.
//   Positions with too few explorer games also fall back to Maia, and each
//   share records its source. Explorer answers are cached in
//   scripts/opening-cache/explorer.json (committed), so a rebuild needs no network.
// - Stockfish 19 (the full single-threaded WASM build, run as child
//   processes in parallel), cached in scripts/opening-cache/stockfish-d<depth>.json.
// - Maia3 (onnxruntime-web's wasm build runs in Node too) for the player's
//   move popularity and the fallback.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runnerImport } from 'vite';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public/openings');
const CACHE = join(ROOT, 'scripts/opening-cache');
const DOCS = join(ROOT, 'docs/OPENINGS.md');

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
};
const DEPTH = Number(arg('depth', 16));
const ENGINES = Number(arg('engines', Math.max(1, Math.min(8, Math.floor(availableParallelism() / 2)))));
const ONLY = arg('only', '')?.split(',').filter(Boolean);
/** The Lichess token: the environment, else a `LICHESS_TOKEN=…` line in .env.local (git-ignored). */
const TOKEN = (
  process.env.LICHESS_TOKEN ??
  (existsSync(join(ROOT, '.env.local')) ? /^\s*LICHESS_TOKEN\s*=\s*"?([^"\r\n]+)"?/m.exec(readFileSync(join(ROOT, '.env.local'), 'utf8'))?.[1] : undefined)
)?.trim();
/** Fewer explorer games than this in a position and band: use Maia instead. */
const MIN_GAMES = 100;
/** Pause between explorer requests (Lichess: one request at a time; on 429 wait a minute). */
const EXPLORER_GAP_MS = 500;
/** The rating Maia picks the player's move popularity at. */
const POPULARITY_ELO = 1600;

const load = async (path) => (await runnerImport(join(ROOT, path), { configFile: false, logLevel: 'error' })).module;
const { buildCourse, mainLine, nodesForTier, TIER_RULES } = await load('src/coach/opening-tree.ts');
const { COURSES } = await load('src/coach/opening-courses.ts');
const { OpeningBook } = await load('src/coach/openings.ts');
const { Stockfish, scoreToCp } = await load('src/engine/stockfish.ts');
const book = new OpeningBook(JSON.parse(readFileSync(join(ROOT, 'src/coach/openings-data.json'), 'utf8')));

mkdirSync(CACHE, { recursive: true });
mkdirSync(OUT, { recursive: true });
const readJson = (f) => (existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : {});
/** Sorted keys, one entry per line: stable diffs for the committed caches. */
const writeCache = (f, obj) =>
  writeFileSync(f, '{\n' + Object.keys(obj).sort().map((k) => `${JSON.stringify(k)}:${JSON.stringify(obj[k])}`).join(',\n') + '\n}\n');

// ---------- Stockfish pool ----------
const sfFile = join(CACHE, `stockfish-d${DEPTH}.json`);
const sfCache = readJson(sfFile);
let sfNew = 0;
const saveSf = () => writeCache(sfFile, sfCache);

function nodeTransport() {
  const proc = spawn(process.execPath, [join(ROOT, 'node_modules/stockfish/bin/stockfish-19-single.js')], { stdio: ['pipe', 'pipe', 'inherit'] });
  let buf = '';
  let listener = () => {};
  proc.stdout.on('data', (d) => {
    buf += d;
    const lines = buf.split(/\r?\n/);
    buf = lines.pop();
    for (const l of lines) listener(l);
  });
  return { send: (cmd) => proc.stdin.write(cmd + '\n'), onLine: (l) => (listener = l), terminate: () => proc.kill() };
}

const idle = [];
const waiting = [];
for (let i = 0; i < ENGINES; i++) {
  const sf = await Stockfish.create(nodeTransport());
  sf.setOption('Hash', 64);
  idle.push(sf);
}
const engineName = idle[0].name;
async function withEngine(job) {
  const sf = idle.pop() ?? (await new Promise((r) => waiting.push(r)));
  try {
    return await job(sf);
  } finally {
    const next = waiting.shift();
    if (next) next(sf);
    else idle.push(sf);
  }
}

async function evaluate(fen, multiPv) {
  const key = `${multiPv} ${fen}`;
  let hit = sfCache[key];
  if (!hit) {
    hit = await withEngine(async (sf) => {
      await sf.newGame(); // same answer whichever engine and order: no hash left from other searches
      const a = await sf.analyse(fen, { depth: DEPTH, multiPv });
      const best = a.lines[0];
      return { b: best ? scoreToCp(best.score) : 0, ...(best?.score.kind === 'mate' ? { m: best.score.value } : {}), l: a.lines.map((l) => [l.pv[0], scoreToCp(l.score), l.pv.slice(0, 16).join(' ')]) };
    });
    sfCache[key] = hit;
    if (++sfNew % 200 === 0) saveSf();
  }
  return { bestCp: hit.b, mateIn: hit.m, lines: hit.l.map(([uci, cp, pv]) => ({ uci, cp, pv: pv.split(' ') })) };
}

// ---------- Maia ----------
const { Maia3 } = await import('maia3-js/web');
const modelBytes = readFileSync(join(ROOT, 'node_modules/maia3-js/models/maia3_5m.onnx'));
const maia = new Maia3({ variant: '5m', modelBytes: modelBytes.buffer.slice(modelBytes.byteOffset, modelBytes.byteOffset + modelBytes.byteLength), numThreads: 1 });
await maia.load();
let maiaQueue = Promise.resolve();
function maiaPolicy(fen, history, elo) {
  const job = maiaQueue.then(() => maia.predict({ fen, selfElo: elo, oppoElo: elo, ...(history.length ? { priorMoves: history } : {}) }));
  maiaQueue = job.catch(() => undefined);
  return job.then((r) => r.moves);
}

// ---------- Lichess explorer ----------
const exFile = join(CACHE, 'explorer.json');
const exCache = readJson(exFile);
let exNew = 0;
let exLast = 0;
let exQueue = Promise.resolve();
const epdOf = (fen) => fen.split(' ').slice(0, 4).join(' ');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function explorerFetch(fen, band) {
  const params = new URLSearchParams({ variant: 'standard', fen, speeds: 'blitz,rapid,classical', ratings: String(band), moves: '20', topGames: '0', recentGames: '0' });
  for (;;) {
    await sleep(Math.max(0, exLast + EXPLORER_GAP_MS - Date.now()));
    exLast = Date.now();
    const res = await fetch(`https://explorer.lichess.ovh/lichess?${params}`, { headers: { Authorization: `Bearer ${TOKEN}`, 'User-Agent': 'sideline-opening-build' } });
    if (res.status === 429) {
      console.log('  explorer: rate limited, waiting a minute');
      await sleep(61000);
      continue;
    }
    if (!res.ok) throw new Error(`explorer ${res.status} for ${fen} (band ${band}): ${(await res.text()).slice(0, 200)}`);
    const j = await res.json();
    return { g: j.white + j.draws + j.black, m: j.moves.map((m) => [m.uci, m.white + m.draws + m.black]) };
  }
}

function explorer(fen, band) {
  const key = `${band} ${epdOf(fen)}`;
  if (exCache[key]) return Promise.resolve(exCache[key]);
  const job = exQueue.then(async () => {
    if (!exCache[key]) {
      exCache[key] = await explorerFetch(fen, band);
      if (++exNew % 50 === 0) {
        writeCache(exFile, exCache);
        console.log(`  explorer: ${exNew} new positions`);
      }
    }
    return exCache[key];
  });
  exQueue = job.catch(() => undefined);
  return job;
}

/** The explorer writes castling as the king taking its own rook (e1h1); the tree uses e1g1. */
const CASTLING = { e1h1: 'e1g1', e1a1: 'e1c1', e8h8: 'e8g8', e8a8: 'e8c8' };
function castlingUci(fen, uci) {
  if (!CASTLING[uci]) return uci;
  const rank = fen.split(' ')[0].split('/')[uci[1] === '1' ? 7 : 0].replace(/\d/g, (d) => '.'.repeat(+d));
  return rank[4] === (uci[1] === '1' ? 'K' : 'k') ? CASTLING[uci] : uci;
}

// ---------- Build ----------
const providers = {
  async replies(fen, history, rule) {
    if (TOKEN) {
      const ex = await explorer(fen, rule.band);
      if (ex.g >= MIN_GAMES) return { source: 'explorer', games: ex.g, shares: new Map(ex.m.map(([u, c]) => [castlingUci(fen, u), c / ex.g])) };
    }
    return { source: 'maia', shares: await maiaPolicy(fen, history, rule.maiaElo) };
  },
  popularity: (fen, history) => maiaPolicy(fen, history, POPULARITY_ELO),
  evaluate,
  openingName: (fen) => book.lookup(fen)?.name,
};

/** One node per line: readable diffs, still compact. */
const courseJson = (tree) => {
  const { nodes, ...head } = tree;
  return JSON.stringify(head).slice(0, -1) + ',"nodes":[\n' + nodes.map((n) => JSON.stringify(n)).join(',\n') + '\n]}\n';
};

console.log(`Stockfish: ${engineName}, depth ${DEPTH}, ${ENGINES} engines. Replies: ${TOKEN ? 'Lichess explorer (Maia where thin)' : 'Maia only (set LICHESS_TOKEN for the explorer)'}.`);
const courses = COURSES.filter((c) => !ONLY?.length || ONLY.includes(c.id));
const t0 = Date.now();
const results = [];
let failed = false;
await Promise.all(
  courses.map(async (def) => {
    try {
      const tree = await buildCourse(def, providers);
      const json = courseJson(tree);
      writeFileSync(join(OUT, `${def.id}.json`), json);
      results.push({ def, tree, bytes: Buffer.byteLength(json) });
      console.log(`  ${def.id}: ${tree.nodes.length} nodes, ${(Buffer.byteLength(json) / 1024).toFixed(0)} KB (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
    } catch (e) {
      failed = true;
      console.error(`  ${def.id}: FAILED: ${e.message}`);
    }
  }),
);
saveSf();
if (TOKEN) writeCache(exFile, exCache);
for (const sf of idle) sf.terminate();

// The catalogue the Openings tab reads (6.2), in COURSES order, from every course file present.
const index = [];
for (const def of COURSES) {
  const f = join(OUT, `${def.id}.json`);
  if (!existsSync(f)) continue;
  const tree = JSON.parse(readFileSync(f, 'utf8'));
  const sources = new Set(tree.nodes.flatMap((n) => n.src ?? []).filter(Boolean));
  index.push({
    id: def.id,
    opening: def.opening,
    side: def.side,
    role: def.role,
    defining: def.defining,
    startFen: tree.nodes[def.defining.length].fen,
    nodes: TIER_RULES.map((r) => nodesForTier(tree, r.tier).length),
    playerNodes: TIER_RULES.map((r) => nodesForTier(tree, r.tier).filter((n) => n.who === 'player' && !n.defining).length),
    sources: [...sources].sort(),
    bytes: Buffer.byteLength(readFileSync(f)),
  });
}
writeFileSync(join(OUT, 'index.json'), JSON.stringify({ version: 1, engine: engineName, depth: DEPTH, courses: index }, null, 1) + '\n');

// The player's moves of every course, for review (PLAN 6.1).
const doc = [
  '# Opening courses: the player\'s moves',
  '',
  `Generated by \`npm run openings\` (${engineName}, depth ${DEPTH}). Do not edit by hand: change \`src/coach/opening-courses.ts\` (\`moves\`, \`prefer\`) and rebuild.`,
  'Each line is a player move: the moves before it, **the move** (the lowest coach tier that teaches it), Stockfish\'s score after it from the player\'s side, and how much it gives away against Stockfish\'s best (0 = the best move). A ⚠ marks the answer to a trap.',
  '',
];
for (const def of COURSES) {
  const f = join(OUT, `${def.id}.json`);
  if (!existsSync(f)) continue;
  const tree = JSON.parse(readFileSync(f, 'utf8'));
  const counts = TIER_RULES.map((r) => nodesForTier(tree, r.tier).filter((n) => n.who === 'player' && !n.defining).length);
  doc.push(`## ${def.opening}, as ${def.side === 'w' ? 'White' : 'Black'} (${def.id})`, '');
  doc.push(`Main line: ${mainLine(tree).map((n) => n.san).join(' ')}`, '');
  doc.push(`Player moves taught per tier 1–6: ${counts.join(' / ')}`, '');
  const pathOf = (n) => {
    const out = [];
    for (let x = tree.nodes[n.parent]; x.parent >= 0; x = tree.nodes[x.parent]) out.unshift(x.san);
    return out.join(' ');
  };
  for (const n of tree.nodes) {
    if (n.who !== 'player' || n.defining) continue;
    const trap = tree.nodes[n.parent].trap ? ' ⚠' : '';
    doc.push(`- ${pathOf(n)} **${n.san}** (tier ${n.tier}) ${(n.eval / 100).toFixed(2)}, gives ${n.loss}${trap}`);
  }
  doc.push('');
}
writeFileSync(DOCS, doc.join('\n'));

const total = index.reduce((s, c) => s + c.bytes, 0);
console.log(`Done in ${((Date.now() - t0) / 1000).toFixed(0)} s: ${index.length} course files, ${(total / 1024).toFixed(0)} KB in all; ${sfNew} new engine searches${TOKEN ? `, ${exNew} new explorer positions` : ''}.`);
process.exit(failed ? 1 : 0);
