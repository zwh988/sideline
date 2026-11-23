// `npm run concepts`: scores the concept detectors against the sampled Lichess puzzles.
import { spawnSync } from 'node:child_process';
const r = spawnSync('npx', ['vitest', 'run', 'src/coach/concepts.report.test.ts', '--reporter=verbose'], {
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, CONCEPTS_REPORT: '1' },
});
process.exit(r.status ?? 1);
