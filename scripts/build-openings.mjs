// Builds src/coach/openings-data.json from the Lichess opening names
// (https://github.com/lichess-org/chess-openings, CC0): a.tsv ... e.tsv, each
// "eco<TAB>name<TAB>pgn". The lookup is by position (EPD: board, side to move,
// castling, en passant), so a transposition finds the same opening.
//
//   node scripts/build-openings.mjs <folder with a.tsv ... e.tsv>
//
// The files are downloaded by hand (not committed); the output is committed.
// Nothing is fetched by the app at runtime.
import { Chess } from 'chess.js';
import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2];
if (!dir) {
  console.error('usage: node scripts/build-openings.mjs <folder with a.tsv ... e.tsv>');
  process.exit(1);
}

const epdOf = (fen) => fen.split(' ').slice(0, 4).join(' ');
// A 64-bit-ish key (two FNV-1a hashes) instead of the long EPD, to keep the file small.
// The same function is in src/coach/openings.ts; the tests check they agree.
function keyOf(epd) {
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ 0xdeadbeef;
  for (let i = 0; i < epd.length; i++) {
    a = Math.imul(a ^ epd.charCodeAt(i), 0x01000193) >>> 0;
    b = Math.imul(b ^ epd.charCodeAt(i), 0x85ebca6b) >>> 0;
  }
  return a.toString(36) + '.' + b.toString(36);
}
const out = {};
let lines = 0;
let clashes = 0;
for (const f of ['a', 'b', 'c', 'd', 'e']) {
  const rows = readFileSync(join(dir, `${f}.tsv`), 'utf8').split(/\r?\n/).slice(1).filter(Boolean);
  for (const row of rows) {
    const [eco, name, pgn] = row.split('\t');
    const chess = new Chess();
    // "1. e4 e5 2. Nf3" -> the moves only
    for (const tok of pgn.replace(/\d+\.(\.\.)?/g, ' ').split(/\s+/).filter(Boolean)) chess.move(tok);
    const key = keyOf(epdOf(chess.fen()));
    // Two names for one position (or a hash clash): stop and look.
    if (out[key]) {
      clashes++;
      console.error(`clash: ${name} / ${out[key][1]}`);
    }
    out[key] = [eco, name];
    lines++;
  }
}
const target = new URL('../src/coach/openings-data.json', import.meta.url);
writeFileSync(target, JSON.stringify(out));
console.log(`${lines} lines, ${Object.keys(out).length} positions (${clashes} clashes), ${(statSync(target).size / 1024).toFixed(0)} KB`);
