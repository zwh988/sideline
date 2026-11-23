// Feasibility tests. Open on desktop and on a phone (npm run dev:phone) and compare.
import { runMaiaTest } from './tests/maia-test';
import { runStockfishTest } from './tests/stockfish-test';
import './style.css';

const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `
  <h1>Sideline · feasibility tests</h1>
  <p class="buttons">
    <button data-test="stockfish">Stockfish test</button>
    <button data-test="maia">Maia test</button>
  </p>
  <p id="device"></p>
  <div id="out"></div>
`;
const out = document.querySelector<HTMLDivElement>('#out')!;
document.querySelector('#device')!.textContent =
  `${navigator.userAgent} · ${navigator.hardwareConcurrency ?? '?'} cores`;

const tests: Record<string, (out: HTMLElement) => Promise<void>> = {
  stockfish: runStockfishTest,
  maia: runMaiaTest,
};
const buttons = [...document.querySelectorAll<HTMLButtonElement>('button[data-test]')];

for (const btn of buttons) {
  btn.addEventListener('click', async () => {
    buttons.forEach((b) => (b.disabled = true));
    out.innerHTML = '';
    try {
      await tests[btn.dataset.test!](out);
    } catch (err) {
      out.insertAdjacentHTML('beforeend', `<p class="err">Error: ${err}</p>`);
      console.error(err);
    } finally {
      buttons.forEach((b) => (b.disabled = false));
    }
  });
}
