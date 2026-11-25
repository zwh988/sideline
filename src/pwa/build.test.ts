import { describe, expect, it } from 'vitest';
import { BIG_BYTES, pickPrecache, renderSw, versionOf, type BuiltFile } from './build';

const f = (path: string, size = 1000, hash = 'h'): BuiltFile => ({ path, size, hash });
const FILES = [
  f('index.html'),
  f('tests.html'),
  f('manifest.webmanifest'),
  f('assets/main-a1.js', 150_000),
  f('assets/tests-b2.js', 6_000_000),
  f('assets/ort-wasm-c3.wasm', 14_800_000),
  f('engine/stockfish-19-lite-single.wasm', 1_800_000),
  f('models/maia3_5m.onnx', 22_000_000),
  f('puzzles/sample.json', 700_000),
  f('sw.js'),
];

describe('pickPrecache', () => {
  it('caches the app at install and the big files when first used; leaves out the test page, puzzles and the worker itself', () => {
    const { precache, big } = pickPrecache(FILES);
    expect(precache).toEqual(['assets/main-a1.js', 'engine/stockfish-19-lite-single.wasm', 'index.html', 'manifest.webmanifest']);
    expect(big.map((x) => x.path)).toEqual(['assets/ort-wasm-c3.wasm', 'models/maia3_5m.onnx']);
    expect(FILES.find((x) => x.path === 'assets/ort-wasm-c3.wasm')!.size).toBeGreaterThan(BIG_BYTES);
  });
});

describe('versionOf', () => {
  it('changes when a file changes, not when the order does', () => {
    const a = [f('a.js', 1, 'x'), f('b.js', 2, 'y')];
    expect(versionOf(a)).toBe(versionOf([...a].reverse()));
    expect(versionOf(a)).not.toBe(versionOf([f('a.js', 1, 'x'), f('b.js', 2, 'z')]));
    expect(versionOf(a)).not.toBe(versionOf([f('a.js', 1, 'x')]));
  });
});

describe('renderSw', () => {
  const template = "const SHELL = 'sideline-shell-__SHELL_VERSION__'; const BIG = 'sideline-big-__BIG_VERSION__'; const PRECACHE = __PRECACHE__;";
  it('fills the versions and the list', () => {
    const out = renderSw(template, FILES);
    expect(out).not.toContain('__');
    expect(out).toContain('"assets/main-a1.js"');
    expect(out).not.toContain('tests.html');
    expect(out).not.toContain('onnx"'); // big files are not in the install list
  });

  it('the shell version moves with the app but not with the model, the big version the other way round', () => {
    const base = renderSw(template, FILES);
    const newModel = renderSw(template, FILES.map((x) => (x.path.endsWith('.onnx') ? { ...x, hash: 'new' } : x)));
    const newApp = renderSw(template, FILES.map((x) => (x.path === 'assets/main-a1.js' ? { ...x, hash: 'new' } : x)));
    const parts = (s: string) => [/shell-(\w+)/.exec(s)![1], /big-(\w+)/.exec(s)![1]];
    expect(parts(newModel)[0]).toBe(parts(base)[0]);
    expect(parts(newModel)[1]).not.toBe(parts(base)[1]);
    expect(parts(newApp)[0]).not.toBe(parts(base)[0]);
    expect(parts(newApp)[1]).toBe(parts(base)[1]);
  });
});
