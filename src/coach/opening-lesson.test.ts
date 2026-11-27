// Walk order and answer checking of a lesson (task 6.2), on the real course
// files (built in 6.1): the Vienna (White) and the Caro-Kann (Black).
import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import type { CourseTree } from './opening-tree';
import { courseLines, isCourseMove, judgeAlternative, lessonSteps, lineStatuses, nextLine, pathKey, playerNodes, quizNodes, type CourseLine } from './opening-lesson';
import { branchWords, compareWords, definingText, goalQuestion, ideaHint, ideaSentence, introWords, moveLabel, punishWords, shownWords, trapWords } from './opening-words';
import { defends } from './opening-ideas';
import { OpeningProgress } from '../app/openingstore';

const RAW = import.meta.glob('../../public/openings/*.json', { eager: true, query: '?raw', import: 'default' }) as Record<string, string>;
const load = (id: string): CourseTree => JSON.parse(RAW[`../../public/openings/${id}.json`]);
const vienna = load('vienna-white');
const caro = load('caro-kann-black');
const sans = (l: CourseLine) => l.nodes.map((n) => n.san).join(' ');
const find = (t: CourseTree, tier: number, moves: string) => courseLines(t, tier).find((l) => sans(l) === moves)!;

describe('course lines', () => {
  it('lists every branch at the tier, most common first, each ending with a player move', () => {
    for (const [tree, tier] of [[vienna, 1], [vienna, 6], [caro, 1], [caro, 6]] as const) {
      const lines = courseLines(tree, tier);
      expect(lines.length).toBeGreaterThan(3);
      for (let i = 1; i < lines.length; i++) expect(lines[i - 1].reach).toBeGreaterThanOrEqual(lines[i].reach);
      for (const l of lines) {
        expect(l.nodes.at(-1)!.who).toBe('player');
        expect(l.nodes.every((n) => n.tier <= tier)).toBe(true);
        // Every line is a legal game from the start.
        const c = new Chess();
        for (const n of l.nodes) expect(c.move(n.san).san).toBe(n.san);
      }
      // Together the lines cover every player move of the tier.
      const covered = new Set(lines.flatMap((l) => quizNodes(l).map((n) => n.id)));
      expect(covered.size).toBe(playerNodes(tree, tier).length);
    }
  });

  it('starts with the most common reply at the coach’s band', () => {
    // Under 1000 (tiers 1–2), 2…Bc5 then 3.Bc4 is the most reached line: 10% of games.
    expect(sans(courseLines(vienna, 1)[0])).toBe('e4 e5 Nc3 Bc5 Bc4');
    expect(sans(courseLines(caro, 1)[0])).toBe('e4 c6 Nf3 d5 exd5 cxd5');
    // A stronger coach covers more lines, and the lower tier's moves are all still there.
    expect(courseLines(vienna, 6).length).toBeGreaterThan(courseLines(vienna, 1).length);
    const six = new Set(playerNodes(vienna, 6).map((n) => n.id));
    expect(playerNodes(vienna, 1).every((n) => six.has(n.id))).toBe(true);
  });

  it('marks lines with a trap', () => {
    const l = find(vienna, 1, 'e4 e5 Nc3 Nf6 f4 exf4 e5 Ng4 Qxg4');
    expect(l.trap).toBe(true);
    expect(find(vienna, 1, 'e4 e5 Nc3 Nf6 f4 exf4 e5 Ng8 Nf3').trap).toBe(false);
  });
});

