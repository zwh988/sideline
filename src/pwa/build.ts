// Build-time helpers for the service worker (the plugin in vite.config.ts uses them):
// which built files are cached at install, which only when first used, and the file that results.
// Pure, so they are tested without a build.

export interface BuiltFile {
  /** Path inside dist/, with forward slashes ("assets/main-ab12.js"). */
  path: string;
  size: number;
  /** A hash of the content (any stable string). */
  hash: string;
}

/** Files larger than this are cached when first used, not at install (the Maia model, the ONNX runtime). */
export const BIG_BYTES = 5 * 1024 * 1024;

/** Not part of the app: the service worker itself, the feasibility page and its code, the puzzle sample. */
const SKIP = [/^sw\.js$/, /^tests\.html$/, /^assets\/tests-/, /^puzzles\//];

export function pickPrecache(files: BuiltFile[]): { precache: string[]; big: BuiltFile[] } {
  const usable = files.filter((f) => !SKIP.some((re) => re.test(f.path)));
  return {
    precache: usable.filter((f) => f.size <= BIG_BYTES).map((f) => f.path).sort(),
    big: usable.filter((f) => f.size > BIG_BYTES),
  };
}

/** A short version for a set of files: it changes when any of them does. */
export function versionOf(files: BuiltFile[]): string {
  let h = 5381;
  for (const f of [...files].sort((a, b) => a.path.localeCompare(b.path))) {
    for (const ch of `${f.path}:${f.size}:${f.hash};`) h = ((h << 5) + h + ch.charCodeAt(0)) >>> 0;
  }
  return h.toString(36);
}

/** Fills the template (scripts/sw-template.js). */
export function renderSw(template: string, files: BuiltFile[]): string {
  const { precache, big } = pickPrecache(files);
  const shell = files.filter((f) => precache.includes(f.path));
  return template
    .replace('__SHELL_VERSION__', versionOf(shell))
    .replace('__BIG_VERSION__', versionOf(big))
    .replace('__PRECACHE__', JSON.stringify(precache));
}
