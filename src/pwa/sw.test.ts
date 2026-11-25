// Runs scripts/sw-template.js against a small fake of the browser's service worker environment
// (CacheStorage, fetch, events), because a real worker cannot run in the test runner.
import { describe, expect, it } from 'vitest';
import template from '../../scripts/sw-template.js?raw';
import { renderSw, type BuiltFile } from './build';

const SCOPE = 'https://zwh988.github.io/sideline/';

class FakeCache {
  store = new Map<string, Response>();
  private key = (r: Request | string) => (typeof r === 'string' ? r : r.url);
  async put(r: Request | string, res: Response) {
    this.store.set(this.key(r), res);
  }
  async match(r: Request | string) {
    return this.store.get(this.key(r))?.clone();
  }
  async addAll(urls: string[]) {
    for (const u of urls) this.store.set(u, new Response(`body of ${u}`));
  }
}

class FakeCaches {
  all = new Map<string, FakeCache>();
  async open(name: string) {
    if (!this.all.has(name)) this.all.set(name, new FakeCache());
    return this.all.get(name)!;
  }
  async keys() {
    return [...this.all.keys()];
  }
  async delete(name: string) {
    return this.all.delete(name);
  }
  async match(r: Request | string, opts?: { ignoreSearch?: boolean }) {
    const strip = (u: string) => (opts?.ignoreSearch ? u.split('?')[0] : u);
    const want = strip(typeof r === 'string' ? r : r.url);
    for (const c of this.all.values()) for (const [k, v] of c.store) if (strip(k) === want) return v.clone();
    return undefined;
  }
}

const FILES: BuiltFile[] = [
  { path: 'index.html', size: 900, hash: 'a' },
  { path: 'assets/main-1.js', size: 90_000, hash: 'b' },
  { path: 'models/maia3_5m.onnx', size: 22_000_000, hash: 'c' },
];

/** A worker built from the template, with the fake environment; `net` decides what the network answers. */
function boot(files = FILES, existing: [string, FakeCache][] = []) {
  const listeners: Record<string, (e: unknown) => void> = {};
  const caches = new FakeCaches();
  for (const [k, c] of existing) caches.all.set(k, c);
  const fetched: string[] = [];
  const net = { online: true, slow: false };
  const fakeFetch = async (r: Request | string) => {
    const url = typeof r === 'string' ? r : r.url;
    fetched.push(url);
    if (!net.online) throw new TypeError('offline');
    if (net.slow) await new Promise((res) => setTimeout(res, 3500));
    return new Response(`net:${url}`);
  };
  const self = { registration: { scope: SCOPE }, addEventListener: (t: string, f: (e: unknown) => void) => (listeners[t] = f), clients: { claim: async () => undefined } };
  const code = renderSw(template, files);
  new Function('self', 'caches', 'fetch', 'location', 'setTimeout', 'Request', 'Response', 'URL', code)(self, caches, fakeFetch, new URL(SCOPE), setTimeout, Request, Response, URL);
  const wait = async (name: string) => {
    let p: Promise<unknown> = Promise.resolve();
    listeners[name]({ waitUntil: (x: Promise<unknown>) => (p = x) });
    await p;
  };
  const get = async (url: string, mode = 'cors', headers: Record<string, string> = {}, method = 'GET') => {
    let out: Promise<Response> | undefined;
    // A plain object: a real Request cannot be given the 'navigate' mode.
    const request = { url, method, mode, headers: new Headers(headers) } as unknown as Request;
    listeners.fetch({ request, respondWith: (p: Promise<Response>) => (out = p) });
    return out ? await (await out).text() : undefined; // undefined: the worker let the request through
  };
  return { caches, net, fetched, wait, get };
}

describe('service worker', () => {
  it('install caches the app shell (page root included) and not the big model', async () => {
    const sw = boot();
    await sw.wait('install');
    const shell = [...sw.caches.all.entries()].find(([k]) => k.startsWith('sideline-shell-'))![1];
    expect([...shell.store.keys()].sort()).toEqual([SCOPE, SCOPE + 'assets/main-1.js', SCOPE + 'index.html'].sort());
  });

  it('serves assets from the cache, offline, and caches what it fetches', async () => {
    const sw = boot();
    await sw.wait('install');
    sw.net.online = false;
    expect(await sw.get(SCOPE + 'assets/main-1.js')).toBe(`body of ${SCOPE}assets/main-1.js`);
    sw.net.online = true;
    expect(await sw.get(SCOPE + 'themes/default/pieces/wK.svg')).toBe(`net:${SCOPE}themes/default/pieces/wK.svg`);
    sw.net.online = false;
    expect(await sw.get(SCOPE + 'themes/default/pieces/wK.svg')).toBe(`net:${SCOPE}themes/default/pieces/wK.svg`); // now cached
  });

  it('the big model goes to its own cache the first time it is used', async () => {
    const sw = boot();
    await sw.wait('install');
    await sw.get(SCOPE + 'models/maia3_5m.onnx');
    const big = [...sw.caches.all.entries()].find(([k]) => k.startsWith('sideline-big-'))![1];
    expect([...big.store.keys()]).toEqual([SCOPE + 'models/maia3_5m.onnx']);
    sw.net.online = false;
    expect(await sw.get(SCOPE + 'models/maia3_5m.onnx')).toBe(`net:${SCOPE}models/maia3_5m.onnx`);
  });

  it('a page loads from the network first, and from the cache when offline or slow', async () => {
    const sw = boot();
    await sw.wait('install');
    expect(await sw.get(SCOPE, 'navigate')).toBe(`net:${SCOPE}`); // the new deploy shows at once
    sw.net.online = false;
    expect(await sw.get(SCOPE + '?fen=8/8/8/8/8/8/8/K1k5 w - - 0 1', 'navigate')).toBe(`net:${SCOPE}`); // the root, refreshed above
    sw.net.online = true;
    sw.net.slow = true;
    expect(await sw.get(SCOPE, 'navigate')).toBe(`net:${SCOPE}`); // slow network: the cached copy answers after 3 s
  }, 10000);

  it('lets other sites, ranged and non-GET requests through', async () => {
    const sw = boot();
    await sw.wait('install');
    expect(await sw.get('https://api.chess.com/pub/player/x/games/archives')).toBeUndefined();
    expect(await sw.get(SCOPE + 'models/maia3_5m.onnx', 'cors', { range: 'bytes=0-99' })).toBeUndefined();
    expect(await sw.get(SCOPE + 'assets/main-1.js', 'cors', {}, 'POST')).toBeUndefined();
  });

  it('activate removes old app caches and the old model cache when it changed, keeps the current ones', async () => {
    const first = boot();
    await first.wait('install');
    const old = new FakeCache();
    const newer = boot(FILES.map((f) => (f.path === 'assets/main-1.js' ? { ...f, hash: 'new' } : f)), [['sideline-shell-oldversion', old], ['unrelated-cache', new FakeCache()]]);
    await newer.wait('install');
    await newer.wait('activate');
    const names = [...newer.caches.all.keys()];
    expect(names).not.toContain('sideline-shell-oldversion');
    expect(names).toContain('unrelated-cache'); // not ours: left alone
    expect(names.filter((n) => n.startsWith('sideline-shell-'))).toHaveLength(1);
  });
});
