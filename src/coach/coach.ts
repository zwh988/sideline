// When the coach speaks (spec): rules, not the AI model, decide. The coach
// mostly stays quiet, and every fact it states comes from the analyst.
//
//   Tactic available to the player   → "There's something strong here, take your time."
//   Opponent threat the player may miss → "Before you move, what does my last move want?"
//   Player mistake (level's concepts) → explain briefly, offer a takeback
//   Player found the tactic           → short praise naming the pattern
//   New phase                         → planning prompt
//   The coach's own move              → think aloud (narration.ts), under the budget
//   Nothing important                 → silence
//
// The mode (src/app/modes.ts) trims this: Sparring drops the unasked prompts,
// small talk, takeback offers and thinking aloud, and flags a mistake without
// saying how the coach would punish it.
import { Chess, type Square } from 'chess.js';
import type { Level } from '../app/levels';
import { MODES, type Mode } from '../app/modes';
import type { Analyst, PositionEval } from './analyst';
import type { TaughtLine } from './lines';
import { checkLine, type LineEvaluator, type LineMove } from './linecheck';
import { lineConceptOf, offeredMaterial, type NoteConcept } from './explain';
import { narrateSidelineMove, sidelineReplyText } from './sideline';
import { failedRecapture, PIECE_NAME, playAndDescribe, type FailedRecapture } from './facts';
import { coachMoveFacts } from './narration';
import {
  byImportance,
  capitalize,
  failedRecapturePhrase,
  moveWithWhich,
  narrateCoachMove,
  narrateLine,
  pieceRef,
  praise,
  targetList,
  winsPhrase,
  type Narration,
  type NarrationPriority,
} from './templates';

export type Mood = 'neutral' | 'thinking' | 'pleased' | 'concerned' | 'surprised';

export interface Shape {
  orig: Square;
  dest?: Square;
  brush: 'green' | 'red' | 'blue' | 'yellow' | 'paleGrey' | 'paleRed';
  /** Text on the arrow: the step number of a line. */
  label?: string;
}

/**
 * A moment worth remembering (spec: the record the improvement loop works
 * from): the position the player decided in, what they played, and what the
 * coach found, with the concept when a detector named one.
 */
export interface Moment {
  kind: 'mistake' | 'missed-tactic' | 'found-tactic';
  /** The position before the player's move. */
  fen: string;
  /** The player's move (UCI). */
  played: string;
  /** The coach's answer to a mistake, or the tactic's first move for a missed one (UCI). */
  better?: string;
  /** A Lichess-style theme name ("fork", "hangingPiece"...), or none when no detector found one. */
  concept?: string;
  /** What the move cost against the engine's best, in centipawns (mistakes and missed tactics). */
  lossCp?: number;
}

export interface Remark {
  kind: 'tactic' | 'threat' | 'mistake' | 'missed-tactic' | 'praise' | 'defended' | 'phase' | 'hint' | 'narration' | 'line';
  text: string;
  mood: Mood;
  offerTakeback?: boolean;
  /** Lesson: invite the player to try their idea in a sideline. */
  offerSideline?: boolean;
  shapes?: Shape[];
  /** Set on a mistake, a missed tactic or a found tactic: saved with the game. */
  moment?: Moment;
}

/** What the coach knows about the position on the player's turn. */
interface TurnFacts {
  fen: string;
  ev: PositionEval;
  tactic?: TaughtLine; // the player can win something (within their level)
  threat?: TaughtLine; // the opponent threatens something (within their level)
}

/** Low-priority remarks wait at least this many plies after the last remark. */
const BUDGET_PLIES = 6;
/**
 * Hung material is flagged below the level's mistake size when the evaluation
 * drops by at least this much per pawn the coach wins (most of the material).
 * Gambits stay below it: Stockfish rates 4.b4 (Evans) 0.74 and 2.f4 (King's
 * Gambit) 0.67 worse than the best move.
 */
const HUNG_CP_PER_PAWN = 90;
/** Moves within this much of the best move count as "found it". */
const FOUND_CP = 60;
/**
 * Thinking aloud waits this many plies after the last remark, by how much
 * the narration teaches: a threat it answered, a capture, a quiet idea.
 */
