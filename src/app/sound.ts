// Sound (task 1.12f): short sounds made in code with Web Audio, no files.
// Board sounds (move, capture, check) are the same for every coach; the
// moment sounds (your blunder, a puzzle solved or missed, the game's end) are
// tuned per coach. Off by default (Settings). No haptics (the user's choice).

import type { Cue } from '../coach/voices';

export type BoardSound = 'move' | 'capture' | 'check';
export type MomentSound = 'blunder' | 'solved' | 'missed' | 'win' | 'loss' | 'draw';
export type SoundEvent = BoardSound | MomentSound;

/** One sound in a recipe: a tone (or a noise burst) starting `at` seconds in. */
export interface Tone {
  at: number;
  dur: number;
  /** Hz; for noise, the band-pass centre. */
  freq: number;
  /** The pitch at the end of the tone (a slide), if it moves. */
  slideTo?: number;
  wave: OscillatorType | 'noise';
  /** Peak gain, 0–1 (the player scales all of it). */
  gain: number;
}

/** A played move's sound from its SAN: check (or mate) first, then a capture, else a plain move. */
export function boardSound(san: string): BoardSound {
  if (/[+#]$/.test(san)) return 'check';
  return san.includes('x') ? 'capture' : 'move';
}

/** The moment sound for a coach's remark, by its cue (voices.ts); most cues are silent. */
export function cueSound(cue: Cue | undefined): MomentSound | undefined {
  switch (cue) {
    case 'blunder':
    case 'missed':
    case 'win':
    case 'loss':
    case 'draw':
      return cue;
    case 'solved':
    case 'solvedFirstTry':
      return 'solved';
    default:
      return undefined;
  }
}

/** A coach's voice for its moment sounds: root note, waveform, note length, and a slide for some. */
interface Timbre {
  root: number;
  wave: OscillatorType;
  step: number;
  /** Semitones each note slides up into place (a twang or a splash); 0 for none. */
  bend: number;
}

/** Per coach id (levels.ts), from their personalities (COACHES.md). */
export const TIMBRES: Record<string, Timbre> = {
  coach1: { root: 587.33, wave: 'triangle', step: 0.075, bend: 0 }, // Beans: bright, bouncy, a kid
  coach2: { root: 493.88, wave: 'square', step: 0.085, bend: 0 }, // Cheese: a reedy little honk
  coach3: { root: 392.0, wave: 'sawtooth', step: 0.1, bend: -2 }, // Jimmeny: a cowboy's twang
  coach4: { root: 440.0, wave: 'sine', step: 0.095, bend: -3 }, // Kelpie: watery slides
  coach5: { root: 523.25, wave: 'sine', step: 0.11, bend: 0 }, // Oscar: a proper little bell
  coach6: { root: 261.63, wave: 'triangle', step: 0.14, bend: 0 }, // Mortimer: low, slow, wooden
};
const DEFAULT_TIMBRE = TIMBRES.coach1;

/** Each moment as notes in semitones from the coach's root, and a length per note (in steps). */
const MELODIES: Record<MomentSound, { notes: number[]; lengths: number[] }> = {
  solved: { notes: [0, 4, 7, 12], lengths: [1, 1, 1, 3] },
  missed: { notes: [-5], lengths: [3] },
  blunder: { notes: [-12, -16], lengths: [2, 4] }, // "uh-oh", an octave down
  win: { notes: [0, 4, 7, 12, 7, 12], lengths: [1, 1, 1, 2, 1, 4] },
  loss: { notes: [7, 5, 3, 0], lengths: [2, 2, 2, 5] },
  draw: { notes: [0, 5, 0], lengths: [2, 2, 4] },
};

const semis = (root: number, n: number) => root * 2 ** (n / 12);

/** The tones for an event; board sounds ignore the coach. */
export function recipe(event: SoundEvent, coachId: string): Tone[] {
  switch (event) {
    // A wooden tap: a short noise click over a falling thump.
    case 'move':
      return [
        { at: 0, dur: 0.035, freq: 1800, wave: 'noise', gain: 0.5 },
        { at: 0, dur: 0.07, freq: 190, slideTo: 120, wave: 'sine', gain: 0.6 },
      ];
    case 'capture':
      return [
        { at: 0, dur: 0.05, freq: 1200, wave: 'noise', gain: 0.7 },
        { at: 0, dur: 0.11, freq: 150, slideTo: 85, wave: 'triangle', gain: 0.8 },
        { at: 0.045, dur: 0.04, freq: 2400, wave: 'noise', gain: 0.35 },
      ];
    case 'check':
      return [
        { at: 0, dur: 0.035, freq: 1800, wave: 'noise', gain: 0.4 },
        { at: 0.02, dur: 0.12, freq: 1318.5, wave: 'sine', gain: 0.35 },
        { at: 0.1, dur: 0.16, freq: 1760, wave: 'sine', gain: 0.3 },
      ];
  }
  const t = TIMBRES[coachId] ?? DEFAULT_TIMBRE;
  const { notes, lengths } = MELODIES[event];
  // Harsh waves are quieter so every coach sounds about as loud.
  const gain = t.wave === 'sine' ? 0.4 : t.wave === 'triangle' ? 0.35 : 0.14;
  const tones: Tone[] = [];
  let at = 0;
  notes.forEach((n, i) => {
    const dur = t.step * lengths[i];
    const freq = semis(t.root, n);
    tones.push(t.bend ? { at, dur, freq: semis(t.root, n + t.bend), slideTo: freq, wave: t.wave, gain } : { at, dur, freq, wave: t.wave, gain });
    at += t.step * (lengths[i] > 1 ? Math.min(lengths[i], 2) : 1);
  });
  return tones;
}

/** Plays recipes. The audio context starts on the first sound or `unlock()` (browsers need a tap first). */
export class Sound {
  enabled = false;
  private ctx?: AudioContext;
  private noise?: AudioBuffer;

  /** Call from a tap: phones only start audio inside a user gesture. */
  unlock(): void {
    if (!this.enabled) return;
    const ctx = this.context();
    if (ctx?.state === 'suspended') void ctx.resume();
  }

  board(san: string, coachId = ''): void {
    this.play(boardSound(san), coachId);
  }

  cue(cue: Cue | undefined, coachId: string, delay = 0.12): void {
    const s = cueSound(cue);
    if (s) this.play(s, coachId, delay);
  }

  play(event: SoundEvent, coachId: string, delay = 0): void {
    if (!this.enabled || (typeof document !== 'undefined' && document.hidden)) return;
    const ctx = this.context();
    if (!ctx) return;
    if (ctx.state === 'suspended') void ctx.resume();
    const t0 = ctx.currentTime + 0.01 + delay;
    for (const tone of recipe(event, coachId)) this.tone(ctx, tone, t0);
  }

  private context(): AudioContext | undefined {
    if (this.ctx) return this.ctx;
    const AC = typeof window !== 'undefined' ? (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext) : undefined;
    if (!AC) return undefined;
    try {
      this.ctx = new AC();
    } catch {
      return undefined;
    }
    return this.ctx;
  }

  private tone(ctx: AudioContext, tone: Tone, t0: number): void {
    const start = t0 + tone.at;
    const end = start + tone.dur;
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0.0001, start);
    amp.gain.exponentialRampToValueAtTime(tone.gain * 0.5, start + Math.min(0.006, tone.dur / 4));
    amp.gain.exponentialRampToValueAtTime(0.0001, end);
    amp.connect(ctx.destination);
    let src: AudioScheduledSourceNode;
    if (tone.wave === 'noise') {
      const n = ctx.createBufferSource();
      n.buffer = this.noiseBuffer(ctx);
      const band = ctx.createBiquadFilter();
      band.type = 'bandpass';
      band.frequency.value = tone.freq;
      band.Q.value = 1.2;
      n.connect(band).connect(amp);
      src = n;
    } else {
      const o = ctx.createOscillator();
      o.type = tone.wave;
      o.frequency.setValueAtTime(tone.freq, start);
      if (tone.slideTo) o.frequency.exponentialRampToValueAtTime(tone.slideTo, start + Math.min(tone.dur, 0.06));
      o.connect(amp);
      src = o;
    }
    src.start(start);
    src.stop(end + 0.02);
  }

  private noiseBuffer(ctx: AudioContext): AudioBuffer {
    if (this.noise) return this.noise;
    const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * 0.1), ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return (this.noise = buf);
  }
}
