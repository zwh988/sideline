import { describe, expect, it } from 'vitest';
import { cutLine, type TaughtLine } from './lines';
import { narrateLine, praise, winsPhrase } from './templates';

function line(fen: string, pv: string[], evalCp: number, mateIn?: number): TaughtLine {
  const r = cutLine(fen, pv, { maxPlies: 6, minGain: 3, evalCp, mateIn });
  if (r.kind !== 'line') throw new Error(`no line: ${r.kind}`);
  return r.line;
}

const FORK = 'r3kb1r/ppp2ppp/8/3N4/8/8/PPP2PPP/R3KB1R w KQkq - 0 1';

describe('templates', () => {
  it('narrates a fork line with a forced reply', () => {
    const l = line(FORK, ['d5c7', 'e8d7', 'c7a8', 'f8d6'], 650);
    l.moves[1].forced = true;
    expect(narrateLine(l)).toBe(
      'Nxc7+ attacks the king and the rook at once. After Kd7 (forced), Nxa8 takes the rook for free. That wins a rook and a pawn.',
    );
    expect(praise(l)).toBe('Nice, that fork wins a rook and a pawn.');
  });

  it('names a net trade honestly', () => {
    const l = line('6k1/5ppp/4p3/3r4/8/1BN5/5PPP/6K1 w - - 0 1', ['b3d5', 'e6d5', 'c3d5', 'g8f8'], 320);
    expect(winsPhrase(l)).toBe('a rook and a pawn for a bishop');
  });

  it('praises winning a defended queen without calling it free', () => {
    const l = line('r1bqkbnr/ppp2ppp/2np4/8/2BQP3/5N2/PPP2PPP/RNB1K2R b KQkq - 1 5', ['c6d4', 'f3d4', 'g8f6'], 600);
    expect(praise(l)).toBe('Good eye: that wins a queen for a knight.');
  });

  it('narrates mate in one', () => {
    const l = line('r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4', ['h5f7'], 0, 1);
    expect(narrateLine(l)).toBe('Qxf7# is checkmate.');
    expect(praise(l)).toBe('Nice, you found mate in one!');
  });
});
