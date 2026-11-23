// The game modes from the spec ("Modes" table). The coach's trigger rules
// (src/coach/coach.ts) and the game screen read these switches.
//
//   Lesson:   frequent talk, hints offered, takebacks allowed, reveals its plans.
//   Sparring: serious moments only, hints only on request, no takebacks,
//             no plans revealed.

export type ModeId = 'lesson' | 'sparring';

export interface Mode {
  id: ModeId;
  name: string;
  /** Offers help unasked: "There's something strong here", "what does my last move want?" (hint step 1). */
  prompts: boolean;
  /** Talk beyond the serious moments: phase prompts, "Good, you saw my threat", praise for a sound sacrifice. */
  smallTalk: boolean;
  /**
   * Flags hung material smaller than the level's mistake size (a loose pawn,
   * or a piece below the level's smallest taught gain). Sparring flags only
   * the level's real mistakes.
   */
  minorMistakes: boolean;
  /** Takeback button, and the takeback offer after a mistake. */
  takebacks: boolean;
  /**
   * Thinks aloud on its own moves and names what it can do next (the
   * refutation of a mistake). Off in Sparring: the coach's moves speak for
   * themselves, and a mistake is flagged without saying how it is punished.
   */
  revealsPlans: boolean;
  /** "Try a sideline": playing a move or a short line out with the coach before committing (spec: not in Sparring). */
  sidelines: boolean;
}

export const MODES: Mode[] = [
  { id: 'lesson', name: 'Lesson', prompts: true, smallTalk: true, minorMistakes: true, takebacks: true, revealsPlans: true, sidelines: true },
  { id: 'sparring', name: 'Sparring', prompts: false, smallTalk: false, minorMistakes: false, takebacks: false, revealsPlans: false, sidelines: false },
];

export const modeInfo = (id: string | undefined): Mode => MODES.find((m) => m.id === id) ?? MODES[0];
