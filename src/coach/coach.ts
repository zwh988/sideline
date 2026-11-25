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
import { Chess, type Color, type Square } from 'chess.js';
import { scoreToCp, type Score } from '../engine/stockfish';
import type { Level } from '../app/levels';
import { MODES, type Mode } from '../app/modes';
import type { Analyst, PositionEval } from './analyst';
import { isMereRecapture, type TaughtLine } from './lines';
import { checkLine, type LineEvaluator, type LineMove } from './linecheck';
import { lineConceptOf, offeredMaterial, type NoteConcept } from './explain';
import { explainLine } from './lineexplain';
import { moveNote, narrateSidelineMove } from './sideline';
import { COMMON_P, rateOptions, rateOther, sanOf, type Option, type Rating } from '../app/linetree';
import { reasonsFor } from './position';
import { failedRecapture, PIECE_NAME, playAndDescribe, type FailedRecapture } from './facts';
import { coachMoveFacts } from './narration';
import type { OpeningBook } from './openings';
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
  /**
   * The player's own mistakes and finds, and (found by Review, which looks at both sides) what the
   * opponent found (`their-tactic`) or gave away (`their-blunder`).
   */
  kind: 'mistake' | 'missed-tactic' | 'found-tactic' | 'their-tactic' | 'their-blunder';
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
  /** Review: the engine's line from `fen` that should have been played (or was found), UCI. */
  line?: string[];
  /** Review: what the opponent answers after the played move, UCI, when that wins something (a mistake). */
  answer?: string[];
  /** Review: the idea is beyond the patterns the player's level usually trains. */
  beyond?: boolean;
  /** Review: the opponent's move just before was itself a mistake the engine confirms. */
  prompted?: boolean;
}