describe('lesson walk', () => {
  const none = () => false;

  it('shows the defining moves and theirs, asks yours, and gives the shares at a branch', () => {
    const l = find(vienna, 1, 'e4 e5 Nc3 Nf6 f4 exf4 e5 Ng8 Nf3');
    const { steps, practice } = lessonSteps(vienna, l, 1, none);
    expect(practice).toBe(false);
    expect(steps.map((s) => `${s.node.san}:${s.kind}`)).toEqual(['e4:auto', 'e5:auto', 'Nc3:auto', 'Nf6:auto', 'f4:quiz', 'exf4:auto', 'e5:quiz', 'Ng8:auto', 'Nf3:quiz']);
    // 2…Nf6 is one of three replies taught at tier 1 (Nf6, Nc6, Bc5); the defining 1…e5 is no branch.
    expect(steps[3].branch?.map((n) => n.san).sort()).toEqual(['Bc5', 'Nc6', 'Nf6']);
    expect(steps[1].branch).toBeUndefined();
  });

  it('plays learned moves by itself, so the next line asks only what is new', () => {
    const l = find(vienna, 1, 'e4 e5 Nc3 Nf6 f4 exf4 e5 Ng4 Qxg4');
    const learned = new Set(['e2e4 e7e5 b1c3 g8f6 f2f4', 'e2e4 e7e5 b1c3 g8f6 f2f4 e5f4 e4e5']);
    const { steps } = lessonSteps(vienna, l, 1, (k) => learned.has(k));
    expect(steps.filter((s) => s.kind === 'quiz').map((s) => s.node.san)).toEqual(['Qxg4']);
    const trap = steps.find((s) => s.trap)!;
    expect(trap.node.san).toBe('Ng4');
    // The trap's punishment is the next step.
    expect(steps[steps.indexOf(trap) + 1].node.san).toBe('Qxg4');
  });

  it('asks every move again on a line already learned (practice)', () => {
    const l = courseLines(caro, 1)[0];
    const keys = new Set(quizNodes(l).map((n) => pathKey(caro, n)));
    const { steps, practice } = lessonSteps(caro, l, 1, (k) => keys.has(k));
    expect(practice).toBe(true);
    expect(steps.filter((s) => s.kind === 'quiz').map((s) => s.node.san)).toEqual(['d5', 'cxd5']);
    // 1…c6 is defining: never asked.
    expect(steps[1]).toMatchObject({ kind: 'auto' });
  });

  it('marks learned and next lines, and Next line starts the most common unlearned one', () => {
    const lines = courseLines(caro, 1);
    const keys = new Set(quizNodes(lines[0]).map((n) => pathKey(caro, n)));
    const st = lineStatuses(caro, lines, (k) => keys.has(k));
    expect(st[0]).toBe('learned');
    expect(st.indexOf('next')).toBe(1);
    expect(st.filter((s) => s === 'next')).toHaveLength(1);
    expect(nextLine(caro, lines, (k) => keys.has(k))).toBe(lines[1]);
    const all = new Set(lines.flatMap((l) => quizNodes(l).map((n) => pathKey(caro, n))));
    expect(nextLine(caro, lines, (k) => all.has(k))).toBe(lines[0]);
  });
});

describe('answer checking', () => {
  it('knows the course move by its SAN, castling included', () => {
    const l = find(vienna, 1, 'e4 e5 Nc3 Nf6 f4 exf4 e5 Ng8 Nf3');
    const f4 = l.nodes[4];
    const before = vienna.nodes[f4.parent].fen;
    expect(isCourseMove(before, 'f2f4', f4)).toBe(true);
    expect(isCourseMove(before, 'g1f3', f4)).toBe(false);
    expect(isCourseMove(before, 'a1a8', f4)).toBe(false); // illegal
    const castle = vienna.nodes.find((n) => n.who === 'player' && n.san === 'O-O')!;
    expect(isCourseMove(vienna.nodes[castle.parent].fen, 'e1g1', castle)).toBe(true);
  });

  it('judges another move by the engine: fine within the slack, weaker, or a mistake', () => {
    expect(judgeAlternative(20, 0)).toBe('fine');
    expect(judgeAlternative(50, 10)).toBe('fine');
    // A gambit's own course move gives away 70: anything as good is fine too.
    expect(judgeAlternative(65, 70)).toBe('fine');
    expect(judgeAlternative(90, 25)).toBe('weaker');
    expect(judgeAlternative(151, 25)).toBe('mistake');
  });
});

