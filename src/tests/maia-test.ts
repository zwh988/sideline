// Feasibility test 2: Maia3 in the browser.
// Questions: does it load and run fast enough, and does it still change its
// play below ~1100 (the spec's Levels 1–2), or does it flatten out there?
//
// For each position and rating, Stockfish scores every legal move, and we
// measure how much probability Maia puts on:
//   - the engine's best move ("p(best)"), and
//   - blunders: moves losing 2+ pawns versus the best ("p(blunder)").
// If Maia models low ratings, p(blunder) should rise as the rating falls.
import { Chess } from 'chess.js';
import { loadMaia, movePolicies } from '../engine/maia';
import { Stockfish } from '../engine/stockfish';
import { makeLogger, playSan, scoreToCp, uciToSan } from './util';

const ELOS = [400, 600, 800, 1000, 1200, 1500, 1800];
const BLUNDER_CP = 200;

const POSITIONS: { name: string; moves: string[] }[] = [
  { name: 'Start position', moves: [] },
  { name: 'Black must stop Qxf7# (Scholar’s mate)', moves: ['e4', 'e5', 'Bc4', 'Nc6', 'Qh5'] },
  { name: 'White has mate in 1', moves: ['e4', 'e5', 'Bc4', 'Nc6', 'Qh5', 'Nf6'] },
  { name: 'White’s knight on e4 is attacked', moves: ['e4', 'd5', 'Nc3', 'dxe4', 'Nxe4', 'Qd5'] },
  { name: 'Black’s queen is attacked', moves: ['e4', 'd5', 'exd5', 'Qxd5', 'Nc3'] },
  {
    name: 'Quiet Italian middlegame',
    moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'c3', 'Nf6', 'd3', 'd6', 'O-O', 'O-O'],
  },
];

export async function runMaiaTest(out: HTMLElement): Promise<void> {
  const log = makeLogger(out);
  log('<h2>Maia3 (5M)</h2>');

  const progress = document.createElement('p');
  out.append(progress);
  const t0 = performance.now();
  const maia = await loadMaia((loaded, total) => {
    progress.textContent = `Loading model… ${(loaded / 1e6).toFixed(1)} / ${(total / 1e6).toFixed(1)} MB`;
  });
  progress.innerHTML = `Model loaded in <b>${(performance.now() - t0).toFixed(0)} ms</b> (cached after the first visit)`;

  // Latency of one prediction, which is what the opponent needs per move.
  const start = playSan([]);
  await maia.predict({ fen: start.fen, selfElo: 800, topK: 0 }); // warm-up
  const t1 = performance.now();
  const N = 10;
  for (let i = 0; i < N; i++) await maia.predict({ fen: start.fen, selfElo: 800, topK: 0 });
  log(`<p>One move prediction: <b>${((performance.now() - t1) / N).toFixed(1)} ms</b></p>`);

  const sf = await Stockfish.create();
  log(`<p>p(best) = probability on Stockfish's best move. p(blunder) = probability on moves losing ≥${BLUNDER_CP / 100} pawns.</p>`);

  for (const pos of POSITIONS) {
    const { fen, uci } = playSan(pos.moves);
    const legal = new Chess(fen).moves().length;

    // Score every legal move with Stockfish.
    await sf.newGame();
    const a = await sf.analyse(fen, { depth: 12, multiPv: legal });
    const cpByMove = new Map(a.lines.map((l) => [l.pv[0], scoreToCp(l.score)]));
    const bestCp = Math.max(...cpByMove.values());
    const bestMove = a.lines[0]?.pv[0] ?? '';

    const policies = await movePolicies(maia, fen, ELOS, uci);
    const rows = ELOS.map((elo, i) => {
      const policy = policies[i];
      const top = [...policy.entries()].sort((x, y) => y[1] - x[1]).slice(0, 3);
      let pBlunder = 0;
      for (const [m, p] of policy) if (bestCp - (cpByMove.get(m) ?? bestCp) >= BLUNDER_CP) pBlunder += p;
      const pct = (p: number) => `${(p * 100).toFixed(0)}%`;
      return `<tr><td>${elo}</td>
        <td>${top.map(([m, p]) => `${uciToSan(fen, m)} ${pct(p)}`).join(', ')}</td>
        <td>${pct(policy.get(bestMove) ?? 0)}</td>
        <td>${pct(pBlunder)}</td></tr>`;
    });

    log(`<h3>${pos.name}</h3>
      <p>${pos.moves.length ? `After ${pos.moves.join(' ')}. ` : ''}Stockfish best: <b>${uciToSan(fen, bestMove)}</b></p>
      <div class="scroll"><table><thead><tr><th>Elo</th><th>Maia's top 3</th><th>p(best)</th><th>p(blunder)</th></tr></thead>
      <tbody>${rows.join('')}</tbody></table></div>`);
  }

  sf.terminate();
  await maia.close();
  log(`<p>Done in ${((performance.now() - t0) / 1000).toFixed(1)} s.</p>`);
}
