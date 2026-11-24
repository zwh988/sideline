// A player's own public games from the Chess.com and Lichess APIs. Only runs
// when the player asks (they type their username in the import dialog); the
// username goes to that service and nowhere else. Both services answer
// cross-origin requests from any site (`Access-Control-Allow-Origin: *`,
// checked 2026-11-24: see STATE), so this works from a static page.
//
// Requests are plain GETs with no custom headers (no preflight, no keys).

export type Fetch = typeof fetch;

export interface FetchedGame {
  pgn: string;
  /** The game's page on the service, when the API gives one. */
  url?: string;
}

export class SourceError extends Error {}

const TIMEOUT_MS = 25_000;

/** Usernames on both services are letters, digits, "_" and "-". */
export function cleanUsername(raw: string): string | undefined {
  const name = raw.trim();
  return /^[A-Za-z0-9_-]{2,30}$/.test(name) ? name : undefined;
}

async function get(fetcher: Fetch, url: string, service: string, user: string): Promise<Response> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetcher(url, { signal: ctl.signal });
    if (res.status === 404) throw new SourceError(`${service} has no player called "${user}".`);
    if (res.status === 429) throw new SourceError(`${service} says too many requests. Wait a minute and try again.`);
    if (!res.ok) throw new SourceError(`${service} answered with an error (${res.status}).`);
    return res;
  } catch (e) {
    if (e instanceof SourceError) throw e;
    throw new SourceError(
      ctl.signal.aborted ? `${service} took too long to answer.` : `Could not reach ${service}. Check your connection and try again.`,
    );
  } finally {
    clearTimeout(timer);
  }
}

/** The latest `max` standard-chess games of a Lichess user, newest first. */
export async function fetchLichess(user: string, max = 20, fetcher: Fetch = fetch): Promise<FetchedGame[]> {
  const q = new URLSearchParams({
    max: String(max),
    // Standard chess only (these are every variant-free rating category).
    perfType: 'ultraBullet,bullet,blitz,rapid,classical,correspondence',
    moves: 'true',
    tags: 'true',
    clocks: 'false',
    evals: 'false',
    opening: 'false',
    literate: 'false',
  });
  const res = await get(fetcher, `https://lichess.org/api/games/user/${encodeURIComponent(user)}?${q}`, 'Lichess', user);
  const text = await res.text();
  return splitServerPgn(text).map((pgn) => {
    const id = /\[Site "https:\/\/lichess\.org\/(\w+)"\]/.exec(pgn)?.[1];
    return { pgn, url: id ? `https://lichess.org/${id}` : undefined };
  });
}

/** A PGN file with several games, cut into one string per game. */
function splitServerPgn(text: string): string[] {
  return text
    .split(/\n\s*\n(?=\[Event )/)
    .map((g) => g.trim())
    .filter(Boolean);
}

interface ChessComMonth {
  games?: { pgn?: string; url?: string; rules?: string }[];
}

/**
 * The latest `max` standard-chess games of a Chess.com user, newest first.
 * Chess.com serves one month per request (a busy month can be several MB),
 * so months are fetched from the newest back until there are enough games.
 */
export async function fetchChessCom(user: string, max = 20, fetcher: Fetch = fetch, maxMonths = 4): Promise<FetchedGame[]> {
  const base = `https://api.chess.com/pub/player/${encodeURIComponent(user.toLowerCase())}/games`;
  const archives = (await (await get(fetcher, `${base}/archives`, 'Chess.com', user)).json()) as { archives?: string[] };
  const months = [...(archives.archives ?? [])].reverse().slice(0, maxMonths);
  const out: FetchedGame[] = [];
  for (const month of months) {
    if (!/^https:\/\/api\.chess\.com\/pub\/player\/[^/]+\/games\/\d{4}\/\d{2}$/.test(month)) continue; // only the API's own archive links
    const data = (await (await get(fetcher, month, 'Chess.com', user)).json()) as ChessComMonth;
    const games = (data.games ?? []).filter((g) => g.pgn && (!g.rules || g.rules === 'chess')).reverse();
    for (const g of games) out.push({ pgn: g.pgn!, url: g.url });
    if (out.length >= max) break;
  }
  return out.slice(0, max);
}