describe('the coach’s words', () => {
  it('numbers moves', () => {
    expect(moveLabel(vienna.nodes[3].fen, 'Nf6')).toBe('2…Nf6');
    expect(moveLabel(vienna.nodes[4].fen, 'f4')).toBe('3.f4');
    expect(definingText(vienna)).toBe('1.e4 e5 2.Nc3');
    expect(definingText(caro)).toBe('1.e4 c6');
  });

  it('builds the intro from the data: the opening, its moves, the replies at the band', () => {
    const t1 = introWords(vienna, 1);
    expect(t1).toContain('The Vienna Game: 1.e4 e5 2.Nc3. You play it as White.');
    expect(t1).toMatch(/2…Nf6 \(35%\)/);
    expect(introWords(caro, 1)).toMatch(/^The Caro-Kann Defence: 1\.e4 c6\. You play it as Black\. At this level, the most common reply is 2\.(Nf3|d4)/);
  });

  it('gives the shares at a branch, and a trap its own beat', () => {
    const l = find(vienna, 1, 'e4 e5 Nc3 Nf6 f4 exf4 e5 Ng4 Qxg4');
    const steps = lessonSteps(vienna, l, 1, () => false).steps;
    const words = branchWords(vienna, steps[3], 1);
    expect(words).toMatch(/^At this level, the most common reply is 2…Nf6 \(35%\); some play 2…Nc6 \(\d+%\) or 2…Bc5 \(\d+%\)\. This lesson follows 2…Nf6\./);
    const trap = steps.find((s) => s.trap)!;
    expect(trapWords(vienna, trap.node, 1)).toMatch(/^Some players play 4…Ng4\? \(\d+% at this level\)\. The engine calls it a mistake/);
    // The trap is not listed with the plain replies.
    expect(branchWords(vienna, trap, 1)).not.toContain('Ng4');
    const punish = steps[steps.indexOf(trap) + 1].node;
    // 5.Qxg4 is one capture: the idea already says "It takes the knight."
    expect(punishWords(vienna, trap.node, punish)).toBe('');
    const qe7 = find(vienna, 1, 'e4 e5 Nc3 Nf6 f4 exf4 e5 Qe7 Qe2');
    expect(punishWords(vienna, qe7.nodes[7], qe7.nodes[8])).toBe("The engine's line 5.Qe2 Ng8 6.d4 Nc6 7.Nf3 d5 8.Nxd5 wins a pawn.");
  });

  it('words the idea tags, more of them for a deeper coach', () => {
    const f4 = find(vienna, 1, 'e4 e5 Nc3 Nf6 f4 exf4 e5 Ng8 Nf3').nodes[4];
    expect(ideaSentence(f4.tags, 1)).toBe('It offers a pawn.');
    expect(ideaSentence(f4.tags, 6)).toBe('It offers a pawn, attacks the undefended pawn on e5 and fights for the centre (e5).');
    expect(ideaHint(f4.tags)).toMatch(/gambit/);
    const nc3 = vienna.nodes[3];
    expect(ideaHint(nc3.tags)).toBe('Develop a piece: your knight.');
  });
});

