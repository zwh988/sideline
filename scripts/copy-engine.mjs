// Copies the single-threaded lite Stockfish build from node_modules into
// public/engine/, so Vite serves it as a static file (the .js loads the .wasm
// sitting next to it). Runs automatically before `dev` and `build`.
// Single-threaded: works on GitHub Pages without COOP/COEP headers.
import { copyFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const binDir = join(dirname(require.resolve('stockfish/package.json')), 'bin');
const outDir = join(import.meta.dirname, '..', 'public', 'engine');

mkdirSync(outDir, { recursive: true });
for (const file of ['stockfish-19-lite-single.js', 'stockfish-19-lite-single.wasm']) {
  copyFileSync(join(binDir, file), join(outDir, file));
}
console.log('Copied Stockfish lite-single to public/engine/');
