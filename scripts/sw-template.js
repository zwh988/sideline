// Sideline's service worker. Vite's build fills in the placeholders (src/pwa/build.ts) and writes dist/sw.js.
//
// - Install: the app shell is cached (page, scripts, styles, the chess engine, pieces, icons).
// - Big files (the Maia model, the ONNX runtime) are cached the first time they are used, in a cache that
//   changes only when those files do, so an update does not download 22 MB again.
// - Pages: the network first (a new deploy shows at once), the cached copy when it is slow or offline.
// - Everything else on this site: the cache first.
// - Other sites (the Chess.com and Lichess APIs) are never touched.
const SHELL = 'sideline-shell-__SHELL_VERSION__';
const BIG = 'sideline-big-__BIG_VERSION__';
const PRECACHE = __PRECACHE__;
const SCOPE = self.registration.scope;
const PAGE_TIMEOUT_MS = 3000;

self.addEventListener('install', (event) => {
  const urls = [SCOPE, ...PRECACHE.map((p) => new URL(p, SCOPE).href)];
  event.waitUntil(caches.open(SHELL).then((cache) => cache.addAll(urls)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key.startsWith('sideline-') && key !== SHELL && key !== BIG) await caches.delete(key);
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || req.headers.has('range')) return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  event.respondWith(req.mode === 'navigate' ? page(req) : asset(req));
});

async function page(req) {
  const cache = await caches.open(SHELL);
  const root = new Request(SCOPE);
  try {
    const res = await Promise.race([
      fetch(req),
      new Promise((_, reject) => setTimeout(() => reject(new Error('slow')), PAGE_TIMEOUT_MS)),
    ]);
    if (res.ok && new URL(req.url).pathname === new URL(SCOPE).pathname) cache.put(root, res.clone());
    return res;
  } catch {
    return (await cache.match(root)) || (await cache.match(new URL('index.html', SCOPE).href)) || Response.error();
  }
}

async function asset(req) {
  const hit = await caches.match(req, { ignoreSearch: true });
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok && res.status === 200) {
    const big = /\.(onnx|wasm)$/.test(new URL(req.url).pathname);
    const cache = await caches.open(big ? BIG : SHELL);
    cache.put(req, res.clone());
  }
  return res;
}
