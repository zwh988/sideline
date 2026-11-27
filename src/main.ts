import '@lichess-org/chessground/assets/chessground.base.css';
import './style.css';
import { App } from './app/ui';
import { useTheme } from './app/theme';
import { initialTheme } from './app/ui';

async function start() {
  const root = document.querySelector<HTMLDivElement>('#app')!;
  // The theme of the saved tier first, so the page does not flash another coach's colours.
  const theme = await useTheme(initialTheme()).catch(() => useTheme('default'));
  new App(root, theme);
}

// Works offline after the first visit, and can be installed (see scripts/sw-template.js). Not in dev: a cache
// would hide edits.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch((err) => console.warn('No service worker', err));
  });
}

start().catch((err) => {
  document.body.textContent = `Sideline failed to start: ${err}`;
  console.error(err);
});
