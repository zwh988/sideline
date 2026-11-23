import { Chess } from 'chess.js';
import './style.css';

// Placeholder entry point: proves the toolchain and chess.js work.
// The real board UI replaces this in the first MVP slice.
const game = new Chess();
game.move('e4');
game.move('e5');

const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `
  <h1>Sideline</h1>
  <p>Toolchain OK. After 1.e4 e5, White has ${game.moves().length} legal moves.</p>
  <pre>${game.ascii()}</pre>
`;
