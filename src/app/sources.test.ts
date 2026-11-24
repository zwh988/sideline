import { describe, expect, it } from 'vitest';
import { CHESSCOM_PGN, LICHESS_PGN, BAD_MOVE_PGN } from './import-fixtures';
import { cleanUsername, fetchChessCom, fetchLichess, SourceError } from './sources';

/** A fetch that answers from a table by URL and records what was asked. */
function fakeFetch(routes: Record<string, { status?: number; body: unknown }>) {
  const asked: string[] = [];
  const f = (async (url: string) => {
    asked.push(String(url));
    const hit = Object.entries(routes).find(([k]) => String(url).startsWith(k));
    if (!hit) throw new TypeError('network down');
    const { status = 200, body } = hit[1];
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  return { f, asked };
}

describe('usernames', () => {
  it('accepts the characters both services allow and nothing that could change the URL', () => {
    expect(cleanUsername(' DrNykterstein ')).toBe('DrNykterstein');
    expect(cleanUsername('a_b-c9')).toBe('a_b-c9');
    expect(cleanUsername('x')).toBeUndefined();
    expect(cleanUsername('a/b')).toBeUndefined();
    expect(cleanUsername('a b')).toBeUndefined();
    expect(cleanUsername('a?x=1')).toBeUndefined();
  });
});

describe('Lichess', () => {
  it('asks only Lichess, for standard games, and splits the PGN file into games', async () => {
    const { f, asked } = fakeFetch({ 'https://lichess.org/api/games/user/wei': { body: `${LICHESS_PGN}\n\n${BAD_MOVE_PGN}` } });
    const games = await fetchLichess('wei', 20, f);
    expect(games).toHaveLength(2);
    expect(games[0].url).toBe('https://lichess.org/HqjDTU4A');
    expect(games[1].url).toBe('https://lichess.org/AbCdEfGh');
    expect(asked).toHaveLength(1);
    expect(asked[0]).toContain('max=20');
    expect(asked[0]).toContain('perfType=ultraBullet');
    expect(asked[0]).not.toContain('variant');
  });

  it('turns failures into sentences', async () => {
    const f404 = fakeFetch({ 'https://lichess.org': { status: 404, body: '' } }).f;
    await expect(fetchLichess('nobody', 5, f404)).rejects.toThrow('Lichess has no player called "nobody".');
    const f429 = fakeFetch({ 'https://lichess.org': { status: 429, body: '' } }).f;
    await expect(fetchLichess('wei', 5, f429)).rejects.toThrow('too many requests');
    const down = fakeFetch({}).f;
    await expect(fetchLichess('wei', 5, down)).rejects.toThrow(SourceError);
    await expect(fetchLichess('wei', 5, down)).rejects.toThrow('Could not reach Lichess');
  });
});

describe('Chess.com', () => {
  const base = 'https://api.chess.com/pub/player/someplayer/games';
  const month = (n: number, extra: object[] = []) => ({
    games: [
      { pgn: CHESSCOM_PGN, url: `https://www.chess.com/game/live/${n}1`, rules: 'chess' },
      ...extra,
      { pgn: BAD_MOVE_PGN, url: `https://www.chess.com/game/live/${n}2`, rules: 'chess' },
    ],
  });

  it('goes back month by month until it has enough games, newest first, standard chess only', async () => {
    const { f, asked } = fakeFetch({
      [`${base}/archives`]: { body: { archives: [`${base}/2026/09`, `${base}/2026/10`, `${base}/2026/11`] } },
      [`${base}/2026/11`]: { body: month(11, [{ pgn: 'x', url: 'u', rules: 'chess960' }]) },
      [`${base}/2026/10`]: { body: month(10) },
      [`${base}/2026/09`]: { body: month(9) },
    });
    const games = await fetchChessCom('SomePlayer', 3, f);
    expect(games.map((g) => g.url)).toEqual([
      'https://www.chess.com/game/live/112', // newest first within the newest month
      'https://www.chess.com/game/live/111',
      'https://www.chess.com/game/live/102',
    ]);
    expect(asked).toEqual([`${base}/archives`, `${base}/2026/11`, `${base}/2026/10`]); // stopped before September; lower-cased name
  });

  it('only follows archive links that belong to the API', async () => {
    const { f, asked } = fakeFetch({
      [`${base}/archives`]: { body: { archives: ['https://evil.example/steal', `${base}/2026/11`] } },
      [`${base}/2026/11`]: { body: month(11) },
    });
    expect(await fetchChessCom('someplayer', 5, f)).toHaveLength(2);
    expect(asked.some((u) => u.includes('evil'))).toBe(false);
  });

  it('says so when the player does not exist', async () => {
    const f = fakeFetch({ 'https://api.chess.com': { status: 404, body: { code: 0 } } }).f;
    await expect(fetchChessCom('nobody', 5, f)).rejects.toThrow('Chess.com has no player called "nobody".');
  });
});