const NARRATION_GAP: Record<NarrationPriority, number> = { high: 2, medium: 4, low: BUDGET_PLIES };
/** Quiet-move reasons are said at most this often per game. */
const TOPIC_LIMIT: Partial<Record<Narration['topic'], number>> = { castle: 1, develop: 2, 'centre-pawn': 1 };

export class Coach {
  private turn?: Promise<TurnFacts>;
  private turnFen?: string;
  /** The evaluation after the player's last move, reused to judge the coach's reply. */
  private afterPlayer?: PositionEval;
  private topicCount = new Map<Narration['topic'], number>();
  private hintStep = 0;
  private lastRemarkPly = -BUDGET_PLIES;
  private said = new Set<string>();
  /** The tactic the player started (and was praised for), while they carry it out. */
  private combination?: TaughtLine;
  private continuing = false;
  /** Hints used this game, for later mastery tracking. */
  hintsUsed = 0;

  constructor(
    private analyst: Analyst,
    private level: Level,
    private playerColor: 'w' | 'b',
    private mode: Mode = MODES[0],
  ) {}

  private limits() {
    return { maxPlies: this.level.maxPlies, minGain: this.level.minGain };
  }

  private teachable(line: TaughtLine | undefined): TaughtLine | undefined {
    return line && this.level.motifs.includes(line.motif) ? line : undefined;
  }

  /** Starts analysing the player's position in the background (hints must feel instant). */
  prepare(fen: string): Promise<TurnFacts> {
    this.hintStep = 0;
    if (this.turn && this.turnFen === fen) return this.turn; // already analysing this position
    this.turnFen = fen;
    this.turn = (async () => {
      const ev = await this.analyst.evaluate(fen, 2);
      const cut = this.analyst.taughtLine(ev, this.limits());
      const tactic = this.teachable(cut.kind === 'line' ? cut.line : undefined);
      const threat = this.teachable(await this.analyst.threat(fen, this.limits()));
      if (tactic) await this.analyst.markForced(tactic);
      return { fen, ev, tactic, threat };
    })();
    return this.turn;
  }

  /** Called when it becomes the player's turn. Returns what to say, or nothing. */
  async onPlayerTurn(fen: string, ply: number): Promise<Remark | undefined> {
    const t = await this.prepare(fen);
    // Mid-combination: the follow-up is part of what the player already found.
    const ownLater = this.combination?.moves.filter((m) => m.color === this.playerColor).slice(1) ?? [];
    this.continuing = !!t.tactic && ownLater.some((m) => m.uci === t.tactic!.moves[0].uci);
    if (!this.continuing) this.combination = undefined;
    if (this.continuing) return undefined;
    if (!this.mode.prompts) return undefined; // Sparring: hints only on request, no prompts

    if (t.tactic) {
      this.hintStep = 1; // this remark is hint step 1
      return this.remark(ply, {
        kind: 'tactic',
        text: "There's something strong here. Take your time.",
        mood: 'pleased',
        offerSideline: true,
      });
    }
    if (t.threat) {
      return this.remark(ply, {
        kind: 'threat',
        text: 'Before you move: what does my last move want?',
        mood: 'thinking',
      });
    }
    return this.phaseRemark(fen, ply);
  }

