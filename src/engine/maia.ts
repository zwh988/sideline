// Human-like move choice with Maia3 (5M parameters, ~22 MB ONNX model),
// run in the browser with ONNX Runtime Web. The model is copied into public/
// by scripts/copy-engine.mjs and ONNX Runtime's .wasm is bundled by Vite,
// so nothing loads from a CDN and it works offline.
import { Maia3 } from 'maia3-js/web';

const asset = (path: string) => new URL(`${import.meta.env.BASE_URL}${path}`, location.href).href;

export type { Maia3 };

export async function loadMaia(onProgress?: (loaded: number, total: number) => void): Promise<Maia3> {
  const maia = new Maia3({
    variant: '5m',
    url: asset('models/maia3_5m.onnx'),
    numThreads: 1, // GitHub Pages can't send the headers multi-threading needs
    onProgress,
  });
  await maia.load();
  return maia;
}

/**
 * Probability Maia gives to each legal move (UCI) for a player of `elo`,
 * for several ratings at once. `priorMoves` are the game's UCI moves so far
 * (played from `baseFen`, default the start), which Maia uses as history.
 */
export async function movePolicies(
  maia: Maia3,
  fen: string,
  elos: number[],
  priorMoves: string[] = [],
  baseFen?: string,
): Promise<Map<string, number>[]> {
  const history = priorMoves.length ? { priorMoves, baseFen } : {};
  const results = await maia.predictBatch(elos.map((elo) => ({ fen, selfElo: elo, ...history })));
  return results.map((r) => r.moves);
}

/** Samples one move from a policy, the way a level-matched opponent would play. */
export function sampleMove(policy: Map<string, number>, temperature = 1): string {
  const entries = [...policy.entries()].map(([m, p]) => [m, Math.pow(p, 1 / temperature)] as const);
  const total = entries.reduce((s, [, p]) => s + p, 0);
  let r = Math.random() * total;
  for (const [m, p] of entries) {
    r -= p;
    if (r <= 0) return m;
  }
  return entries[entries.length - 1][0];
}
