import '@lichess-org/chessground/assets/chessground.base.css';
import './style.css';
import { App } from './app/ui';
import { loadTheme } from './app/theme';

const THEME_ID = 'default';

async function start() {
  const root = document.querySelector<HTMLDivElement>('#app')!;
  const theme = await loadTheme(THEME_ID);
  new App(root, theme, `${import.meta.env.BASE_URL}themes/${THEME_ID}/`);
}

start().catch((err) => {
  document.body.textContent = `Sideline failed to start: ${err}`;
  console.error(err);
});