describe('progress on the device', () => {
  const memory = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
  };

  it('keeps learned moves per course, counted for a coach by the move’s own tier', () => {
    const s = memory();
    const p = new OpeningProgress(s);
    p.learn('vienna-white', 'a', 1, 1);
    p.learn('vienna-white', 'b', 6, 4);
    p.learn('vienna-white', 'a', 6, 1); // already learned: the first stays
    expect(p.countFor('vienna-white', 1)).toBe(1);
    expect(p.countFor('vienna-white', 6)).toBe(2);
    expect(p.learned('vienna-white').a.tier).toBe(1);
    const again = new OpeningProgress(s);
    expect(again.isLearned('vienna-white', 'b')).toBe(true);
    again.setCurrent({ course: 'caro-kann-black', tier: 1, line: 'x', at: 1 });
    expect(new OpeningProgress(s).current?.course).toBe('caro-kann-black');
  });

  it('merges a backup', () => {
    const p = new OpeningProgress(memory());
    p.learn('caro-kann-black', 'a', 2, 1, 500);
    expect(p.importAll({ 'caro-kann-black': { a: { tier: 1, node: 1, at: 100 }, b: { tier: 1, node: 1, at: 100 }, bad: { tier: 'x' } } })).toBe(1);
    expect(p.learned('caro-kann-black').a.at).toBe(100);
    expect(p.countFor('caro-kann-black', 1)).toBe(2);
  });
});

describe('goal first (the Learn rework)', () => {
  const after = (moves: string[]) => {
    const c = new Chess();
    for (const m of moves) c.move(m);
    return c.fen();
  };

  it('finds the attacked piece a move defends', () => {
    // 1.e4 c6 2.d4 d5: the pawn on e4 is attacked; 3.Nc3 defends it, 3.e5 moves it (not a defence).
    const fen = after(['e4', 'c6', 'd4', 'd5']);
    expect(defends(fen, 'b1c3')).toEqual([{ square: 'e4', piece: 'p' }]);
    expect(defends(fen, 'e4e5')).toEqual([]);
    expect(defends(fen, 'g1f3')).toEqual([]);
  });

  it('states the goal before asking, without naming the move', () => {
    const l = find(vienna, 1, 'e4 e5 Nc3 Nf6 f4 exf4 e5 Ng8 Nf3');
    const q = (i: number) => goalQuestion(vienna.nodes[l.nodes[i].parent].fen, l.nodes[i]);
    // 3.f4 offers a pawn, but the goal is the pawn on e5 it attacks.
    expect(q(4)).toBe('Attack something of theirs: look at the pawn on e5. Which move does that?');
    expect(q(8)).toBe('Develop a piece: your knight. Which move does that?');
    const caroLine = find(caro, 1, 'e4 c6 Nf3 d5 exd5 cxd5');
    expect(goalQuestion(caro.nodes[caroLine.nodes[5].parent].fen, caroLine.nodes[5])).toBe('Take back. Which move does that?');
    for (const n of quizNodes(l)) expect(q(l.nodes.indexOf(n))).not.toContain(n.san);
  });

  it('says what a wrong move does against what the course move does', () => {
    const l = find(vienna, 1, 'e4 e5 Nc3 Nf6 f4 exf4 e5 Ng8 Nf3');
    const fen = vienna.nodes[l.nodes[4].parent].fen;
    // 3.Bc4 instead of 3.f4: it develops, but it does not attack e5.
    expect(compareWords(fen, 'f1c4', l.nodes[4], 1)).toBe("Bc4 develops the bishop. But it doesn't attack the undefended pawn on e5 and fight for the centre (e5), and that is what this course does here.");
    expect(compareWords(fen, 'a1a8', l.nodes[4], 1)).toBe('');
  });

  it('words every shown move', () => {
    const l = find(vienna, 1, 'e4 e5 Nc3 Nf6 f4 exf4 e5 Ng8 Nf3');
    const learned = new Set(['e2e4 e7e5 b1c3 g8f6 f2f4']);
    const { steps } = lessonSteps(vienna, l, 1, (k) => learned.has(k));
    expect(shownWords(vienna, steps[0], 1)).toMatch(/^1\.e4 /);
    expect(shownWords(vienna, steps[4], 1)).toMatch(/^You know this one\. 3\.f4 offers a pawn/);
    expect(shownWords(vienna, steps[5], 1)).toMatch(/^3…exf4 takes the pawn\. At this level, most players reply 3…exf4 \(52%\)/);
    expect(shownWords(vienna, steps[7], 1)).toMatch(/At this level, the most common reply is 4…Ng8/);
  });
});
