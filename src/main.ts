// Feasibility test 1: Stockfish WebAssembly in the browser.
// Measures engine load time and search speed, and checks that MultiPV
// (best + second-best move, used to tell forced moves apart) works.
// Open on desktop and on a phone (npm run dev:phone) and compare.
import { Chess } from 'chess.js';
import { Stockfish, type Line } from './engine/stockfish';
import './style.css';

const POSITIONS = [
  { name: 'Start position', fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1' },
  { name: 'Mate in 1 (Qxf7#)', fen: 'r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4' },
  { name: 'Knight fork (Nc7+)', fen: 'q3k3/8/8/3N4/8/8/8/4K3 w - - 0 1' },
  { name: 'Quiet Italian middlegame', fen: 'r1bq1rk1/ppp2ppp/2np1n2/2b1p3/2B1P3/2NP1N2/PPP2PPP/R1BQ1RK1 w - - 0 7' },
];
const DEPTHS = [10, 14, 18];

const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `
  <h1>Sideline · Stockfish test</h1>
  <p>Single-threaded lite build, MultiPV 2. Scores are from the side to move.</p>
  <button id="run">Run test</button>
  <div id="out"></div>
`;
const out = document.querySelector<HTMLDivElement>('#out')!;
const runBtn = document.querySelector<HTMLButtonElement>('#run')!;

function log(html: string) {
  out.insertAdjacentHTML('beforeend', html);
}

function formatScore(line: Line): string {
  const s = line.score;
  return s.kind === 'mate' ? `mate in ${s.value}` : `${(s.value / 100).toFixed(2)}`;
}

/** Converts a UCI principal variation to SAN for readability. */
function toSan(fen: string, pv: string[], max = 6): string {
  const board = new Chess(fen);
  const san: string[] = [];
  for (const uci of pv.slice(0, max)) {
    try {
      san.push(board.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }).san);
    } catch {
      san.push(`?${uci}`);
      break;
    }
  }
  return san.join(' ');
}

async function run() {
  runBtn.disabled = true;
  out.innerHTML = '';
  log(`<p>${navigator.userAgent}<br>Cores: ${navigator.hardwareConcurrency ?? '?'}</p>`);

  const t0 = performance.now();
  const sf = await Stockfish.create();
  log(`<p><b>${sf.name}</b> loaded in <b>${(performance.now() - t0).toFixed(0)} ms</b></p>`);
  const strengthOpts = sf.options.filter((o) => /Elo|Skill|LimitStrength/i.test(o));
  log(`<p>Strength options: ${strengthOpts.join(', ') || 'none found'}</p>`);

  const rows: string[] = [];
  for (const pos of POSITIONS) {
    await sf.newGame();
    for (const depth of DEPTHS) {
      const a = await sf.analyse(pos.fen, { depth, multiPv: 2 });
      const [best, second] = a.lines;
      const knps = a.timeMs > 0 ? (a.nodes / a.timeMs).toFixed(0) : '–';
      rows.push(`<tr>
        <td>${pos.name}</td><td>${depth}</td>
        <td>${a.timeMs.toFixed(0)} ms</td><td>${knps}</td>
        <td>${best ? `${formatScore(best)} · ${toSan(pos.fen, best.pv)}` : '–'}</td>
        <td>${second ? `${formatScore(second)} · ${toSan(pos.fen, second.pv, 3)}` : '–'}</td>
      </tr>`);
      renderTable(rows);
    }
  }
  sf.terminate();
  log(`<p>Done in ${((performance.now() - t0) / 1000).toFixed(1)} s.</p>`);
  runBtn.disabled = false;
}

function renderTable(rows: string[]) {
  let table = out.querySelector('table');
  if (!table) {
    out.insertAdjacentHTML(
      'beforeend',
      `<div class="scroll"><table><thead><tr>
        <th>Position</th><th>Depth</th><th>Time</th><th>kN/s</th><th>Best line</th><th>2nd best</th>
      </tr></thead><tbody></tbody></table></div>`,
    );
    table = out.querySelector('table')!;
  }
  table.querySelector('tbody')!.innerHTML = rows.join('');
}

runBtn.addEventListener('click', () => {
  run().catch((err) => {
    log(`<p class="err">Error: ${err}</p>`);
    runBtn.disabled = false;
  });
});
