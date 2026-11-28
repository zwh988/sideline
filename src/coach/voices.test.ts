import { describe, expect, it } from 'vitest';
import { LEVELS } from '../app/levels';
import { afterPhrase, cueForMoment, cueForSidelineMove, OPENERS, Voice, voiced, VOICES, type Cue } from './voices';

const CUES: Cue[] = ['start', 'good', 'mistake', 'blunder', 'tactic', 'sawThreat', 'thinking', 'ownSlip', 'solved', 'solvedFirstTry', 'missed', 'lessonRight', 'openingDone', 'endgame', 'win', 'loss', 'draw'];
const all = Object.entries(VOICES).flatMap(([id, bank]) => CUES.flatMap((cue) => bank[cue].map((line) => ({ id, cue, line }))));

// The coach's real sentences, one per kind it says (templates.ts, coach.ts, ui.ts).
const FACTS = [
  "Let's play! You're White, so you go first.",
  'Well played! Checkmate, you win.',
  'Checkmate, I win this one. Start a new game when you’re ready.',
  "It's a draw by stalemate.",
  'Nice, that fork wins a rook and a pawn.',
  'Nice, you found mate in one!',
  'Good eye: that bishop was free.',
  'Careful: after Bc4, I can play Nxe5, which takes the pawn for free. That would win a pawn. Want to take it back?',
  'Careful: Qh5 gives me a chance to checkmate you.',
  'Bold! Bxf7+ offers your bishop for a pawn, but the engine rates it among the best moves here. Can you see what you get for it?',
  'You had something stronger than Nc3 here. Want to take it back and look again?',
  "There's something strong here. Take your time.",
  'Good, you saw my threat.',
  "I take your knight on e5. There's something strong here. Take your time.",
  "We're in the endgame now. Kings become fighters here: bring yours toward the middle.",
  'Solved! That’s a fork: your knight attacks the king and the queen.',
  'Not this one. After Kd2, I play Qxe5.',
  'Right: 3.Bb5. It pins the knight.',
];

describe('phrase banks', () => {
  it('every coach has a bank with lines for every moment', () => {
    for (const l of LEVELS) {
      const bank = VOICES[l.coach.id];
      expect(bank, l.coach.id).toBeDefined();
      // A first-try line is optional (the solved lines stand in).
      for (const cue of CUES) if (cue !== 'solvedFirstTry') expect(bank[cue].length, `${l.coach.id}.${cue}`).toBeGreaterThan(0);
    }
  });

  it('never changes the fact text: the bubble ends with it, only a listed opener dropped', () => {
    for (const { line } of all) {
      for (const fact of FACTS) {
        const shown = voiced(fact, line);
        const opener = OPENERS.find((o) => fact.startsWith(o));
        const rest = opener ? fact.slice(opener.length) : fact;
        expect(shown.startsWith(line)).toBe(true);
        // Everything after the opener is kept word for word (its first letter may be capitalised).
        expect(shown.slice(line.length).trim().toLowerCase()).toBe(rest.toLowerCase());
        expect(shown.endsWith(rest.slice(1))).toBe(true);
      }
    }
    // Without a phrase, nothing changes.
    for (const fact of FACTS) expect(voiced(fact)).toBe(fact);
    expect(afterPhrase('Nice, that pin wins a rook.')).toBe('That pin wins a rook.');
    expect(voiced('Good, you saw my threat.', 'Ha, you caught that!')).toBe('Ha, you caught that!');
  });

  it('a phrase states no chess fact: no moves, squares, pieces or outcomes', () => {
    const moves = /\b([a-h][1-8]|[KQRBN]x?[a-h][1-8]|O-O)\b/;
    const words = /\b(pawn|knight|bishop|rook|queen|king|mate|checkmate|wins?|free|material|piece|fork|pin|skewer)s?\b/i;
    for (const { id, cue, line } of all) {
      expect(line, `${id}.${cue}`).not.toMatch(moves);
      expect(line, `${id}.${cue}`).not.toMatch(words);
    }
  });

  it('never calls the coach’s own move good (thinking aloud and its weaker move)', () => {
    const praise = /\b(good|great|nice|strong|brilliant|clever|splendid|lovely|expert|perfect)\b/i;
    for (const { id, cue, line } of all) {
      if (cue === 'thinking') expect(line, `${id}.${cue}`).not.toMatch(praise);
      // "Nobody's perfect" owns a slip; anything else praising would not.
      if (cue === 'ownSlip') expect(line.replace("Well, nobody’s perfect", ''), `${id}.${cue}`).not.toMatch(praise);
    }
  });

  it('keeps to the shared rules: short, at most one CAPS word (one agreed exception), no swearing', () => {
    for (const { id, cue, line } of all) {
      expect(line.split(' ').length, `${id}.${cue}: ${line}`).toBeLessThanOrEqual(12);
      const caps = line.match(/\b[A-Z]{2,}\b/g) ?? [];
      if (line !== 'WHOA, WHOA, WHOA!') expect(caps.length, `${id}.${cue}: ${line}`).toBeLessThanOrEqual(1);
      expect(line).not.toMatch(/\b(damn|hell|crap)\b/i);
    }
  });

  it('Jimmeny calls the player partner in most lines', () => {
    const lines = all.filter((l) => l.id === 'coach3');
    expect(lines.filter((l) => /partner/.test(l.line)).length / lines.length).toBeGreaterThan(0.5);
  });
});

