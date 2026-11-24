// A saved game as PGN: headers, the moves, the coach's remarks as comments,
// and the sidelines the player tried as variations. Standard enough to open
// in Chess.com, Lichess or any PGN reader. Pure functions over chess.js.
import { Chess } from 'chess.js';
import type { SavedGame, SavedSideline } from './store';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

const tag = (name: string, value: string) => `[${name} "${value.replace(/[\\"]/g, '\\$&')}"]`;
/** PGN comments end at the first "}", so braces are dropped from the coach's words. */
const comment = (text: string) => `{${text.replace(/[{}]/g, '').replace(/\s+/g, ' ').trim()}}`;

function resultTag(g: SavedGame): string {
  if (!g.result) return '*';
  return g.result.winner === 'white' ? '1-0' : g.result.winner === 'black' ? '0-1' : '1/2-1/2';
}

function pgnDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
}

/** SANs of UCI moves played from `fen`; stops at the first illegal move. */
function sansFrom(fen: string, ucis: string[]): string[] {
  const chess = new Chess(fen);
  const out: string[] = [];
  for (const u of ucis) {
    try {
      out.push(chess.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] }).san);
    } catch {
      break;
    }
  }
  return out;
}

/** Numbers each move from `fen`: "5. Bc4 Nxd4", or "5... Nxd4" when the line starts with Black. */
function numbered(fen: string, sans: string[], forceFirst = true): string {
  const [, turn, , , , full] = fen.split(' ');
  let number = Number(full) || 1;
  let white = turn !== 'b';
  const parts: string[] = [];
  sans.forEach((san, i) => {
    if (white) parts.push(`${number}. ${san}`);
    else parts.push(i === 0 && forceFirst ? `${number}... ${san}` : san);
    if (!white) number++;
    white = !white;
  });
  return parts.join(' ');
}

function variation(s: SavedSideline): string {
  const sans = sansFrom(s.rootFen, s.moves.map((m) => m.uci));
  return sans.length ? `(${numbered(s.rootFen, sans)})` : '';
}

export function gameToPgn(g: SavedGame): string {
  const coach = `Coach (level ${g.level})`;
  const im = g.imported;
  // An imported game keeps the names and details it came with.
  const headers = im
    ? [
        tag('Event', im.event ?? '?'),
        tag('Site', im.site ?? '?'),
        tag('Date', im.date ?? pgnDate(g.startedAt)),
        tag('Round', '-'),
        tag('White', im.white),
        tag('Black', im.black),
        tag('Result', resultTag(g)),
        ...(im.whiteElo ? [tag('WhiteElo', im.whiteElo)] : []),
        ...(im.blackElo ? [tag('BlackElo', im.blackElo)] : []),
        ...(im.timeControl ? [tag('TimeControl', im.timeControl)] : []),
      ]
    : [
        tag('Event', 'Sideline coached game'),
        tag('Site', 'Sideline'),
        tag('Date', pgnDate(g.startedAt)),
        tag('Round', '-'),
        tag('White', g.playerColor === 'white' ? 'You' : coach),
        tag('Black', g.playerColor === 'black' ? 'You' : coach),
        tag('Result', resultTag(g)),
      ];
  if (g.startFen !== START_FEN) headers.push(tag('SetUp', '1'), tag('FEN', g.startFen));

  const sans = sansFrom(g.startFen, g.moves);
  const out: string[] = [];
  const say = (ply: number) =>
    g.remarks
      .filter((r) => r.ply === ply)
      .map((r) => comment(r.remark.text))
      .filter((c) => c !== '{}');

  // The game's start (remarks said before the first move).
  out.push(...say(0));
  // Sidelines are alternatives to the game move that followed their position.
  // (only when the sideline's position is on the game's line; after a takeback it may not be).
  const fens = [g.startFen];
  const replay = new Chess(g.startFen);
  for (const u of g.moves.slice(0, sans.length)) {
    replay.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] });
    fens.push(replay.fen());
  }
  const samePosition = (a: string, b: string) => a.split(' ').slice(0, 4).join(' ') === b.split(' ').slice(0, 4).join(' ');
  const onLine = (s: SavedSideline) => s.ply < sans.length && samePosition(s.rootFen, fens[s.ply]);
  const sidelinesAfter = (ply: number) => g.sidelines.filter((s) => s.ply === ply - 1 && onLine(s));
  let afterBreak = true; // a comment or variation was just written: repeat Black's move number
  const [, turn, , , , full] = g.startFen.split(' ');
  let number = Number(full) || 1;
  let white = turn !== 'b';
  sans.forEach((san, i) => {
    const ply = i + 1;
    out.push(white ? `${number}. ${san}` : afterBreak || i === 0 ? `${number}... ${san}` : san);
    afterBreak = false;
    for (const s of sidelinesAfter(ply)) {
      const v = variation(s);
      if (v) {
        out.push(v);
        afterBreak = true;
      }
    }
    for (const c of say(ply)) {
      out.push(c);
      afterBreak = true;
    }
    if (!white) number++;
    white = !white;
  });
  // A sideline with no game move to be an alternative to (at the very end, or off the line) is kept as a comment.
  for (const s of g.sidelines.filter((x) => !onLine(x))) {
    const sanLine = numbered(s.rootFen, sansFrom(s.rootFen, s.moves.map((m) => m.uci)));
    if (sanLine) out.push(comment(`Sideline tried here: ${sanLine}`));
  }
  out.push(resultTag(g));
  return `${headers.join('\n')}\n\n${out.join(' ')}\n`;
}
