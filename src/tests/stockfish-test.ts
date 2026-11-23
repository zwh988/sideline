// Feasibility test 1: Stockfish WebAssembly in the browser.
// Measures engine load time and search speed, and checks that MultiPV
// (best + second-best move, used to tell forced moves apart) works.
import { Stockfish } from '../engine/stockfish';
import { formatScore, lineToSan, makeLogger } from './util';

const POSITIONS = [
  { name: 'Start position', fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1' },
  { name: 'Mate in 1 (Qxf7#)', fen: 'r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4' },
  { name: 'Knight fork (Nc7+)', fen: 'q3k3/8/8/3N4/8/8/8/4K3 w - - 0 1' },
  { name: 'Quiet Italian middlegame', fen: 'r1bq1rk1/ppp2ppp/2np1n2/2b1p3/2B1P3/2NP1N2/PPP2PPP/R1BQ1RK1 w - - 0 7' },
];
const DEPTHS = [10, 14, 18];

export async function runStockfishTest(out: HTMLElement): Promise<void> {
  const log = makeLogger(out);
  log('<h2>Stockfish</h2><p>Single-threaded lite build, MultiPV 2. Scores are from the side to move.</p>');

  const t0 = performance.now();
  const sf = await Stockfish.create();
  log(`<p><b>${sf.name}</b> loaded in <b>${(performance.now() - t0).toFixed(0)} ms</b></p>`);
  const strengthOpts = sf.options.filter((o) => /Elo|Skill|LimitStrength/i.test(o));
  log(`<p>Strength options: ${strengthOpts.join(', ') || 'none found'}</p>`);

  log(`<div class="scroll"><table><thead><tr>
    <th>Position</th><th>Depth</th><th>Time</th><th>kN/s</th><th>Best line</th><th>2nd best</th>
  </tr></thead><tbody></tbody></table></div>`);
  const tbody = out.querySelector('tbody:last-of-type') as HTMLElement;

  for (const pos of POSITIONS) {
    await sf.newGame();
    for (const depth of DEPTHS) {
      const a = await sf.analyse(pos.fen, { depth, multiPv: 2 });
      const [best, second] = a.lines;
      const knps = a.timeMs > 0 ? (a.nodes / a.timeMs).toFixed(0) : '–';
      tbody.insertAdjacentHTML(
        'beforeend',
        `<tr><td>${pos.name}</td><td>${depth}</td>
        <td>${a.timeMs.toFixed(0)} ms</td><td>${knps}</td>
        <td>${best ? `${formatScore(best.score)} · ${lineToSan(pos.fen, best.pv)}` : '–'}</td>
        <td>${second ? `${formatScore(second.score)} · ${lineToSan(pos.fen, second.pv, 3)}` : '–'}</td></tr>`,
      );
    }
  }
  sf.terminate();
  log(`<p>Done in ${((performance.now() - t0) / 1000).toFixed(1)} s.</p>`);
}