describe('Voice', () => {
  it('drops every phrase for the plain coach', () => {
    const v = new Voice();
    for (const cue of CUES) expect(v.next('coach1', cue, { plain: true })).toBeUndefined();
  });

  it('keeps Sparring to the start, the end and a blunder', () => {
    const v = new Voice();
    expect(v.next('coach1', 'good', { sparring: true })).toBeUndefined();
    expect(v.next('coach1', 'thinking', { sparring: true })).toBeUndefined();
    expect(v.next('coach1', 'start', { sparring: true })).toBeDefined();
    expect(v.next('coach1', 'blunder', { sparring: true })).toBeDefined();
    expect(v.next('coach1', 'win', { sparring: true })).toBeDefined();
  });

  it('rations everyday phrases: at most one bubble in three, never two in a row', () => {
    const v = new Voice();
    const said = Array.from({ length: 30 }, () => v.next('coach2', 'good'));
    for (let i = 0; i < said.length; i++) {
      if (!said[i]) continue;
      expect(said[i + 1]).toBeUndefined();
      expect(said[i + 2]).toBeUndefined();
    }
    expect(said.filter(Boolean).length).toBe(10);
    // Bubbles with no cue count too.
    const w = new Voice();
    expect(w.next('coach2', 'good')).toBeDefined();
    w.next('coach2', undefined);
    expect(w.next('coach2', 'good')).toBeUndefined();
    w.next('coach2', undefined);
    expect(w.next('coach2', 'good')).toBeDefined();
  });

  it('always says the rare ones, and never the same line twice running', () => {
    const v = new Voice();
    const said = Array.from({ length: 12 }, () => v.next('coach1', 'blunder')!);
    expect(said.every(Boolean)).toBe(true);
    for (let i = 1; i < said.length; i++) expect(said[i]).not.toBe(said[i - 1]);
    // Each round uses every line once.
    expect(new Set(said.slice(0, 3)).size).toBe(3);
  });

  it('uses the solved lines when a coach has no first-try line', () => {
    const v = new Voice();
    expect(VOICES.coach1.solved).toContain(v.next('coach1', 'solvedFirstTry'));
    expect(v.next('coach2', 'solvedFirstTry')).toBe('Oh, nice!');
  });

  it('says nothing for an unknown coach', () => {
    expect(new Voice().next('nobody', 'start')).toBeUndefined();
  });
});

describe('cues outside the game (sidelines, Review)', () => {
  it('a sideline move: best or excellent is good, far below the best a mistake or blunder, the rest quiet', () => {
    expect(cueForSidelineMove({ lane: 'best', lossCp: 0 })).toBe('good');
    expect(cueForSidelineMove({ lane: 'great', lossCp: 30 })).toBe('good');
    expect(cueForSidelineMove({ lane: 'good', lossCp: 80 })).toBeUndefined();
    expect(cueForSidelineMove({ lane: 'other', lossCp: 100 })).toBeUndefined();
    expect(cueForSidelineMove({ lane: 'other', lossCp: 200 })).toBe('mistake');
    expect(cueForSidelineMove({ lane: 'other', lossCp: 900 })).toBe('blunder');
  });

  it('a Review moment: the player’s own kinds only', () => {
    expect(cueForMoment('found-tactic')).toBe('good');
    expect(cueForMoment('mistake', 200)).toBe('mistake');
    expect(cueForMoment('mistake', 600)).toBe('blunder');
    expect(cueForMoment('missed-tactic', 300)).toBe('mistake');
    expect(cueForMoment('their-tactic')).toBeUndefined();
    expect(cueForMoment('their-blunder')).toBeUndefined();
  });
});