export interface Remark {
  kind: 'tactic' | 'threat' | 'mistake' | 'missed-tactic' | 'praise' | 'defended' | 'phase' | 'hint' | 'narration' | 'line';
  text: string;
  mood: Mood;
  offerTakeback?: boolean;
  /** Lesson: invite the player to try their idea in a sideline. */
  offerSideline?: boolean;
  /** The engine's line from this position (UCI), offered as a universe in the sideline (a tactic prompt). */
  line?: string[];
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
    /** Known openings (task 1.7b); without it the coach knows no theory. */
    private book?: OpeningBook,
  ) {}

  private limits() {
    return { maxPlies: this.level.maxPlies, minGain: this.level.minGain };
  }

  private teachable(line: TaughtLine | undefined): TaughtLine | undefined {
    return line && this.level.motifs.includes(line.motif) ? line : undefined;
  }

  /** The opponent's last move, so taking back a piece it just took is not taught as a tactic. */
  private previous?: { fen: string; uci: string };

  /** A tactic that only takes back what was just taken is an even trade, not a tactic. */
  private notRecapture(line: TaughtLine | undefined): TaughtLine | undefined {
    if (!line) return undefined;
    return isMereRecapture(line, this.previous, this.level.minGain) ? undefined : line;
  }

  /** Starts analysing the player's position in the background (hints must feel instant). */
  prepare(fen: string): Promise<TurnFacts> {
    this.hintStep = 0;
    if (this.turn && this.turnFen === fen) return this.turn; // already analysing this position
    this.turnFen = fen;
    this.turn = (async () => {
      const ev = await this.analyst.evaluate(fen, 2);
      const cut = this.analyst.taughtLine(ev, this.limits());
      const tactic = this.notRecapture(this.teachable(cut.kind === 'line' ? cut.line : undefined));
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
        line: t.tactic.moves.map((m) => m.uci),
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

    const fenAfter = chess.fen();
    // A named line of theory: its pawn breaks and gambits are not hung material or daring sacrifices.
    const inBook = !!this.book?.has(fenAfter);
    const after = await this.analyst.evaluate(fenAfter, 1);
    this.afterPlayer = after;
    const loss = t.ev.bestCp - -after.bestCp;
    // The engine's own top move is never a mistake: evaluations of sharp positions
    // jump between searches (Bxh7+ once scored a pawn "worse" than itself).
    const topMove = t.ev.lines[0]?.pv[0] === uci;
    // What the player could have played instead, for the universes ("what the engine wanted").
    const betterLine = t.tactic ? t.tactic.moves.map((m) => m.uci) : (t.ev.lines[0]?.pv ?? []).slice(0, 3);

    // Found the tactic (praised once, at its first move).
    if (t.tactic && uci === t.tactic.moves[0].uci) {
      if (this.continuing) return undefined;
      this.combination = t.tactic;
      return this.remark(ply, {
        kind: 'praise',
        text: praise(t.tactic),
        mood: 'pleased',
        moment: { kind: 'found-tactic', fen: fenBefore, played: uci, line: t.tactic.moves.map((m) => m.uci), concept: lineConceptOf(fenBefore, t.tactic.moves.map((m) => m.uci), undefined, t.tactic.motif) },
      });
    }

    if (loss >= this.level.mistakeCp && !topMove) {
      // The move lets the coach win something the player has learned to see.
      const cut = this.analyst.taughtLine(after, this.limits());
      const refutation = this.teachable(cut.kind === 'line' ? cut.line : undefined);
      if (refutation) return this.mistakeRemark(ply, move.san, refutation, { fenBefore, uci, loss, better: betterLine });
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
            line: t.tactic.moves.map((m) => m.uci),
            concept: lineConceptOf(fenBefore, t.tactic.moves.map((m) => m.uci), undefined, t.tactic.motif),
            lossCp: loss,
          },
        });
      }
    }

    // Smaller than the level's mistake size, but plainly hung: a pawn or piece
    // the coach can just take, and the evaluation confirms it stays lost.
    const hung = this.mode.minorMistakes && !topMove && !inBook ? this.hungMaterial(after, loss) : undefined;
    if (hung) return this.mistakeRemark(ply, move.san, hung, { fenBefore, uci, loss, better: betterLine });
    if (loss >= this.level.mistakeCp && !topMove) return undefined; // beyond the player's concepts: stay quiet

    // Gave up material on purpose (or by luck), and the engine agrees it's fine.
    // A known gambit is named, not praised: the name and the offer are facts; the engine's view
    // is added only when the evaluation says it prefers other moves.
    const gambit = this.mode.smallTalk ? this.book?.gambitEntered(fenBefore, fenAfter) : undefined;
    const offer = gambit ? this.sacrifice(fenBefore, uci) : undefined;
    if (gambit && offer) {
      return this.remark(ply, {
        kind: 'praise',
        text: `That's the ${gambit.gambit}, a known opening: you offer ${offer}.${loss >= HUNG_CP_PER_PAWN ? ' The engine prefers other moves here.' : ''} We'll look at this one in openings training.`,
        mood: 'neutral',
      });
    }
    const amongBest = loss < FOUND_CP || topMove;
    const sacrifice = this.mode.smallTalk && amongBest && !inBook ? this.sacrifice(fenBefore, uci) : undefined;
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
    this.previous = { fen: fenBefore, uci };
    const turn = this.prepare(chess.fen());
    if (!this.mode.revealsPlans) return undefined;
    // Playing a known gambit: say so every time it enters one, with what it offers.
    const gambit = this.book?.gambitEntered(fenBefore, chess.fen());
    const offer = gambit ? this.sacrifice(fenBefore, uci, false) : undefined;
    if (gambit && offer && ply - this.lastRemarkPly >= NARRATION_GAP.medium) {
      return this.remark(ply, {
        kind: 'narration',
        text: `I'm playing the ${gambit.gambit}, a known opening: I offer ${offer}.`,
        mood: 'thinking',
      });
    }
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
  private sacrifice(fenBefore: string, uci: string, mine = true): string | undefined {
    const offer = offeredMaterial(fenBefore, uci);
    if (!offer) return undefined;
    return offer.won ? `${mine ? 'your' : 'my'} ${PIECE_NAME[offer.offered]} for a ${PIECE_NAME[offer.won]}` : `a ${PIECE_NAME[offer.offered]}`;
  }

  /** "Careful: after Bc4, I can play Nxd4…" (Lesson), or a plain warning (Sparring). */
  private async mistakeRemark(
    ply: number,
    san: string,
    refutation: TaughtLine,
    ctx: { fenBefore: string; uci: string; loss: number; better: string[] },
  ): Promise<Remark> {
    // The concept is the coach's answer: the position after the player's move.
    const chess = new Chess(ctx.fenBefore);
    chess.move({ from: ctx.uci.slice(0, 2), to: ctx.uci.slice(2, 4), promotion: ctx.uci[4] });
    const moment: Moment = {
      kind: 'mistake',
      fen: ctx.fenBefore,
      played: ctx.uci,
      better: refutation.moves[0].uci,
      answer: refutation.moves.map((m) => m.uci),
      line: ctx.better.length ? ctx.better : undefined,
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

  /** The engine's top moves at `fen`, ranked into lanes (Best / Great / Good / Other) against its best move there. */
  async options(fen: string, count = 5): Promise<Option[]> {
    const ev = await this.evaluator.evaluate(fen, count);
    return rateOptions(fen, ev.lines, this.me);
  }

  /**
   * Adds the moves players at the level often choose (`likely`, from Maia: move and probability) to the
   * engine's options: a move that is already there is marked common, one that is not is rated (one search)
   * and added, so a tempting move the engine dislikes can still be explored and judged.
   */
  async withCommon(fen: string, options: Option[], likely: { uci: string; p: number }[], minP = COMMON_P, max = 2): Promise<Option[]> {
    const out = options.map((o) => ({ ...o }));
    let added = 0;
    for (const l of likely) {
      if (l.p < minP) continue;
      const hit = out.find((o) => o.uci === l.uci);
      if (hit) {
        hit.common = true;
        continue;
      }
      if (added >= max) continue;
      try {
        const r = await this.rateMove(fen, l.uci);
        out.push({ ...r, uci: l.uci, san: sanOf(fen, l.uci), common: true });
        added++;
      } catch {
        /* no engine: leave it out */
      }
    }
    return out;
  }

  /**
   * What stands out in the position after the last move of a Line, when the engine says one side is clearly
   * better and no concept was named for the move: board facts that favour that side (passed pawn, the
   * other side's weaknesses, the bishop pair), with their squares. They are facts that are there, not the
   * engine's reasons; when none is found the coach says so (rule 1).
   */
  reason(rootFen: string, ucis: string[], fenAfter: string, rating: Rating): { text: string; squares: string[] } | undefined {
    const evalCp = rating.evalCp;
    // A move in Other is worded with its refutation (lineNote), which is the reason.
    if (rating.lane === 'other' || Math.abs(evalCp) < 100 || Math.abs(evalCp) >= 90000) return undefined;
    if (explainLine(rootFen, ucis, { player: this.me }).at(-1)?.concept) return undefined;
    const better = evalCp > 0 ? this.playerColor : this.playerColor === 'w' ? 'b' : 'w';
    const facts = reasonsFor(fenAfter, better).slice(0, 2);
    if (!facts.length) return Math.abs(evalCp) >= 150 ? { text: "I can't name a reason I can check for that.", squares: [] } : undefined;
    return { text: `What stands out: ${facts.map((f) => f.text).join(' ')}`, squares: [...new Set(facts.flatMap((f) => f.squares))] };
  }

  /**
   * The rating of the move `uci` played at `fen`: from the engine's top lines when it is among them, else one
   * more search of the position after it (its loss against the best move there).
   */
  async rateMove(fen: string, uci: string): Promise<Rating> {
    const ev = await this.evaluator.evaluate(fen, 5);
    const opts = rateOptions(fen, ev.lines, this.me);
    const hit = opts.find((o) => o.uci === uci);
    if (hit) return hit;
    const chess = new Chess(fen);
    chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    let after: Score;
    if (chess.isCheckmate()) after = { kind: 'cp', value: -100000 };
    else if (chess.isDraw() || chess.isStalemate()) after = { kind: 'cp', value: 0 };
    else after = (await this.evaluator.evaluate(chess.fen(), 1)).lines[0]?.score ?? { kind: 'cp', value: 0 };
    const bestCp = ev.lines[0] ? scoreToCp(ev.lines[0].score) : 0;
    return rateOther(fen, bestCp, after, this.me, opts[0]?.san);
  }

  /**
   * The words for the last move of a Line (`ucis` from `rootFen`) given its rating: what the engine says about its
   * lane, then what the board code found in it. A move far below the best is judged like a sideline move
   * ("doesn't hold up, I'd answer with ..."), which names the refutation.
   */
  async lineNote(rootFen: string, ucis: string[], rating?: Rating): Promise<string> {
    const steps = explainLine(rootFen, ucis, { player: this.me });
    const step = steps.at(-1);
    if (!step) return '';
    if (!rating) return moveNote(`${step.san}.`, step, this.seenConcepts);
    const pawns = (rating.lossCp / 100).toFixed(1);
    const best = rating.bestSan ?? 'another move';
    if (rating.lane === 'best') return moveNote("The engine's top choice here.", step, this.seenConcepts);
    if (rating.lane === 'great') return moveNote(`A great move: the engine's top pick is ${best}, only ${pawns} pawns better.`, step, this.seenConcepts);
    if (rating.lane === 'good') return moveNote(`A good move that holds up, though the engine prefers ${best}.`, step, this.seenConcepts);
    const parent = new Chess(rootFen);
    for (const u of ucis.slice(0, -1)) parent.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] });
    const uci = ucis.at(-1)!;
    const m = new Chess(parent.fen()).move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    const move: LineMove = { from: m.from, to: m.to, promotion: m.promotion, uci, san: m.san, mine: (m.color === 'w') === (this.playerColor === 'w') };
    try {
      const r = await this.judgeSidelineMove(parent.fen(), move, { rootFen, ucis });
      if (r.text) return r.text;
    } catch {
      /* no engine: the plain sentence below */
    }
    return moveNote(`The engine rates it ${pawns} pawns worse than ${best}.`, step, this.seenConcepts);
  }

  /** The player's colour as the long name `explainLine` takes. */
  private get me(): Color {
    return this.playerColor;
  }

  /**
   * "Try a sideline": the player played `move` from `fenBefore`. The engine says whether it
   * holds up, and the board code names the concept behind it (or says it can't). `line` is the whole
   * sideline so far (this move last), so a pay-off of an idea set up earlier can be named.
   */
  async judgeSidelineMove(fenBefore: string, move: LineMove, line?: { rootFen: string; ucis: string[] }): Promise<Remark> {
    const verdict = await checkLine(this.evaluator, { rootFen: fenBefore, moves: [move] }, { maxPlies: Math.max(this.level.maxPlies, 4) });
    const step = line ? explainLine(line.rootFen, line.ucis, { player: this.me }).at(-1) : undefined;
    return {
      kind: 'line',
      text: narrateSidelineMove(fenBefore, verdict, this.seenConcepts, step),
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