  /** Judges the player's move (before the opponent replies). */
  async onPlayerMove(fenBefore: string, uci: string, ply: number): Promise<Remark | undefined> {
    const t = this.turn ? await this.turn : await this.prepare(fenBefore);
    const chess = new Chess(fenBefore);
    const move = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    if (chess.isCheckmate()) return undefined; // the game screen celebrates

    const after = await this.analyst.evaluate(chess.fen(), 1);
    this.afterPlayer = after;
    const loss = t.ev.bestCp - -after.bestCp;
    // The engine's own top move is never a mistake: evaluations of sharp positions
    // jump between searches (Bxh7+ once scored a pawn "worse" than itself).
    const topMove = t.ev.lines[0]?.pv[0] === uci;

    // Found the tactic (praised once, at its first move).
    if (t.tactic && uci === t.tactic.moves[0].uci) {
      if (this.continuing) return undefined;
      this.combination = t.tactic;
      return this.remark(ply, {
        kind: 'praise',
        text: praise(t.tactic),
        mood: 'pleased',
        moment: { kind: 'found-tactic', fen: fenBefore, played: uci, concept: lineConceptOf(fenBefore, t.tactic.moves.map((m) => m.uci), undefined, t.tactic.motif) },
      });
    }

    if (loss >= this.level.mistakeCp && !topMove) {
      // The move lets the coach win something the player has learned to see.
      const cut = this.analyst.taughtLine(after, this.limits());
      const refutation = this.teachable(cut.kind === 'line' ? cut.line : undefined);
      if (refutation) return this.mistakeRemark(ply, move.san, refutation, { fenBefore, uci, loss });
      // The player missed their own tactic.
      if (t.tactic) {
        return this.remark(ply, {
          kind: 'missed-tactic',
          text: this.mode.takebacks
            ? `You had something stronger than ${move.san} here. Want to take it back and look again?`
            : `You had something stronger than ${move.san} here.`,
          mood: 'concerned',
          offerTakeback: this.mode.takebacks,
          moment: {
            kind: 'missed-tactic',
            fen: fenBefore,
            played: uci,
            better: t.tactic.moves[0].uci,
            concept: lineConceptOf(fenBefore, t.tactic.moves.map((m) => m.uci), undefined, t.tactic.motif),
            lossCp: loss,
          },
        });
      }
    }

    // Smaller than the level's mistake size, but plainly hung: a pawn or piece
    // the coach can just take, and the evaluation confirms it stays lost.
    const hung = this.mode.minorMistakes && !topMove ? this.hungMaterial(after, loss) : undefined;
    if (hung) return this.mistakeRemark(ply, move.san, hung, { fenBefore, uci, loss });
    if (loss >= this.level.mistakeCp && !topMove) return undefined; // beyond the player's concepts: stay quiet

    // Gave up material on purpose (or by luck), and the engine agrees it's fine.
    const amongBest = loss < FOUND_CP || topMove;
    const sacrifice = this.mode.smallTalk && amongBest ? this.sacrifice(fenBefore, uci) : undefined;
    if (sacrifice) {
      return this.remark(ply, {
        kind: 'praise',
        text: `Bold! ${move.san} offers ${sacrifice}, but the engine rates it among the best moves here. Can you see what you get for it?`,
        mood: 'surprised',
      });
    }

    // Dealt with the coach's threat (a low-priority remark).
    if (this.mode.smallTalk && t.threat && loss < FOUND_CP && this.budgetAllows(ply)) {
      return this.remark(ply, { kind: 'defended', text: 'Good, you saw my threat.', mood: 'pleased' });
    }
    return undefined;
  }

  /**
   * The coach thinks aloud after its own move: what the player's last move
   * threatened and how this move answers it, its captures, or the idea behind
   * a quiet move. Honest: it never calls its move good (Maia plays at the
   * player's level). Call before `onPlayerTurn`, which reuses the analysis.
   * `lastMove` is the player's move before it, if any. Silent in Sparring
   * (no plans revealed), though it still starts the player's turn analysis.
   */
  async onCoachMove(
    fenBefore: string,
    uci: string,
    ply: number,
    lastMove?: { san: string; to: Square },
  ): Promise<Remark | undefined> {
    const chess = new Chess(fenBefore);
    chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    if (chess.isGameOver()) return undefined; // the game screen announces the result

    // The player's turn analysis goes first in the queue: hints must stay instant.
    const turn = this.prepare(chess.fen());
    if (!this.mode.revealsPlans) return undefined;
    const before =
      this.afterPlayer?.fen === fenBefore ? this.afterPlayer : await this.analyst.evaluate(fenBefore, 1);
    const playerThreat = this.teachable(await this.analyst.threat(fenBefore, this.limits()));
    const t = await turn;
    const cut = this.analyst.taughtLine(t.ev, this.limits());

    const facts = coachMoveFacts({
      fenBefore,
      uci,
      lastMove,
      playerThreat,
      playerLineAfter: this.teachable(cut.kind === 'line' ? cut.line : undefined),
      // Scores are from the side to move: the coach's before, the player's after.
      lossCp: before.bestCp - -t.ev.bestCp,
      mistakeCp: this.level.mistakeCp,
      ply: ply - 1,
    });
    const n = narrateCoachMove(facts);
    if (!n || ply - this.lastRemarkPly < NARRATION_GAP[n.priority]) return undefined;
    const count = this.topicCount.get(n.topic) ?? 0;
    if (count >= (TOPIC_LIMIT[n.topic] ?? Infinity)) return undefined;
    this.topicCount.set(n.topic, count + 1);
    return this.remark(ply, { kind: 'narration', text: n.text, mood: 'thinking' });
  }

