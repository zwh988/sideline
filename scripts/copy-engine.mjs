// Copies engine and model files from node_modules into public/, so Vite
// serves them as static files and the app works offline on any static host.
// Runs automatically before `dev` and `build`. The copies are not tracked.
//
// - Stockfish 19 Lite, single-threaded: no COOP/COEP headers needed.
// - Maia3 5M ONNX model (human-like move choice).
// ONNX Runtime's own .wasm is bundled by Vite (see vite.config.ts), not copied.
import { copyFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const pkgDir = (name) => join(root, 'node_modules', name);
const publicDir = join(root, 'public');

const copies = [
  ['stockfish', 'bin', 'engine', ['stockfish-19-lite-single.js', 'stockfish-19-lite-single.wasm']],
  ['maia3-js', 'models', 'models', ['maia3_5m.onnx']],
];

for (const [pkg, from, to, files] of copies) {
  const outDir = join(publicDir, to);
  mkdirSync(outDir, { recursive: true });
  for (const file of files) copyFileSync(join(pkgDir(pkg), from, file), join(outDir, file));
}
console.log('Copied Stockfish and the Maia3 model to public/');