  /**
   * A loose pawn or piece (the "hanging-piece" pattern: a capture, maybe a
   * recapture) the coach can win after the player's move, whatever the level's
   * smallest taught gain. Material alone isn't enough: the evaluation must drop
   * by at least HUNG_CP_PER_PAWN per pawn won, so an even trade, a gambit with
   * real compensation or a sacrifice is not called a hung pawn.
   */
  private hungMaterial(after: PositionEval, loss: number): TaughtLine | undefined {
    if (!this.level.motifs.includes('hanging-piece')) return undefined;
    const cut = this.analyst.taughtLine(after, { maxPlies: this.level.maxPlies, minGain: 1 });
    const line = cut.kind === 'line' ? cut.line : undefined;
    if (!line || line.mate || line.motif !== 'hanging-piece') return undefined;
    return loss >= line.gain * HUNG_CP_PER_PAWN ? line : undefined;
  }

  /**
   * The player's move offers material (board facts only): the coach can take
   * the moved piece, and the player can't win back as much on that square
   * (counting their own capture, and at most one recapture of the taker).
   * Whether the coach should take it is the engine's business: the caller
   * only praises an offer that is among the engine's best moves. Returns
   * "a pawn" / "your bishop for a pawn".
   */
  private sacrifice(fenBefore: string, uci: string): string | undefined {
    const offer = offeredMaterial(fenBefore, uci);
    if (!offer) return undefined;
    return offer.won ? `your ${PIECE_NAME[offer.offered]} for a ${PIECE_NAME[offer.won]}` : `a ${PIECE_NAME[offer.offered]}`;
  }

  /** "Careful: after Bc4, I can play Nxd4…" (Lesson), or a plain warning (Sparring). */
  private async mistakeRemark(
    ply: number,
    san: string,
    refutation: TaughtLine,
    ctx: { fenBefore: string; uci: string; loss: number },
  ): Promise<Remark> {
    // The concept is the coach's answer: the position after the player's move.
    const chess = new Chess(ctx.fenBefore);
    chess.move({ from: ctx.uci.slice(0, 2), to: ctx.uci.slice(2, 4), promotion: ctx.uci[4] });
    const moment: Moment = {
      kind: 'mistake',
      fen: ctx.fenBefore,
      played: ctx.uci,
      better: refutation.moves[0].uci,
      concept: lineConceptOf(chess.fen(), refutation.moves.map((m) => m.uci), { fen: ctx.fenBefore, uci: ctx.uci }, refutation.motif),
      lossCp: ctx.loss,
    };
    if (!this.mode.revealsPlans) {
      // Sparring: a serious moment, but the coach keeps its reply to itself.
      return this.remark(ply, {
        kind: 'mistake',
        text: `Careful: ${san} gives me a chance ${refutation.mate ? 'to checkmate you' : 'to win material'}.`,
        mood: 'concerned',
        moment,
      });
    }
    await this.analyst.markForced(refutation);
    const first = refutation.moves[0];
    // A single defended capture: say why taking back doesn't help, if the board shows it.
    let why: FailedRecapture | undefined;
    if (refutation.moves.length === 1 && first.captured && !first.capturedUndefended) {
      const chess = new Chess(refutation.rootFen);
      chess.move({ from: first.from, to: first.to, promotion: first.promotion });
      why = failedRecapture(chess.fen(), first.to);
    }
    const wins = refutation.mate
      ? ''
      : `That would win ${winsPhrase(refutation)}${why ? `: ${failedRecapturePhrase(why)}` : ''}. `;
    return this.remark(ply, {
      kind: 'mistake',
      text: `Careful: after ${san}, I can play ${moveWithWhich(first)}. ${wins}${
        this.mode.takebacks ? 'Want to take it back?' : ''
      }`.trim(),
      mood: 'concerned',
      offerTakeback: this.mode.takebacks,
      shapes: [{ orig: first.from, dest: first.to, brush: 'red' }],
      moment,
    });
  }

  /** Engine results by position, so a sideline reuses the search that picked a reply to judge the move. */
  private cache = new Map<string, Promise<PositionEval>>();
  private evaluator: LineEvaluator = {
    evaluate: (fen, multiPv = 1, depth) => {
      const key = `${fen}|${multiPv}|${depth ?? ''}`;
      let r = this.cache.get(key);
      if (!r) this.cache.set(key, (r = this.analyst.evaluate(fen, multiPv, depth)));
      return r;
    },
  };
  /** Concepts named this game: a concept's habit is said only once. */
  private seenConcepts = new Set<NoteConcept>();

  /** The coach's reply in a sideline: the engine's best move (UCI), not the level-matched opponent's. */
  async sidelineReply(fen: string): Promise<string | undefined> {
    const ev = await this.evaluator.evaluate(fen, 1);
    return ev.lines[0]?.pv[0];
  }

  /** What the coach says about a move it plays itself in a sideline ("Show me"): what it does, and the concept. */
  describeSidelineReply(fenBefore: string, uci: string): string {
    const f = playAndDescribe(new Chess(fenBefore), uci);
    return sidelineReplyText(fenBefore, f, this.seenConcepts);
  }

  /**
   * "Try a sideline": the player played `move` from `fenBefore`. The engine says whether it
   * holds up, and the board code names the concept behind it (or says it can't).
   */
  async judgeSidelineMove(fenBefore: string, move: LineMove): Promise<Remark> {
    const verdict = await checkLine(this.evaluator, { rootFen: fenBefore, moves: [move] }, { maxPlies: Math.max(this.level.maxPlies, 4) });
    return {
      kind: 'line',
      text: narrateSidelineMove(fenBefore, verdict, this.seenConcepts),
      mood: verdict.kind === 'good' ? 'pleased' : verdict.kind === 'refuted' ? 'concerned' : 'neutral',
    };
  }

  /** Step-by-step hints: something is here, where to look, which piece, the answer. */
  async hint(): Promise<Remark> {
    const t = await this.turn!;
    this.hintsUsed++;
    this.hintStep = Math.min(this.hintStep + 1, 4);
    const step = this.hintStep;

    if (t.tactic) {
      const line = t.tactic;
      const first = line.moves[0];
      const mine = true;
      const targets = line.mate
        ? kingOf(t.fen, line.side === 'w' ? 'b' : 'w')
        : first.doubleAttack
          ? byImportance(first.attacks)
          : first.discovered
            ? [first.discovered.target]
            : first.captured
              ? [{ square: first.to, piece: first.captured }]
              : capturedTargets(line);
      const texts = [
        line.mate ? "There's a checkmate in this position." : "There's a tactic in this position.",
        `Look at ${targetList(targets, !mine)}.`,
        `${capitalize(pieceRef(first.piece, first.from, mine))} can do something.`,
        `${narrateLine(line)}`,
      ];
      const shapes: Shape[] =
        step === 2
          ? targets.map((x) => ({ orig: x.square, brush: 'yellow' as const }))
          : step === 3
            ? [{ orig: first.from, brush: 'green' }]
            : step === 4
              ? [{ orig: first.from, dest: first.to, brush: 'green' }]
              : [];
      return { kind: 'hint', text: texts[step - 1], mood: 'thinking', shapes };
    }

    if (t.threat) {
      const line = t.threat;
      const first = line.moves[0];
      const victims = line.mate
        ? kingOf(t.fen, this.playerColor)
        : first.captured
          ? [{ square: first.to, piece: first.captured }]
          : first.doubleAttack
            ? byImportance(first.attacks)
            : capturedTargets(line);
      const texts = [
        'Something of yours is in danger. What does my last move want?',
        `Look at ${targetList(victims, true)}.`,
        `${capitalize(pieceRef(first.piece, first.from, false))} is the attacker.`,
        `I'm threatening ${moveWithWhich(first)}${line.mate ? '' : `, winning ${winsPhrase(line)}`}. Protect it, move it, or block.`,
      ];
      const shapes: Shape[] =
        step === 2
          ? victims.map((x) => ({ orig: x.square, brush: 'yellow' as const }))
          : step === 3
            ? [{ orig: first.from, brush: 'red' }]
            : step === 4
              ? [{ orig: first.from, dest: first.to, brush: 'red' }]
              : [];
      return { kind: 'hint', text: texts[step - 1], mood: 'thinking', shapes };
    }

    // No tactic: point at the engine's best move and say why, from board facts only.
    const bestUci = t.ev.lines[0]?.pv[0];
    if (!bestUci) return { kind: 'hint', text: 'No tactic here. Which of your pieces is doing the least? Find it a better square.', mood: 'neutral' };
    const chess = new Chess(t.fen);
    const m = playAndDescribe(chess, bestUci);
    const full = Number(t.fen.split(' ')[5]) || 1;
    const home = this.playerColor === 'w' ? '1' : '8';
    const why = m.san.startsWith('O-O')
      ? 'It tucks your king away and brings a rook toward the centre.'
      : m.mate
        ? 'It is checkmate.'
        : m.captured
          ? `It takes the ${PIECE_NAME[m.captured]}.`
          : m.check
            ? 'It gives check.'
            : full <= 12 && (m.piece === 'n' || m.piece === 'b') && m.from[1] === home
              ? 'It brings a piece into the game.'
              : full <= 12 && m.piece === 'p' && ['d4', 'e4', 'd5', 'e5'].includes(m.to)
                ? 'It claims space in the centre.'
                : 'The engine rates it highest, though other sensible moves are close.';
    const texts = [
      'No tactic here for either side. Look for a quiet move that improves your position.',
      `${capitalize(pieceRef(m.piece, m.from, true))} could do better.`,
      `The engine's choice is ${m.san}. ${why}`,
    ];
    const s = Math.min(step, 3);
    const shapes: Shape[] =
      s === 2 ? [{ orig: m.from, brush: 'green' }] : s === 3 ? [{ orig: m.from, dest: m.to, brush: 'green' }] : [];
    return { kind: 'hint', text: texts[s - 1], mood: 'thinking', shapes };
  }

  private phaseRemark(fen: string, ply: number): Remark | undefined {
    if (!this.mode.smallTalk || !this.budgetAllows(ply)) return undefined;
    const chess = new Chess(fen);
    if (isEndgame(chess) && !this.said.has('endgame')) {
      this.said.add('endgame');
      return this.remark(ply, {
        kind: 'phase',
        text: "We're in the endgame now. Kings become fighters here: bring yours toward the middle.",
        mood: 'neutral',
      });
    }
    if (ply >= 16 && !this.said.has('opening') && !isEndgame(chess)) {
      this.said.add('opening');
      return this.remark(ply, {
        kind: 'phase',
        text: "The opening's done. Which of your pieces isn't doing anything yet?",
        mood: 'thinking',
      });
    }
    return undefined;
  }

  private budgetAllows(ply: number): boolean {
    return ply - this.lastRemarkPly >= BUDGET_PLIES;
  }

  private remark(ply: number, r: Remark): Remark {
    this.lastRemarkPly = ply;
    return r;
  }
}

function kingOf(fen: string, color: 'w' | 'b') {
  const chess = new Chess(fen);
  for (const row of chess.board()) {
    for (const sq of row) if (sq?.type === 'k' && sq.color === color) return [{ square: sq.square, piece: sq.type }];
  }
  return [];
}

function capturedTargets(line: TaughtLine) {
  return line.moves
    .filter((m) => m.color === line.side && m.captured)
    .map((m) => ({ square: m.to, piece: m.captured! }));
}

/** No queens, or very little material left besides kings and pawns. */
function isEndgame(chess: Chess): boolean {
  let queens = 0;
  let pieces = 0;
  for (const row of chess.board()) {
    for (const sq of row) {
      if (!sq || sq.type === 'k' || sq.type === 'p') continue;
      if (sq.type === 'q') queens++;
      pieces += { n: 3, b: 3, r: 5, q: 9 }[sq.type];
    }
  }
  return (queens === 0 && pieces <= 26) || pieces <= 13;
}

/** Joins the coach's narration with the remark for the player's turn into one bubble. */
export function joinRemarks(first: Remark | undefined, second: Remark | undefined): Remark | undefined {
  if (!first || !second) return first ?? second;
  return {
    ...second,
    text: `${first.text} ${second.text}`,
    shapes: [...(first.shapes ?? []), ...(second.shapes ?? [])],
  };
}

