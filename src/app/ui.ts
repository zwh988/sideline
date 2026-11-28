// The game screen: board, coach bubble, move list and controls.
// The coach speaks only when its rules say so (src/coach/coach.ts); the
// status line under the bubble carries routine game information.
import { Chessground } from '@lichess-org/chessground';
import type { Api } from '@lichess-org/chessground/api';
import type { DrawShape } from '@lichess-org/chessground/draw';
import type { Key } from '@lichess-org/chessground/types';
import { Chess, type Square } from 'chess.js';
import { Analyst } from '../coach/analyst';
import { loadOpeningBook, openingBookIfLoaded, type OpeningBook } from '../coach/openings';
import type { LineMove as LineMoveLike } from '../coach/linecheck';
import { Coach, joinRemarks, type Mark, type Mood, type Remark, type Shape } from '../coach/coach';
import { HEADLINE, LABEL_INFO, type MoveLabel } from '../coach/movelabels';
import { richSegments } from './richtext';
import { afterPhrase, Voice, type Cue } from '../coach/voices';
import { LANE_ARROW, LANE_COLOUR, drawChart, laneBadgeSvg } from './linechart';
import { LANE_NAME, LANES, LineTree, badgeOf, isCommon, verdictOf, type LineNode, type Option } from './linetree';
import { gameToPgn } from './pgn';
import { ImportDialog } from './import-dialog';
import { GameStore, newGameId, type SavedGame, type SavedMoment } from './store';
import { gameStats, kindLabel, momentDot, momentUniverses, needsAnalysis, reviewableGames, type SideStats, type Universe, reviewBarText, reviewIntro, reviewPrompt, sortedMoments, mergeAnalysis, moveLabels, performanceLine, pinRows } from './review';
import { REVIEW_VERSION, reviewCoachLevel, reviewGame } from '../coach/review';
import { Game, resultOf, type Color } from './game';
import { LEVELS, levelInfo, levelLabel, type Level } from './levels';
import { MODES, OPENING, PUZZLE, REVIEW, modeInfo, type Mode, type ModeId } from './modes';
import { CATALOG, courseTitle, loadCourse, loadIndex } from './openingcatalog';
import { OpeningProgress } from './openingstore';
import { PracticeDeck, isDue as cardDue, newCard } from './practice';
import { deckKeys, drillPath, drillSteps, openingCardId, whyChoices } from '../coach/opening-drill';
import { courseLines, isCourseMove, judgeAlternative, lessonSteps, lineStatuses, nextLine, pathKey, quizNodes, sanOf, type CourseLine, type LessonStep } from '../coach/opening-lesson';
import type { CourseTree } from '../coach/opening-tree';
import { branchWords, compareWords, definingText, foundSentence, foundTags, goalQuestion, goalShapes, shownTags, tagShapes, type IdeaShape, ideaHint, ideaSentence, introWords, lineAfterReply, lineText, nodeLabel, punishWords, shownWords, trapWords } from '../coach/opening-words';
import { PuzzleRun, judgeOther, puzzleHint, solvedWords } from './puzzle';
import { choosePuzzle, nextLevel, pickTheme, startLevel } from './puzzlechoice';
import { POOL_BANDS, POOL_THEMES, bandsFor, loadBand, themeName, type Puzzle } from './puzzlepool';
import { MASTERY_GOAL, PuzzleResults, type Attempt } from './puzzlestore';
import { materialOf } from './material';
import { gameSummary } from './summary';
import { Navigation, RemarkLog, plyLabel } from './navigation';
import { createOpponent, type Opponent } from './opponent';
import { applyLoaded, fetchTheme, portraitUrl, type LoadedTheme } from './theme';
import { listAnd } from '../coach/templates';
import { PIECE_NAME } from '../coach/facts';
import { defends } from '../coach/opening-ideas';

type ColorChoice = Color | 'random';

interface Settings {
  level: number;
  color: ColorChoice;
  mode: ModeId;
  /** "Plain coach": no phrases in the coach's voice, only the facts (task 1.14b). */
  plain?: boolean;
}

const SETTINGS_KEY = 'sideline.settings';
const MIN_THINK_MS = 600; // the coach shouldn't reply instantly
const DEMO_STEP_MS = 900; // one move of the ghost line (task 1.12a)

function loadSettings(): Settings {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? 'null');
    if (saved && typeof saved.level === 'number') return { ...saved, mode: modeInfo(saved.mode).id };
  } catch {
    /* storage unavailable: use defaults */
  }
  return { level: 2, color: 'white', mode: 'lesson' };
}

/** The theme to load before the app starts: the tier of the game in progress, else the saved tier. */
export function initialTheme(): string {
  return levelInfo(new GameStore().current()?.level ?? loadSettings().level).theme;
}

const MOODS: Mood[] = ['neutral', 'thinking', 'pleased', 'concerned', 'surprised'];

function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* not critical */
  }
}

/** A coach shape in chessground's form (a numbered arrow carries its label). */
function drawShape(s: Shape): DrawShape {
  return { orig: s.orig as Key, dest: s.dest as Key | undefined, brush: s.brush, label: s.label ? { text: s.label } : undefined };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const MARK_COLOUR = { bad: 'var(--mark-bad)', blunder: 'var(--mark-blunder)', good: 'var(--mark-good)' } as const;
const MARK_GLYPH = { bad: '?', blunder: '??', good: '!' } as const;

/** A mark on a square: a pulsing ring on the piece in danger, or a badge (? ?? !) on the piece just moved. */
function markShape(m: Mark): DrawShape {
  if (m.kind === 'ring') {
    return { orig: m.square as Key, customSvg: { html: '<circle class="mark-ring" cx="50" cy="50" r="43" fill="none" stroke="var(--mark-blunder)" stroke-width="7"/>', center: 'orig' } };
  }
  return badgeShape(m.square, MARK_GLYPH[m.kind], MARK_COLOUR[m.kind]);
}

/** A badge on a square (top right of the piece): a coloured disc with its mark. */
function badgeShape(square: string, glyph: string, colour: string): DrawShape {
  const size = glyph.length > 1 ? 26 : 32;
  return {
    orig: square as Key,
    customSvg: {
      html: `<g class="mark-badge"><circle cx="72" cy="28" r="26" fill="${colour}" stroke="var(--on-accent)" stroke-width="4"/><text x="72" y="${glyph.length > 1 ? 37 : 39}" text-anchor="middle" font-size="${size}" font-weight="800" font-family="system-ui,sans-serif" fill="var(--on-accent)">${glyph}</text></g>`,
      center: 'orig',
    },
  };
}

/** A move label's badge on the piece that moved. */
function labelShape(square: string, label: MoveLabel): DrawShape {
  return badgeShape(square, LABEL_INFO[label].glyph, LABEL_INFO[label].colour);
}

/** Puts text into an element with the moves as chips and the key words in bold (formatting only: no words added). */
/** A coach's name with its rating beside it ("Beans 300"), for labels under faces and in the bubble. */
function setCoachName(el: HTMLElement, l: Level, mark = ''): void {
  const rating = document.createElement('span');
  rating.className = 'c-rating';
  rating.textContent = String(l.shownRating);
  rating.title = `Plays at about ${l.shownRating}`;
  el.replaceChildren(`${l.coach.name}${mark} `, rating);
}

/** A remark in the bubble: the coach's phrase (unless plain), then the facts as rich text. */
function setRemark(el: HTMLElement, r: Remark, plain: boolean): void {
  const phrase = plain ? undefined : r.phrase;
  setRich(el, phrase ? afterPhrase(r.text) : r.text);
  if (!phrase) return;
  const span = document.createElement('span');
  span.className = 'phrase';
  span.textContent = phrase;
  el.prepend(span, el.childNodes.length ? ' ' : '');
}

function setRich(el: HTMLElement, text: string): void {
  el.replaceChildren(
    ...richSegments(text).map((s) => {
      if (s.kind === 'text') return document.createTextNode(s.text);
      const span = document.createElement(s.kind === 'move' ? 'span' : 'strong');
      span.className = s.kind === 'move' ? 'mv-chip' : 'key';
      span.textContent = s.text;
      return span;
    }),
  );
}

/** Everything a remark draws on the board: its arrows and its marks. */
function remarkShapes(r: Remark): DrawShape[] {
  return [...(r.shapes ?? []).map(drawShape), ...(r.marks ?? []).map(markShape)];
}

/**
 * The coach: a person with glasses, flat, drawn in the theme's accent (task 1.12e). The mood changes the
 * brows, pupils and mouth; the head, hair and glasses stay, so it is always the same person.
 */
export function faceSvg(mood: Mood): string {
  const ink = 'var(--coach-ink)';
  const stroke = (d: string, w = 1.8) => `<path d="${d}" fill="none" stroke="${ink}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;
  const pupil = (x: number, y: number, r = 1.9) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${ink}"/>`;
  let eyes: string;
  let brows: string;
  let mouth: string;
  switch (mood) {
    case 'pleased':
      eyes = stroke('M22 31q4-5 8 0') + stroke('M34 31q4-5 8 0');
      brows = stroke('M21 23q5-3 9 0') + stroke('M34 23q5-3 9 0');
      mouth = stroke('M26 40q6 6 12 0');
      break;
    case 'concerned':
      eyes = pupil(26, 32) + pupil(38, 32);
      brows = stroke('M20 26l10-4') + stroke('M34 22l10 4');
      mouth = stroke('M27 43q5-4 10 0');
      break;
    case 'surprised':
      eyes = pupil(26, 31, 2.6) + pupil(38, 31, 2.6);
      brows = stroke('M21 21q5-3 9 0') + stroke('M34 21q5-3 9 0');
      mouth = `<ellipse cx="32" cy="42" rx="2.6" ry="3.2" fill="none" stroke="${ink}" stroke-width="1.8"/>`;
      break;
    case 'thinking':
      eyes = pupil(27.5, 29.5) + pupil(39.5, 29.5);
      brows = stroke('M21 24h9') + stroke('M34 20l9-2');
      mouth = stroke('M28 42h8');
      break;
    default:
      eyes = pupil(26, 31) + pupil(38, 31);
      brows = stroke('M21 24h9') + stroke('M34 24h9');
      mouth = stroke('M27 41q5 3 10 0');
  }
  const lens = (cx: number) => `<circle cx="${cx}" cy="31" r="5.4" fill="none" stroke="${ink}" stroke-width="1.6"/>`;
  return `<svg viewBox="0 0 64 64" role="img" aria-label="Coach looks ${mood}">
    <path d="M10 64c0-13 10-19 22-19s22 6 22 19z" style="fill:color-mix(in srgb, var(--coach-accent) 55%, #000)"/>
    <rect x="28" y="40" width="8" height="8" rx="3" fill="var(--coach-skin)"/>
    <circle cx="32" cy="30" r="14" fill="var(--coach-skin)"/>
    <path d="M18 28c-1-10 6-16 14-16s15 6 14 16c-3-5-8-8-14-8s-11 3-14 8z" fill="var(--coach-hair)"/>
    ${lens(26)}${lens(38)}${stroke('M31.4 31h1.2', 1.6)}
    ${eyes}${brows}${mouth}
  </svg>`;
}


const TIMELINE_W = 300;
const TIMELINE_H = 100;

/** The timeline's pin callouts: the height of a row of badges, the room a badge needs, how many rows at most. */
const PIN_ROW = 26;
const PIN_GAP = 28;
const PIN_ROWS = 3;

/** Text for innerHTML (player names come from imported games). */
const escapeHtml = (t: string): string => t.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Where a ply and an evaluation fall on the Review timeline. */
function timelineScale(curve: number[]): { x: (ply: number) => number; y: (cp: number) => number } {
  const most = Math.max(300, ...curve.map(Math.abs));
  return {
    x: (ply) => (ply / (curve.length - 1)) * TIMELINE_W,
    y: (cp) => TIMELINE_H / 2 - (cp / most) * (TIMELINE_H / 2 - 4),
  };
}

/** How many of the game's own moves a sideline in Review starts with (each is rated, so not the whole game). */
const REVIEW_SEED_PLIES = 8;

const RAIL_ICONS = {
  play: '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M9 4l9 8-9 8z" fill="currentColor"/></svg>',
  review: '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M5 6h14M5 12h14M5 18h9" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" fill="none"/></svg>',
  settings: '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M4 8h10M18 8h2M4 16h2M10 16h10" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" fill="none"/><circle cx="16" cy="8" r="2.6" fill="currentColor"/><circle cx="8" cy="16" r="2.6" fill="currentColor"/></svg>',
  puzzles: '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M5 5h5v2.5a2 2 0 1 0 4 0V5h5v5h-2.5a2 2 0 1 0 0 4H19v5h-5v-2.5a2 2 0 1 0-4 0V19H5z" stroke="currentColor" stroke-width="2" stroke-linejoin="round" fill="none"/></svg>',
  openings: '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M12 7c-2-1.6-4.6-2-8-2v13c3.4 0 6 .4 8 2 2-1.6 4.6-2 8-2V5c-3.4 0-6 .4-8 2zM12 7v13" stroke="currentColor" stroke-width="2" stroke-linejoin="round" fill="none"/></svg>',
};

/** A coach's face in their own accent and portrait, without switching the page's theme (Puzzles and Openings tabs). */
function coachFace(l: Level, size: 'sm' | 'lg'): HTMLElement {
  const d = document.createElement('div');
  d.className = `p-face ${size}`;
  d.innerHTML = faceSvg('neutral');
  void fetchTheme(l.theme).then((t) => {
    d.style.setProperty('--p-accent', t.theme.coach.accent);
    d.style.setProperty('--p-soft', t.theme.coach.accentSoft ?? t.theme.coach.accent);
    const url = portraitUrl(t, size === 'lg' ? 'pleased' : 'neutral');
    if (url) d.innerHTML = `<img src="${url}" alt="">`;
  }).catch(() => undefined);
  return d;
}

/** A small static board for a course card (no chessground: fourteen of them on one screen). */
function miniBoard(fen: string, side: 'w' | 'b', pieceUrl: (code: string) => string): HTMLElement {
  const d = document.createElement('span');
  d.className = 'o-board';
  d.setAttribute('aria-hidden', 'true');
  const cells: (string | null)[] = [];
  for (const ch of fen.split(' ')[0].replaceAll('/', '')) {
    if (/\d/.test(ch)) for (let i = 0; i < Number(ch); i++) cells.push(null);
    else cells.push(ch);
  }
  (side === 'w' ? cells : [...cells].reverse()).forEach((c, i) => {
    const sq = document.createElement('i');
    sq.className = (Math.floor(i / 8) + (i % 8)) % 2 ? 'd' : 'l';
    if (c) {
      const img = document.createElement('img');
      img.src = pieceUrl((c === c.toUpperCase() ? 'w' : 'b') + c.toUpperCase());
      img.alt = '';
      sq.append(img);
    }
    d.append(sq);
  });
  return d;
}

type Screen = 'play' | 'review' | 'settings' | 'puzzles' | 'openings';

/** A puzzle session (task 3.2): the coach's set, the puzzle on the board and how this try is going. */
interface PuzzleSession {
  level: Level;
  /** The theme picked in the Puzzles tab, or none for the coach's mix. */
  theme?: string;
  /** The theme of the puzzle on the board (its level moves with the result). */
  current?: string;
  /** Puzzles per theme this session (a mix plays the least played theme next). */
  played: Map<string, number>;
  /** Puzzles played this session (not offered again). */
  seen: Set<string>;
  solvedCount: number;
  run?: PuzzleRun;
  /** The moves from the solver's first position: the player's and the replies. */
  line: string[];
  attempt: Attempt;
  hintStep: number;
  phase: 'intro' | 'solving' | 'wrong' | 'solved';
  /** The current try is written to the results already. */
  recorded: boolean;
}

/** An opening lesson on the board (task 6.2): one line of a course, walked step by step. */
interface LessonSession {
  tree: CourseTree;
  level: Level;
  lines: CourseLine[];
  line: CourseLine;
  steps: LessonStep[];
  /** The step being played or asked. */
  index: number;
  practice: boolean;
  phase: 'auto' | 'quiz' | 'wrong' | 'done';
  hintStep: number;
  /** Moves learned in this lesson (found without a hint), and moves asked. */
  learnedNow: number;
  found: number;
  asked: number;
  /** A drill run (task 6.3) instead of a lesson: their replies chosen toward due moves, every move of yours asked. */
  drill?: DrillRun;
  /** Wrong tries on the move being asked; after two the coach shows it (then it is not learned). */
  tries?: number;
  shown?: boolean;
  /** "Skip to my move": the shown moves play without waiting for Next until the next question. */
  skip?: boolean;
}

interface DrillRun {
  /** Started from the tab (the course with the most moves due) or from a course page. */
  from: 'tab' | 'course';
  hits: number;
  misses: number;
  /** The move being asked was missed (a wrong move or a hint); its card is recorded once. */
  missed: boolean;
  /** Moves due in the course when the run started. */
  due: number;
}

/** How often a move found cleanly in a drill is followed by "Why this move?". */
const WHY_CHANCE = 0.35;

export class App {
  private settings = loadSettings();
  private game!: Game;
  private board!: Api;
  private opponent: Promise<Opponent>;
  private analyst: Promise<Analyst>;
  private book: Promise<OpeningBook>;
  private coach!: Promise<Coach>;
  /** The mode of the game in progress (a new setting applies from the next game). */
  private mode: Mode = MODES[0];
  /** Bumped on every new game, so work for an old game is dropped. */
  private gameId = 0;
  private thinking = false;
  private nav = new Navigation();
  private log = new RemarkLog();
  private voice = new Voice();
  /** True while the board shows arrows from a viewed position's remark. */
  private viewShapes = false;
  /** The sideline the player is trying, if any ("Try a sideline"): a tree of Lines, the game is paused. */
  private sideline?: LineTree;
  /** Resolves the wait for the sideline to be closed (used by "Show me" after a mistake). */
  private onSidelineClosed?: () => void;
  /** Bumped whenever the cursor or the tree changes, so a late engine answer for an old state is dropped. */
  private sidelineToken = 0;
  /** True while the engine ranks the options at the cursor. */
  private sidelineBusy = false;
  /** The options for the next move, ranked for one position (the cursor's). */
  private optionsAt?: { nodeId: number; options: Option[] };
  /** Moves of the sideline that are being rated or worded now. */
  private pendingNodes = new Set<LineNode>();
  /** The engine's moves are shown (dashed on the chart, arrows on the board). */
  private arrowsOn = false;
  /** The last move before the fork, for the chart ("4…d6"). */
  private forkLabel = 'Start';
  /** Saved games on this device (localStorage). */
  private store = new GameStore();
  /** The record of the game in progress, saved as it changes. */
  private record?: SavedGame;
  private el: Record<string, HTMLElement> = {};
  private importDialog!: ImportDialog;
  /** Game review's background analysis of games without a (current) one, while the screen is open. */
  private historyJob?: AbortController;
  private historyProgress?: { id: string; done: number; total: number };
  /** A saved game being looked at (Review): moments to walk through; the board is read-only. */
  private reviewing?: {
    moments: SavedMoment[];
    /** The moment shown, or -1 before the first. */
    index: number;
    /** What the coach says at `ply` instead of the game's log (the question before a moment, the intro). */
    say?: { ply: number; text: string; offerAnswer: boolean };
    opponent?: string;
    /** White's evaluation by ply, for the strip over the board. */
    curve?: number[];
    /** The whole-game analysis is running (it starts when a game without one is opened). */
    analysing?: { done: number; total: number };
    abort?: AbortController;
  };
  /** A puzzle session (task 3.2): the board holds a puzzle; the game in progress waits in storage. */
  private puzzling?: PuzzleSession;
  private puzzleResults = new PuzzleResults();
  /** The coach shown in the Puzzles tab (task 3.2b). */
  private puzzlePick = 0;
  /**
   * A puzzle set aside while the player went back to their game (the game and the puzzle are separate:
   * Play shows the game as it was left, the Puzzles tab offers to continue the puzzle). Kept with the coach's
   * words so far; the board is rebuilt from the puzzle when it comes back.
   */
  private parked?: { session: PuzzleSession; remarks: { ply: number; remark: Remark }[] };
  /** Takes down a Try again / Explore card that is waiting (the puzzle was skipped or left). */
  private retryCleanup?: () => void;
  /** The opening lesson on the board (task 6.2); the game in progress waits in storage, as with puzzles. */
  private lesson?: LessonSession;
  private openingProgress = new OpeningProgress();
  /** Spaced repetition cards (task 6.3): learned opening moves (puzzles later, 3.3). */
  private deck = new PracticeDeck();
  /** The coach shown in the Openings tab, and the course page open there (none: the tab itself). */
  private openingPick = 0;
  private openingView?: string;
  /** Bumped when a lesson starts or ends, so its walk stops. */
  private lessonToken = 0;
  /** The game ply a sideline started from (a sideline can start from an earlier viewed position). */
  private sidelinePly = 0;

  constructor(
    private root: HTMLElement,
    /** The theme pack in use: the coach of the game on the board (task 1.14). */
    private loaded: LoadedTheme,
  ) {
    this.render();
    this.analyst = Analyst.create();
    this.book = loadOpeningBook();
    this.opponent = createOpponent(levelInfo(this.settings.level).maiaElo, (loaded, total) => {
      if (this.game.moves.length === 0 && total) this.status(`Getting ready… ${Math.round((loaded / total) * 100)}%`);
    });
    // Ask the browser to keep this site's data (it may refuse); the game and its history live there.
    try {
      void navigator.storage?.persist?.();
    } catch {
      /* not critical */
    }
    void this.start();
  }

  /** Resumes the game left unfinished, or starts a new one (`?fen=` always starts a new one). */
  private async start(): Promise<void> {
    const saved = new URLSearchParams(location.search).has('fen') ? undefined : this.store.current();
    if (saved && saved.moves.length) {
      try {
        await this.newGame(saved);
        return;
      } catch {
        /* a damaged record: fall through to a new game */
      }
    }
    await this.newGame();
  }

  private render(): void {
    this.root.innerHTML = `
      <nav class="rail" aria-label="Main">
        <button id="rail-play" class="rail-item" aria-current="page">${RAIL_ICONS.play}<span>Play</span></button>
        <button id="rail-puzzles" class="rail-item">${RAIL_ICONS.puzzles}<span>Puzzles</span></button>
        <button id="rail-openings" class="rail-item">${RAIL_ICONS.openings}<span>Openings</span></button>
        <button id="history-open" class="rail-item">${RAIL_ICONS.review}<span>Game review</span></button>
        <button id="rail-settings" class="rail-item">${RAIL_ICONS.settings}<span>Settings</span></button>
      </nav>
      <header class="top">
        <h1>Sideline</h1>
        <div class="controls">
          <button id="new-game" class="primary">New game</button>
          <div class="menu-wrap menu-phone">
            <button id="more" class="more" aria-haspopup="menu" aria-expanded="false" aria-controls="more-menu" aria-label="Menu">☰</button>
            <div id="more-menu" class="menu more-menu" role="menu" hidden>
              <button id="menu-play" role="menuitem">Play</button>
              <button id="menu-puzzles" role="menuitem">Puzzles</button>
              <button id="menu-openings" role="menuitem">Openings</button>
              <button id="menu-review" role="menuitem">Game review</button>
              <button id="menu-settings" role="menuitem">Settings</button>
            </div>
          </div>
        </div>
      </header>
      <dialog id="newgame" class="sheet" aria-label="New game">
        <h2>New game</h2>
        <label>Coach <select id="ng-level">${LEVELS.map((l) => `<option value="${l.level}">${levelLabel(l)}</option>`).join('')}</select></label>
        <label>Mode <select id="ng-mode">${MODES.map((m) => `<option value="${m.id}">${m.name}</option>`).join('')}</select></label>
        <label>Play as
          <select id="ng-color">
            <option value="white">White</option>
            <option value="black">Black</option>
            <option value="random">Random</option>
          </select>
        </label>
        <div class="sheet-buttons">
          <button id="ng-cancel" class="ghost">Cancel</button>
          <button id="ng-start" class="primary">Start</button>
        </div>
      </dialog>
      <dialog id="settings-screen" class="history settings-screen" aria-label="Settings">
        <div class="history-head"><h2>Settings</h2><button id="settings-close" class="ghost">Back to play</button></div>
        <p class="history-note">These are the choices New game starts with. A change applies from your next game.</p>
        <div class="settings-list">
          <label>Coach <select id="level">${LEVELS.map((l) => `<option value="${l.level}">${levelLabel(l)}</option>`).join('')}</select></label>
          <label>Mode <select id="mode">${MODES.map((m) => `<option value="${m.id}">${m.name}</option>`).join('')}</select></label>
          <label>Coach personality
            <select id="plain">
              <option value="on">On</option>
              <option value="plain">Plain (facts only)</option>
            </select>
          </label>
          <label>Play as
            <select id="color">
              <option value="white">White</option>
              <option value="black">Black</option>
              <option value="random">Random</option>
            </select>
          </label>
        </div>
      </dialog>
      <dialog id="puzzles-screen" class="history puzzles-screen" aria-label="Puzzles">
        <div class="history-head"><h2>Puzzles</h2><button id="puzzles-close" class="ghost">Back to play</button></div>
        <div id="puzzles-list" class="puzzles-list"></div>
        <p id="puzzles-note" class="history-note" aria-live="polite"></p>
      </dialog>
      <dialog id="openings-screen" class="history puzzles-screen openings-screen" aria-label="Openings">
        <div class="history-head"><h2 id="openings-title">Openings</h2><button id="openings-close" class="ghost">Back to play</button></div>
        <div id="openings-list" class="puzzles-list"></div>
        <p id="openings-note" class="history-note" aria-live="polite"></p>
      </dialog>
      <main class="layout">
        <div id="board-area" class="board-area">
          <div class="board-stack">
            <div id="cap-top" class="captured" role="img"></div>
            <div class="board-frame">
              <div id="board" class="cg-wrap"></div>
              <div id="promotion" class="promotion" hidden></div>
              <div id="board-note" class="board-note" aria-live="assertive" hidden></div>
            </div>
            <div id="cap-bottom" class="captured" role="img"></div>
          </div>
          <div class="nav" role="group" aria-label="Move navigation">
            <button id="nav-start" aria-label="First position">«</button>
            <button id="nav-back" aria-label="Previous move">‹</button>
            <button id="nav-forward" aria-label="Next move">›</button>
            <button id="nav-live" aria-label="Latest position">»</button>
            <button id="takeback" class="undo">↶ Take back</button>
          </div>
          <div id="viewbar" class="viewbar" hidden>
            <span id="viewtext"></span>
            <button id="back-to-game" class="primary">Back to game</button>
          </div>
        </div>
        <dialog id="history" class="history" aria-label="Game review">
          <div class="history-head"><h2>Game review</h2><button id="history-close" class="ghost">Back to play</button></div>
          <div class="history-top"><button id="import-open" class="primary">Import games</button></div>
          <p id="history-note" class="history-note" aria-live="polite">Saved on this device only.</p>
          <ol id="history-list" class="history-list"></ol>
          <div class="history-foot">
            <button id="backup">Back up all data</button>
            <button id="restore">Restore from file</button>
            <input id="restore-file" type="file" accept="application/json,.json" hidden>
          </div>
        </dialog>
        <aside class="side">
          <div class="coach">
            <div class="coach-face">
              <div class="portrait-wrap">
                <div id="portrait" class="portrait" aria-hidden="true">
                  ${faceSvg('neutral')}
                </div>
                <button id="ask" class="ask" aria-haspopup="menu" aria-expanded="false" aria-controls="ask-menu">Ask</button>
              </div>
              <div class="face-name js-coach-name"></div>
            </div>
            <div id="ask-menu" class="menu ask-menu" role="menu" hidden>
              <button id="hint" role="menuitem"><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.6 10.8c.5.4.6 1 .6 1.7v.5h6v-.5c0-.7.1-1.3.6-1.7A6 6 0 0 0 12 3z"/></svg><span>Hint</span></button>
              <button id="sideline" role="menuitem"><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 4v16M6 14c0-5 4-4 9-6M14 5l4 3-3 4"/></svg><span>Try a sideline</span></button>
              <button id="flip" role="menuitem"><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 4v16M4 8l4-4 4 4M16 20V4M12 16l4 4 4-4"/></svg><span>Flip board</span></button>
            </div>
            <div id="bubble-box" class="bubble">
              <div class="coach-name"><span class="js-coach-name"></span> <span id="mood" class="mood"></span></div>
              <div id="bubble" class="log" aria-live="polite"></div>
            </div>
          </div>
          <div class="turn">
            <div id="choices" class="choices" hidden></div>
            <p id="status" class="status"></p>
          </div>
          <div id="sideline-bar" class="sidelinebar" hidden>
            <div id="chart-wrap" class="chart-wrap"><svg id="chart" role="group" aria-label="Lines: moves in lanes by quality"></svg></div>
            <div class="sideline-buttons">
              <button id="sideline-arrows" aria-pressed="false">Show engine moves</button>
              <button id="sideline-undo">Remove move</button>
              <button id="sideline-exit" class="primary">Back to game</button>
            </div>
          </div>
          <div id="review-bar" class="viewbar reviewbar" hidden>
            <span id="review-text"></span>
            <div id="review-timeline" class="timeline">
              <div class="plot">
                <svg id="review-strip" class="review-strip" viewBox="0 0 300 100" preserveAspectRatio="none" role="img" aria-label="The evaluation through the game. Tap to jump to a move."></svg>
                <div id="review-dots" class="review-dots" role="group" aria-label="Moments in this game"></div>
              </div>
            </div>
            <div class="review-buttons">
              <button id="review-next" class="primary">Next moment ›</button>
              <button id="review-exit">Back to game</button>
            </div>
          </div>
          <div id="puzzle-bar" class="viewbar reviewbar puzzlebar" hidden>
            <span id="puzzle-text"></span>
            <div class="review-buttons">
              <button id="puzzle-skip">Skip</button>
              <button id="puzzle-exit">Back to puzzles</button>
            </div>
          </div>
          <div id="lesson-bar" class="viewbar reviewbar puzzlebar lessonbar" hidden>
            <span id="lesson-text"></span>
            <div class="review-buttons">
              <button id="lesson-exit">Back to course</button>
            </div>
          </div>
          <ol id="moves" class="moves"></ol>
        </aside>
      </main>`;

    for (const id of ['board', 'promotion', 'bubble', 'bubble-box', 'mood', 'portrait', 'choices', 'status', 'moves', 'level', 'mode', 'color', 'takeback', 'hint', 'board-area', 'viewbar', 'viewtext', 'nav-start', 'nav-back', 'nav-forward', 'nav-live', 'back-to-game', 'cap-top', 'cap-bottom', 'board-note', 'more', 'more-menu', 'ask', 'ask-menu', 'sideline', 'sideline-bar', 'chart', 'chart-wrap', 'sideline-arrows', 'sideline-undo', 'sideline-exit', 'history', 'history-open', 'history-close', 'history-note', 'history-list', 'rail-play', 'rail-settings', 'menu-play', 'menu-review', 'menu-settings', 'newgame', 'ng-level', 'ng-mode', 'plain', 'ng-color', 'ng-cancel', 'ng-start', 'settings-screen', 'settings-close', 'review-bar', 'review-text', 'review-strip', 'review-dots', 'review-timeline', 'review-next', 'review-exit', 'import-open', 'backup', 'restore', 'restore-file', 'rail-puzzles', 'menu-puzzles', 'puzzles-screen', 'puzzles-close', 'puzzles-note', 'puzzles-list', 'puzzle-bar', 'puzzle-text', 'puzzle-skip', 'puzzle-exit', 'rail-openings', 'menu-openings', 'openings-screen', 'openings-close', 'openings-note', 'openings-list', 'openings-title', 'lesson-bar', 'lesson-text', 'lesson-exit']) {
      this.el[id] = this.root.querySelector(`#${id}`)!;
    }
    const level = this.el.level as HTMLSelectElement;
    const mode = this.el.mode as HTMLSelectElement;
    const color = this.el.color as HTMLSelectElement;
    level.value = String(this.settings.level);
    mode.value = this.settings.mode;
    color.value = this.settings.color;

    level.addEventListener('change', () => {
      this.updateSettings({ level: Number(level.value) });
      this.screenCoach();
    });
    this.el['ng-level'].addEventListener('change', () => this.screenCoach());
    this.el.newgame.addEventListener('close', () => this.screenCoach());
    mode.addEventListener('change', () => this.updateSettings({ mode: modeInfo(mode.value).id }));
    color.addEventListener('change', () => this.updateSettings({ color: color.value as ColorChoice }));
    const plain = this.el.plain as HTMLSelectElement;
    plain.value = this.settings.plain ? 'plain' : 'on';
    plain.addEventListener('change', () => {
      this.updateSettings({ plain: plain.value === 'plain' }, true);
      this.renderBubble(); // applies at once, to what is already said too
    });
    // A long coach remark opens on a tap (phones).
    this.el['bubble-box'].addEventListener('click', () => this.root.querySelector('.coach')!.classList.toggle('expanded'));
    this.root.querySelector('#new-game')!.addEventListener('click', () => this.openNewGameSheet());
    this.el['ng-cancel'].addEventListener('click', () => {
      (this.el.newgame as HTMLDialogElement).close();
      this.screenCoach(); // back to the board's coach now (the close event can come late)
    });
    this.el['ng-start'].addEventListener('click', () => {
      this.updateSettings({
        level: Number((this.el['ng-level'] as HTMLSelectElement).value),
        mode: modeInfo((this.el['ng-mode'] as HTMLSelectElement).value).id,
        color: (this.el['ng-color'] as HTMLSelectElement).value as ColorChoice,
      }, true);
      (this.el.newgame as HTMLDialogElement).close();
      this.showScreen('play');
      void this.newGame();
    });
    // The rail (desktop) and the Menu (phones) switch screens; Game review and Settings sit over the game.
    for (const [id, screen] of [['rail-play', 'play'], ['rail-puzzles', 'puzzles'], ['rail-openings', 'openings'], ['history-open', 'review'], ['rail-settings', 'settings'], ['menu-play', 'play'], ['menu-puzzles', 'puzzles'], ['menu-openings', 'openings'], ['menu-review', 'review'], ['menu-settings', 'settings']] as const) {
      this.el[id].addEventListener('click', () => {
        if (screen === 'play' && (this.puzzling || this.lesson)) return void this.backToGame();
        if (screen === 'openings' && id === 'rail-openings' && (this.el['openings-screen'] as HTMLDialogElement).open) this.openingView = undefined; // a second tap: back to the tab
        this.showScreen(screen);
      });
    }
    this.el['openings-screen'].addEventListener('close', () => this.railCurrent());
    this.el['openings-close'].addEventListener('click', () => (this.openingView ? (this.openingView = undefined, this.renderOpeningsScreen()) : this.showScreen('play')));
    this.el['openings-list'].addEventListener('click', (e) => this.onOpeningsClick(e));
    this.el['lesson-exit'].addEventListener('click', () => void this.exitLesson());
    this.el['settings-close'].addEventListener('click', () => this.showScreen('play'));
    this.el.history.addEventListener('close', () => {
      this.historyJob?.abort(); // the list's background analysis stops with the screen
      this.railCurrent();
    });
    this.el['settings-screen'].addEventListener('close', () => this.railCurrent());
    this.el['puzzles-screen'].addEventListener('close', () => this.railCurrent());
    this.el['puzzles-close'].addEventListener('click', () => this.showScreen('play'));
    this.el['puzzles-list'].addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('button[data-continue]')) return void this.continuePuzzle();
      const pick = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-pick]');
      if (pick) {
        this.puzzlePick = Number(pick.dataset.pick);
        this.renderPuzzlesScreen();
        this.screenCoach();
        return;
      }
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-level]');
      if (b) void this.openPuzzles(levelInfo(Number(b.dataset.level)), b.dataset.theme || undefined);
    });
    this.el['puzzle-skip'].addEventListener('click', () => void this.skipPuzzle());
    this.el['puzzle-exit'].addEventListener('click', () => void this.exitPuzzles());
    this.root.querySelector('#flip')!.addEventListener('click', () => {
      this.board.toggleOrientation();
      this.renderMaterial(this.nav.viewing ? this.game.positionAt(this.nav.ply).fen : this.game.fen);
    });
    this.wireMenu('more', 'more-menu');
    this.wireMenu('ask', 'ask-menu', this.el.portrait);
    this.el.takeback.addEventListener('click', () => void this.takeback());
    this.el.hint.addEventListener('click', () => void this.hint());
    this.el['history-close'].addEventListener('click', () => this.showScreen('play'));
    this.el['history-list'].addEventListener('click', (e) => this.onHistoryClick(e));
    this.el['import-open'].addEventListener('click', () => {
      (this.el.history as HTMLDialogElement).close();
      this.importDialog.open();
    });
    this.el['review-exit'].addEventListener('click', () => void this.exitReview());
    this.el['review-next'].addEventListener('click', () => this.gotoMoment((this.reviewing?.index ?? -1) + 1));
    this.el.backup.addEventListener('click', () => this.backup());
    this.el.restore.addEventListener('click', () => this.el['restore-file'].click());
    this.el['restore-file'].addEventListener('change', () => void this.restore());
    this.el.sideline.addEventListener('click', () => this.startSideline());
    this.el['sideline-undo'].addEventListener('click', () => this.sidelineUndo());
    this.el['sideline-arrows'].addEventListener('click', () => {
      this.arrowsOn = !this.arrowsOn;
      this.renderSideline();
    });
    this.el['sideline-exit'].addEventListener('click', () => this.exitSideline());

    this.importDialog = new ImportDialog(this.root, {
      store: this.store,
      level: () => this.settings.level,
      createAnalyst: () => Analyst.create(),
      onChange: () => this.renderHistory(),
    });
    // Import opens from the Game review screen, so closing it returns there.
    this.root.querySelector('dialog.import')?.addEventListener('close', () => this.showScreen('review'));

    // The same four buttons step through a sideline, one move per tap.
    this.el['nav-start'].addEventListener('click', () => (this.sideline ? this.sideStep('start') : this.navigate(() => this.nav.start())));
    this.el['nav-back'].addEventListener('click', () => (this.sideline ? this.sideStep('back') : this.navigate(() => this.nav.back())));
    this.el['nav-forward'].addEventListener('click', () => (this.sideline ? this.sideStep('forward') : this.navigate(() => this.nav.forward())));
    this.el['nav-live'].addEventListener('click', () => (this.sideline ? this.sideStep('end') : this.navigate(() => this.nav.goLive())));
    this.el['back-to-game'].addEventListener('click', () => this.navigate(() => this.nav.goLive()));
    this.el.moves.addEventListener('click', (e) => {
      const cell = (e.target as HTMLElement).closest<HTMLElement>('[data-ply]');
      if (cell) this.navigate(() => this.nav.goTo(Number(cell.dataset.ply)));
    });
    document.addEventListener('keydown', (e) => this.onKey(e));

    this.board = Chessground(this.el.board, {
      coordinates: true,
      animation: { enabled: !matchMedia('(prefers-reduced-motion: reduce)').matches, duration: 200 },
      highlight: { lastMove: true, check: true },
      premovable: { enabled: false },
      draggable: { showGhost: true },
      movable: {
        free: false,
        showDests: true,
        events: { after: (orig, dest) => void this.onPlayerMove(orig as Square, dest as Square) },
      },
    });
    // One arrow colour and width per quality of move, the same colours as the chart (task 1.12d).
    const brushes = { ...this.board.state.drawable.brushes };
    for (const l of LANES) brushes[`q-${l}`] = { key: `q-${l}`, color: LANE_COLOUR[l], opacity: 0.85, lineWidth: LANE_ARROW[l] };
    this.board.set({ drawable: { brushes } });
    // Chessground measures the board once and only re-measures on a window resize. A sideline changes the
    // board's size through CSS alone (the side column grows), so clicks would land on the wrong square.
    let pending = 0;
    new ResizeObserver(() => {
      cancelAnimationFrame(pending);
      pending = requestAnimationFrame(() => this.board.redrawAll());
    }).observe(this.el.board);
    // Belt and braces: whatever moved or resized the board since, every press measures it afresh (capture
    // phase, so before chessground reads its cached size).
    for (const type of ['mousedown', 'touchstart', 'pointerdown']) {
      this.el.board.addEventListener(type, () => this.board.state.dom.bounds.clear(), { capture: true, passive: true });
    }
  }

  private updateSettings(change: Partial<Settings>, quiet = false): void {
    this.settings = { ...this.settings, ...change };
    saveSettings(this.settings);
    if (quiet) return;
    if (change.level !== undefined) this.status(`${levelInfo(change.level).coach.name} will coach your next game.`);
    if (change.mode !== undefined) this.status(`${modeInfo(change.mode).name} mode set. It applies from your next game.`);
  }

  /** The sheet New game opens: level, mode and colour for this game, starting from the saved choices. */
  private openNewGameSheet(): void {
    (this.el['ng-level'] as HTMLSelectElement).value = String(this.settings.level);
    (this.el['ng-mode'] as HTMLSelectElement).value = this.settings.mode;
    (this.el['ng-color'] as HTMLSelectElement).value = this.settings.color;
    this.showScreen('play');
    (this.el.newgame as HTMLDialogElement).showModal();
    this.screenCoach();
  }

  /** Switches screen: Play is the game itself; Game review and Settings are full screens over it (not modal, so the rail stays usable). */
  private showScreen(screen: Screen): void {
    const history = this.el.history as HTMLDialogElement;
    const settings = this.el['settings-screen'] as HTMLDialogElement;
    const puzzles = this.el['puzzles-screen'] as HTMLDialogElement;
    const openings = this.el['openings-screen'] as HTMLDialogElement;
    if (screen !== 'openings' && openings.open) openings.close();
    if (screen === 'openings') {
      this.renderOpeningsScreen();
      if (!openings.open) openings.show();
    }
    if (screen !== 'review' && history.open) history.close();
    if (screen !== 'settings' && settings.open) settings.close();
    if (screen !== 'puzzles' && puzzles.open) puzzles.close();
    if (screen === 'puzzles' && !puzzles.open) {
      this.renderPuzzlesScreen();
      puzzles.show();
    }
    if (screen === 'review' && !history.open) this.openHistory();
    if (screen === 'settings' && !settings.open) {
      (this.el.level as HTMLSelectElement).value = String(this.settings.level);
      (this.el.mode as HTMLSelectElement).value = this.settings.mode;
      (this.el.color as HTMLSelectElement).value = this.settings.color;
      (this.el.plain as HTMLSelectElement).value = this.settings.plain ? 'plain' : 'on';
      settings.show();
    }
    this.railCurrent();
  }

  /** Marks the rail item of the screen that is open. */
  private railCurrent(): void {
    const open = (id: string) => (this.el[id] as HTMLDialogElement).open;
    const screen = open('history') ? 'history-open' : open('settings-screen') ? 'rail-settings' : open('openings-screen') ? 'rail-openings' : open('puzzles-screen') || this.puzzling ? 'rail-puzzles' : this.lesson ? 'rail-openings' : 'rail-play';
    for (const id of ['rail-play', 'rail-puzzles', 'rail-openings', 'history-open', 'rail-settings']) {
      if (id === screen) this.el[id].setAttribute('aria-current', 'page');
      else this.el[id].removeAttribute('aria-current');
    }
    this.screenCoach();
  }

  /** Starts a new game, or (with `resume`) carries on a saved one exactly where it stopped. */
  private async newGame(resume?: SavedGame): Promise<void> {
    this.parkPuzzle();
    this.endLesson();
    const id = ++this.gameId;
    this.reviewing?.abort?.abort();
    this.reviewing = undefined;
    this.puzzling = undefined;
    this.railCurrent();
    this.thinking = false;
    this.sideline = undefined;
    this.sidelineToken++;
    this.sidelineBusy = false;
    this.onSidelineClosed?.();
    this.onSidelineClosed = undefined;
    // `?fen=` starts from a position, playing the side to move (for testing,
    // and later for starting games from repertoire positions).
    const startFen = resume?.startFen ?? new URLSearchParams(location.search).get('fen') ?? undefined;
    const color: Color = resume
      ? resume.playerColor
      : startFen
        ? startFen.split(' ')[1] === 'b'
          ? 'black'
          : 'white'
        : this.settings.color === 'random'
          ? Math.random() < 0.5
            ? 'white'
            : 'black'
          : this.settings.color;
    const level = levelInfo(resume?.level ?? this.settings.level);
    void this.showCoach(level);
    const mode = (this.mode = modeInfo(resume?.mode ?? this.settings.mode));
    let game: Game;
    try {
      game = new Game(color, startFen);
    } catch {
      if (resume) throw new Error('damaged saved game');
      game = new Game(color); // invalid FEN: normal start
    }
    if (resume) for (const uci of resume.moves) game.play(uci); // throws on a damaged record: the caller starts fresh
    this.game = game;
    this.store.setCurrent(undefined); // until this game has a move, a reload starts fresh
    this.record = resume ?? {
      version: 1,
      id: newGameId(),
      startedAt: Date.now(),
      updatedAt: Date.now(),
      startFen: game.startFen,
      playerColor: color,
      level: level.level,
      mode: mode.id,
      moves: [],
      remarks: [],
      sidelines: [],
      moments: [],
      hintsUsed: 0,
    };
    const hintsUsed = this.record.hintsUsed;
    this.coach = Promise.all([this.analyst, this.book]).then(([a, book]) => {
      const c = new Coach(a, level, color === 'white' ? 'w' : 'b', mode, book);
      c.hintsUsed = hintsUsed;
      return c;
    });
    this.nav.reset(game.moves.length);
    this.log.clear();
    for (const e of resume?.remarks ?? []) this.log.add(e.ply, e.remark);
    this.viewShapes = false;
    this.board.set({ orientation: color, lastMove: undefined });
    this.board.setAutoShapes([]);
    this.el.choices.hidden = true;
    this.stopDemo();
    this.sync();

    const opponent = await this.opponent;
    if (id !== this.gameId) return;
    opponent.elo = level.maiaElo;

    if (resume) {
      if (game.result.over) {
        this.status('Game over.');
        return;
      }
      if (game.isPlayerTurn) {
        // Silent: what the coach said here is already in the log. Only the analysis is rebuilt.
        this.status('Welcome back. Your move.');
        void (await this.coach).prepare(game.fen);
      } else {
        this.status('Welcome back.');
        await this.opponentMove(id);
      }
      return;
    }
    const side = color === 'white' ? 'White' : 'Black';
    if (this.game.isPlayerTurn) {
      this.say({ kind: 'phase', text: `Let's play! You're ${side}, so you go first.`, mood: 'neutral', cue: 'start' });
      await this.startPlayerTurn(id);
    } else {
      this.say({ kind: 'phase', text: `Let's play! You're ${side}, so I'll start.`, mood: 'neutral', cue: 'start' });
      await this.opponentMove(id);
    }
  }

  /** Writes the game in progress to this device (nothing is saved before the first move). */
  private save(): void {
    const r = this.record;
    if (!r || !this.game || this.reviewing || this.puzzling || this.lesson) return; // a reviewed game is saved only when a sideline is kept
    r.moves = this.game.moves.map((m) => m.uci);
    if (!r.moves.length) {
      // Nothing worth keeping yet; and if moves were saved before (a takeback to the start), forget that game
      // so a reload doesn't bring back the position that was taken back.
      if (this.store.get(r.id)) {
        this.store.delete(r.id);
        this.store.setCurrent(undefined);
      }
      return;
    }
    r.opening = openingBookIfLoaded()?.openingOf(r.startFen, r.moves) ?? r.opening;
    r.remarks = this.log.all.map((e) => ({ ply: e.ply, remark: e.remark }));
    const res = this.game.result;
    r.result = res.over ? { winner: res.winner, reason: res.reason } : undefined;
    if (this.store.save(r)) this.store.setCurrent(res.over ? undefined : r.id);
  }

  /** Pushes the game state to the board and controls. */
  private sync(): void {
    const g = this.game;
    const nav = this.nav;
    nav.setLive(g.moves.length);
    this.el['board-area'].classList.toggle('sidelining', !!this.sideline);
    this.el['sideline-bar'].hidden = !this.sideline;
    this.renderReviewBar();
    this.renderPuzzleBar();
    this.renderLessonBar();
    if (this.sideline) return this.renderSideline();
    this.board.set({ viewOnly: false });
    const view = nav.viewing ? g.positionAt(nav.ply) : undefined;
    const shown = view ?? { fen: g.fen, turn: g.turn, inCheck: g.inCheck, lastMove: g.lastMove };
    const last = shown.lastMove;
    // Viewing the past: the board is read-only.
    const canMove = !this.reviewing && !nav.viewing && g.isPlayerTurn && !g.result.over && !this.thinking && (!this.puzzling || this.puzzling.phase === 'solving') && (!this.lesson || this.lesson.phase === 'quiz');
    this.board.set({
      fen: shown.fen,
      turnColor: shown.turn,
      check: shown.inCheck ? shown.turn : false,
      lastMove: last ? [last.from as Key, last.to as Key] : undefined,
      movable: { color: canMove ? g.playerColor : undefined, dests: canMove ? (g.dests as Map<Key, Key[]>) : new Map() },
    });
    // Arrows from the remark said at a viewed position; back to the live ones after.
    if (nav.viewing) {
      this.board.setAutoShapes(this.asking() ? [] : this.shapesAt(nav.ply));
      this.viewShapes = true;
    } else if (this.viewShapes) {
      this.board.setAutoShapes(this.shapesAt(nav.live));
      this.viewShapes = false;
    }
    // In Review the move just played wears its label on the board.
    if (this.reviewing) {
      const label = this.reviewLabel(nav.ply);
      const move = g.moves[nav.ply - 1];
      this.board.setAutoShapes(label && move ? [labelShape(move.to, label)] : []);
    }
    // In Review nothing is played in the game: a move of either side on the shown position opens a sideline with it.
    if (this.reviewing && !this.reviewing.analysing) {
      const dests = new LineTree(shown.fen, g.playerColor).dests;
      this.board.set({ movable: { color: shown.turn, dests: dests as Map<Key, Key[]> } });
    }
    this.renderMaterial(shown.fen);
    this.renderEndSignals(shown.fen, !nav.viewing && !this.reviewing && !this.puzzling && !this.lesson && g.result.over);
    this.renderMoves();
    this.renderBubble();
    this.renderNav(shown.lastMove?.san);
    this.el.takeback.hidden = !this.mode.takebacks;
    (this.el.takeback as HTMLButtonElement).disabled = nav.viewing || this.thinking || !g.moves.some((m) => m.color === g.playerColor);
    (this.el.hint as HTMLButtonElement).disabled = !canMove;
    this.el.hint.hidden = !!this.reviewing;
    // A sideline can start from any shown position (also an earlier one), unless the coach is busy.
    this.el.sideline.hidden = !this.mode.sidelines;
    (this.el.sideline as HTMLButtonElement).disabled = this.thinking || (g.result.over && !nav.viewing);
    this.el.portrait.classList.toggle('busy', this.thinking);
    this.save();
  }

  /** Pieces each side has captured, and the point balance (board only, no engine). */
  private renderMaterial(fen: string): void {
    const m = materialOf(fen);
    // The strip under the board belongs to the side at the bottom (it follows the board when it is flipped).
    const bottom = this.board.state.orientation === 'white' ? 'w' : 'b';
    const strip = (el: HTMLElement, side: 'w' | 'b') => {
      const pieces = side === 'w' ? m.capturedByWhite : m.capturedByBlack; // what this side has taken
      const taken = side === 'w' ? 'b' : 'w'; // the colour of those pieces
      const ahead = side === 'w' ? m.balance : -m.balance;
      el.replaceChildren();
      for (const type of ['q', 'r', 'b', 'n', 'p']) {
        const n = pieces.filter((p) => p === type).length;
        if (!n) continue;
        const group = document.createElement('span');
        group.className = 'cap-group';
        for (let i = 0; i < n; i++) {
          const img = document.createElement('img');
          img.src = `${this.loaded.base}${this.loaded.theme.pieces.folder}/${taken}${type.toUpperCase()}.${this.loaded.theme.pieces.format}`;
          img.alt = '';
          group.append(img);
        }
        el.append(group);
      }
      if (ahead > 0) {
        const plus = document.createElement('span');
        plus.className = `cap-plus lead-${side}`;
        plus.textContent = `+${ahead}`;
        el.append(plus);
      }
      const who = side === (this.game.playerColor === 'white' ? 'w' : 'b') ? 'you' : this.reviewing ? 'the opponent' : 'the coach';
      el.setAttribute('aria-label', pieces.length ? `Pieces taken by ${who}: ${pieces.length}${ahead > 0 ? `, ${ahead} points ahead` : ''}` : `${who[0].toUpperCase()}${who.slice(1)} has taken nothing`);
    };
    strip(this.el['cap-bottom'], bottom);
    strip(this.el['cap-top'], bottom === 'w' ? 'b' : 'w');
  }

  private signalKey = '';
  private signalTimer?: number;

  /**
   * Check and the end of a game, made hard to miss (everywhere a position is shown). A new check rings the king,
   * shakes the board and pops a "Check" tag for a moment; checkmate dims the board and puts the result on it
   * until the position changes. `final`: this is the live game's last position, so New game and Review are offered.
   * Each position signals once (the same position redrawn does nothing new).
   */
  private renderEndSignals(fen: string, final: boolean): void {
    const area = this.el['board-area'];
    const note = this.el['board-note'];
    const c = new Chess(fen);
    const res = resultOf(c);
    const mate = c.isCheckmate();
    const draw = res.over && !mate;
    const check = c.inCheck() && !mate;
    const kind = mate ? 'mate' : draw && final ? 'draw' : check ? 'check' : '';
    const key = `${fen}|${kind}|${final}`;
    area.classList.toggle('ended', kind === 'mate' || kind === 'draw');
    if (key === this.signalKey) return;
    this.signalKey = key;
    window.clearTimeout(this.signalTimer);
    area.classList.remove('checking', 'shake');
    note.replaceChildren();
    note.className = 'board-note';
    note.hidden = !kind;
    if (!kind) return;
    note.classList.add(kind);
    if (kind === 'check') {
      void area.offsetWidth; // restart the animations
      area.classList.add('checking', 'shake');
      const tag = document.createElement('span');
      tag.className = 'tag';
      tag.textContent = 'Check';
      note.append(tag);
      this.signalTimer = window.setTimeout(() => {
        note.hidden = true;
        area.classList.remove('checking', 'shake');
      }, 1800);
      return;
    }
    const card = document.createElement('div');
    card.className = 'card';
    const title = document.createElement('strong');
    const sub = document.createElement('span');
    if (mate) {
      const winner = res.over && res.winner ? res.winner : undefined;
      title.textContent = 'Checkmate';
      sub.textContent = !winner ? '' : this.reviewing || (this.sideline && !this.puzzling) ? `${winner === 'white' ? 'White' : 'Black'} wins` : winner === this.game.playerColor ? 'You win' : 'The coach wins';
    } else {
      title.textContent = 'Draw';
      sub.textContent = res.over ? `by ${res.reason}` : '';
    }
    card.append(title, sub);
    if (final) {
      const buttons = document.createElement('div');
      buttons.className = 'buttons';
      const again = document.createElement('button');
      again.className = 'primary';
      again.textContent = 'New game';
      again.addEventListener('click', () => this.openNewGameSheet());
      const review = document.createElement('button');
      review.textContent = 'Review';
      review.addEventListener('click', () => {
        const rec = this.record;
        if (rec) void this.openReview(this.store.get(rec.id) ?? rec);
      });
      buttons.append(again, review);
      card.append(buttons);
    }
    note.append(card);
  }

  /** A button that opens a small menu under it; any tap outside, Esc or choosing an item closes it. */
  private wireMenu(buttonId: string, menuId: string, alsoOpenedBy?: HTMLElement): void {
    const button = this.el[buttonId];
    const menu = this.el[menuId];
    const close = () => {
      menu.hidden = true;
      button.setAttribute('aria-expanded', 'false');
    };
    const toggle = (e: Event) => {
      e.stopPropagation();
      const open = menu.hidden;
      for (const m of this.root.querySelectorAll<HTMLElement>('.menu')) m.hidden = true;
      menu.hidden = !open;
      button.setAttribute('aria-expanded', String(open));
    };
    button.addEventListener('click', toggle);
    alsoOpenedBy?.addEventListener('click', toggle);
    menu.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('button')) close();
    });
    document.addEventListener('click', (e) => {
      if (!menu.hidden && !menu.contains(e.target as Node)) close();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !menu.hidden) close();
    });
  }

  private shapesAt(ply: number): DrawShape[] {
    if (this.reviewing) return []; // Review draws no arrows: a line is played through in a sideline (Show line)
    return this.log
      .at(ply)
      .flatMap((e) => remarkShapes(e.remark));
  }

  /** Buttons, the "Viewing…" bar and the highlighted move. */
  private renderNav(san: string | undefined): void {
    const nav = this.nav;
    (this.el['nav-start'] as HTMLButtonElement).disabled = !nav.canBack;
    (this.el['nav-back'] as HTMLButtonElement).disabled = !nav.canBack;
    (this.el['nav-forward'] as HTMLButtonElement).disabled = !nav.canForward;
    (this.el['nav-live'] as HTMLButtonElement).disabled = !nav.canForward;
    this.el.viewbar.hidden = !nav.viewing || !!this.reviewing; // the review bar takes its place
    this.el['board-area'].classList.toggle('viewing', nav.viewing);
    this.el.viewtext.textContent = nav.viewing
      ? `Viewing ${plyLabel(this.game.startFen, nav.ply, san)}${nav.hasNewMove ? ' · new move played' : ''}`
      : '';
    this.el.moves.querySelector('.cur')?.classList.remove('cur');
    const cur = this.el.moves.querySelector<HTMLElement>(`[data-ply="${nav.ply}"]`);
    cur?.classList.add('cur');
    if (cur && nav.viewing) this.el.moves.scrollLeft = cur.offsetLeft - this.el.moves.clientWidth / 2;
  }

  /** Runs a navigation change, then redraws. */
  private navigate(change: () => void): void {
    change();
    this.sync();
  }

  private onKey(e: KeyboardEvent): void {
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    if (e.target instanceof Element && e.target.closest('select, input, textarea')) return;
    if (this.sideline) {
      if (e.key === 'Escape') this.exitSideline();
      const steps: Record<string, 'start' | 'back' | 'forward' | 'end'> = { ArrowLeft: 'back', ArrowRight: 'forward', Home: 'start', End: 'end' };
      if (steps[e.key]) {
        e.preventDefault();
        this.sideStep(steps[e.key]);
      }
      return;
    }
    const actions: Record<string, () => void> = {
      ArrowLeft: () => this.nav.back(),
      ArrowRight: () => this.nav.forward(),
      Home: () => this.nav.start(),
      End: () => this.nav.goLive(),
    };
    const action = actions[e.key];
    if (!action || !this.game) return;
    e.preventDefault();
    this.navigate(action);
  }

  private renderMoves(): void {
    // Games can start mid-game (from a position), possibly with Black to move.
    const [, turn, , , , full] = this.game.startFen.split(' ');
    // Each cell is a button: tapping it shows the position after that move.
    const cells = this.game.moves.map((m, i) => ({ san: m.san, ply: i + 1 }));
    if (turn === 'b') cells.unshift({ san: '…', ply: 0 });
    // In Review every move wears its label (the asked moment's move only once it is revealed).
    const mark = (ply: number) => {
      const label = this.reviewLabel(ply);
      return label ? `<i class="mv-badge" style="--c:${LABEL_INFO[label].colour}" title="${LABEL_INFO[label].name}" aria-label="${LABEL_INFO[label].name}">${LABEL_INFO[label].glyph}</i>` : '';
    };
    const cell = (c?: { san: string; ply: number }) =>
      !c ? '<span></span>' : c.ply === 0 ? `<span>${c.san}</span>` : `<button data-ply="${c.ply}" class="mv">${c.san}${mark(c.ply)}</button>`;
    const first = Number(full) || 1;
    const rows: string[] = [];
    for (let i = 0; i < cells.length; i += 2) {
      rows.push(`<li><span class="num">${first + i / 2}.</span>${cell(cells[i])}${cell(cells[i + 1])}</li>`);
    }
    this.el.moves.innerHTML = rows.join('');
    if (!this.nav.viewing) {
      this.el.moves.scrollTop = this.el.moves.scrollHeight;
      this.el.moves.scrollLeft = this.el.moves.scrollWidth; // phones show the moves as a strip
    }
  }

  /** A move's label in Review, unless it is the move the coach is asking about (that would give the answer away). */
  private reviewLabel(ply: number): MoveLabel | undefined {
    const r = this.reviewing;
    if (!r || r.analysing || ply < 1) return undefined;
    if (this.asking() && r.moments[r.index]?.ply === ply) return undefined;
    return this.record?.labels?.[ply - 1];
  }

  /** The bubble: the coach's remarks for the position, newest at the bottom. */
  private renderBubble(): void {
    const nav = this.nav;
    const bubble = this.el.bubble;
    const sideline = this.sideline;
    if (sideline) {
      // In a sideline the bubble shows only what the coach said about the move on the board (and its lane
      // and who is better after it); earlier moves are one tap back (‹).
      const node = sideline.cursor;
      const lines = node.notes.length ? node.notes : node === sideline.root ? [] : ['Thinking…'];
      const entries = lines.map((text) => {
        const p = document.createElement('p');
        p.className = 'entry';
        setRich(p, text);
        return p;
      });
      if (node.rating) {
        const v = verdictOf(node.rating.evalCp);
        const p = document.createElement('p');
        p.className = `entry verdict ${v.side}`;
        p.innerHTML = `${laneBadgeSvg(node.rating.lane, 18)}<span></span>`;
        p.title = LANE_NAME[node.rating.lane];
        p.setAttribute('aria-label', `${LANE_NAME[node.rating.lane]}. ${v.text}${node.rating.common ? '. Common at your level' : ''}`);
        p.lastElementChild!.textContent = `${v.text}${node.rating.common ? ' · common at your level' : ''}`;
        entries.unshift(p); // first, so it stays visible when the note is long
      }
      if (node.reason) {
        const p = document.createElement('p');
        p.className = 'entry reason';
        setRich(p, node.reason.text);
        entries.push(p);
      }
      bubble.replaceChildren(...entries);
      this.el.mood.textContent = '';
      this.setMood('neutral');
      bubble.scrollTop = 0;
      return;
    }
    const say = this.reviewing?.say;
    if (say && say.ply === nav.ply) {
      const p = document.createElement('p');
      p.className = 'entry';
      setRich(p, say.text);
      bubble.replaceChildren(p);
      this.el.mood.textContent = '';
      this.setMood('thinking');
      return;
    }
    const entries = nav.viewing ? this.log.at(nav.ply) : this.log.recent(nav.live);
    bubble.replaceChildren();
    if (!entries.length) {
      const p = document.createElement('p');
      p.className = 'entry none';
      p.textContent = nav.viewing ? 'I didn’t say anything at this move.' : '';
      bubble.append(p);
    }
    entries.forEach((e, i) => {
      const p = document.createElement('p');
      p.className = !nav.viewing && i < entries.length - 1 ? 'entry old' : 'entry';
      setRemark(p, e.remark, !!this.settings.plain);
      bubble.append(p);
    });
    const newest = entries.at(-1)?.remark;
    this.el.mood.textContent = !newest || newest.mood === 'neutral' ? '' : newest.mood;
    this.setMood(newest?.mood ?? 'neutral');
    // Live: the newest remark starts at the top edge, so a long one is read from its first line.
    const last = bubble.lastElementChild as HTMLElement | null;
    bubble.scrollTop = 0;
    if (!nav.viewing && last) bubble.scrollTop = Math.max(0, last.getBoundingClientRect().top - bubble.getBoundingClientRect().top);
  }

  private face?: Mood;
  private coachToken = 0;
  /** The coach of what is on the board (game, review, puzzle or lesson); a picker on another screen only previews. */
  private boardCoach?: Level;

  /**
   * The whole app takes the look of the coach on screen: the one picked on Puzzles, Openings or Settings while
   * that screen is open (or in the New game sheet), else the board's coach.
   */
  private screenCoach(): void {
    const open = (id: string) => (this.el[id] as HTMLDialogElement).open;
    const mine = this.settings.level;
    const picked = open('newgame')
      ? Number((this.el['ng-level'] as HTMLSelectElement).value)
      : open('puzzles-screen')
        ? this.puzzlePick || mine
        : open('openings-screen')
          ? this.openingPick || mine
          : open('settings-screen')
            ? mine
            : undefined;
    if (picked) void this.showCoach(levelInfo(picked), true);
    else if (this.boardCoach) void this.showCoach(this.boardCoach);
  }

  /** Shows the coach of a tier: its name, and its theme pack (board, pieces, accent, portraits). */
  private async showCoach(level: Level, preview = false): Promise<void> {
    if (!preview) this.boardCoach = level;
    const token = ++this.coachToken;
    for (const el of this.root.querySelectorAll<HTMLElement>('.js-coach-name')) setCoachName(el, level);
    this.el.portrait.title = level.coach.name;
    if (this.loaded.id === level.theme) {
      if (this.face === undefined) this.setMood((this.el.portrait.dataset.mood as Mood | undefined) ?? 'neutral');
      return;
    }
    let t: LoadedTheme;
    try {
      t = await fetchTheme(level.theme);
    } catch (err) {
      console.warn('Theme not loaded', err);
      return; // the previous coach's look stays
    }
    if (token !== this.coachToken) return; // another coach was asked for meanwhile
    applyLoaded(t);
    this.loaded = t;
    // Fetch the other faces now, so a change of mood does not flash an empty circle.
    for (const m of MOODS) {
      const url = portraitUrl(t, m);
      if (url) new Image().src = url;
    }
    this.face = undefined;
    this.setMood((this.el.portrait.dataset.mood as Mood | undefined) ?? 'neutral');
    if (this.game) this.sync(); // the captured pieces' images come from the pack
  }

  /** The coach's face follows the mood; a mistake or blunder makes it start (the signal to look at the board). */
  private setMood(mood: Mood, alert?: 'mistake' | 'blunder' | 'opportunity'): void {
    const p = this.el.portrait;
    p.dataset.mood = mood;
    if (this.face !== mood) {
      const url = portraitUrl(this.loaded, mood);
      if (url) {
        const img = document.createElement('img');
        img.src = url;
        img.alt = '';
        p.replaceChildren(img);
      } else p.innerHTML = faceSvg(mood);
      this.face = mood;
    }
    p.classList.remove('alert', 'alert-big', 'alert-good');
    if (alert) {
      void p.offsetWidth; // restart the animation
      p.classList.add(alert === 'blunder' ? 'alert-big' : alert === 'opportunity' ? 'alert-good' : 'alert');
    }
  }

  // --- The coach reacts on the board (task 1.12a) ----------------------------
  // After a flagged move the board itself reacts: a ring on the piece in danger, a badge on the moved piece,
  // and the coach's line plays out once as a ghost line, then the real position comes back.

  /** The refutation shown for the move being decided on, and whether it is playing now. */
  private demo?: { fenAfter: string; ucis: string[]; remark: Remark; running: boolean };
  private demoToken = 0;

  private async playDemo(): Promise<void> {
    const d = this.demo;
    if (!d) return;
    const token = ++this.demoToken;
    const area = this.el['board-area'];
    d.running = true;
    await sleep(700); // the player's own move settles, with its badge and ring
    if (token !== this.demoToken) return;
    this.board.setAutoShapes([]);
    area.classList.add('ghosting');
    const chess = new Chess(d.fenAfter);
    for (const uci of d.ucis) {
      chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
      this.board.set({
        fen: chess.fen(),
        turnColor: chess.turn() === 'w' ? 'white' : 'black',
        check: chess.inCheck() ? (chess.turn() === 'w' ? 'white' : 'black') : false,
        lastMove: [uci.slice(0, 2) as Key, uci.slice(2, 4) as Key],
      });
      await sleep(DEMO_STEP_MS);
      if (token !== this.demoToken) return;
    }
    await sleep(900); // stay where the damage is
    if (token !== this.demoToken) return;
    this.endDemo();
  }

  /** Back to the real position, with the ring, badge and arrow. */
  private endDemo(): void {
    this.demoToken++;
    if (this.demo) this.demo.running = false;
    this.el['board-area'].classList.remove('ghosting');
    this.sync();
    if (this.demo) this.board.setAutoShapes(remarkShapes(this.demo.remark));
  }

  /** The choice is made (or the game moved on): no demo, no tint. */
  private stopDemo(): void {
    this.demoToken++;
    this.demo = undefined;
    this.el['board-area'].classList.remove('ghosting', 'blunder');
  }

  /** The coach's reaction to the player's move: face, board marks, and the ghost line for a mistake. */
  private react(r: Remark, fenBefore: string, moment?: SavedMoment): void {
    if (!r.severity) return;
    if (r.severity === 'mistake' || r.severity === 'blunder' || r.severity === 'slip') {
      this.setMood(r.mood, r.severity === 'blunder' ? 'blunder' : 'mistake');
    }
    if (r.severity === 'blunder') this.el['board-area'].classList.add('blunder');
    if (moment?.answer?.length && this.mode.revealsPlans) {
      const chess = new Chess(fenBefore);
      chess.move({ from: moment.played.slice(0, 2), to: moment.played.slice(2, 4), promotion: moment.played[4] });
      this.demo = { fenAfter: chess.fen(), ucis: moment.answer, remark: r, running: false };
      void this.playDemo();
    }
  }

  /** The coach speaks: new text in the bubble, with arrows or circles on the board. */
  private say(r: Remark): void {
    // The coach's phrase (voices.ts): its budget counts every bubble. Sparring games keep to the rare ones.
    const sparring = !this.puzzling && !this.lesson && this.mode.id === 'sparring';
    const phrase = this.voice.next(this.boardCoach?.coach.id ?? '', r.cue, { plain: this.settings.plain, sparring });
    r = { ...r, phrase };
    // Kept with its ply: it stays readable after the coach moves, and shows
    // again when that position is viewed.
    this.log.add(this.game.moves.length, r);
    if (r.moment && this.record) {
      this.record.moments.push({ ...r.moment, ply: this.game.moves.length, text: r.text });
    }
    this.el['bubble-box'].classList.remove('stale');
    // While looking at the past, the new remark waits in the log (arrows too).
    if (!this.nav.viewing && !this.sideline) {
      this.board.setAutoShapes(remarkShapes(r));
    }
    this.renderBubble();
    this.save();
  }

  /** Routine game information, outside the coach's bubble. */
  private status(text: string): void {
    this.el.status.textContent = text;
  }

  /** True if the game moved on (new game, or more moves) since `ply`. */
  private stale(id: number, ply: number): boolean {
    return id !== this.gameId || this.game.moves.length !== ply;
  }

  /** `coachMove`: the coach's move just played, so it can think aloud about it. */
  private async startPlayerTurn(
    id: number,
    statusText = 'Your move.',
    coachMove?: { fenBefore: string; uci: string; lastMove?: { san: string; to: Square } },
  ): Promise<void> {
    this.status(statusText);
    const ply = this.game.moves.length;
    const coach = await this.coach;
    const narration = coachMove
      ? await coach.onCoachMove(coachMove.fenBefore, coachMove.uci, ply, coachMove.lastMove)
      : undefined;
    const remark = joinRemarks(narration, await coach.onPlayerTurn(this.game.fen, ply));
    if (!this.stale(id, ply) && remark) {
      this.say(remark);
      if (remark.offerSideline && this.mode.prompts) this.signalOpportunity();
      if (remark.offerSideline && this.mode.prompts && this.mode.sidelines) this.offerSideline();
    }
  }

  /**
   * A tactic is available: it does not stop the player like a mistake does, but it must not be missed. The coach
   * perks up with a green pop, the board's edge pulses twice, and the bubble keeps a green edge until the next move
   * (that edge is also the signal for people who turn motion off).
   */
  private signalOpportunity(): void {
    this.setMood('pleased', 'opportunity');
    const area = this.el['board-area'];
    area.classList.remove('opportunity');
    void area.offsetWidth; // restart the animation
    area.classList.add('opportunity');
    this.el['bubble-box'].classList.add('opportunity');
  }

  private clearOpportunity(): void {
    this.el['board-area'].classList.remove('opportunity');
    this.el['bubble-box'].classList.remove('opportunity');
  }

  private async onPlayerMove(from: Square, to: Square): Promise<void> {
    if (this.sideline) return this.onSidelineMove(from, to);
    if (this.reviewing) return this.sidelineFromReview(from, to);
    if (this.puzzling) return this.onPuzzleMove(from, to);
    if (this.lesson) return this.onLessonMove(from, to);
    this.clearOpportunity();
    const id = this.gameId;
    let promotion = '';
    if (this.game.isPromotion(from, to)) {
      promotion = await this.askPromotion(this.game.playerColor);
      if (id !== this.gameId) return;
    }
    this.el.choices.hidden = true;
    this.stopDemo();
    const fenBefore = this.game.fen;
    const move = this.game.play(from + to + promotion);
    const ply = this.game.moves.length;
    this.board.setAutoShapes([]);
    this.el['bubble-box'].classList.add('stale');
    this.sync();
    if (this.checkGameOver()) return;

    this.thinking = true;
    this.sync();
    this.status('Thinking…');

    // The coach judges the move while the opponent already picks a reply.
    const coach = await this.coach;
    const reply = this.opponent.then((o) => o.chooseMove(this.game));
    const remark = await coach.onPlayerMove(fenBefore, move.uci, ply);
    if (this.stale(id, ply)) return;

    if (remark) {
      this.say(remark);
      let choice: 'takeback' | 'play-on' | 'show' = 'play-on';
      const moment = remark.moment ? this.record?.moments.at(-1) : undefined;
      this.react(remark, fenBefore, moment);
      if (remark.offerTakeback && this.mode.takebacks) {
        choice = await this.askTakeback();
        // "Show me": the coach plays its answer in a sideline; afterwards the choice is offered again.
        while (choice === 'show') {
          if (moment) moment.showedMe = true;
          // From the position before the move, with its universes: what happens now, and what the engine wanted.
          if (moment) {
            await this.openSideline(moment.fen, 'This is the position before your move. The gray line is what happened; the arrows are the moves worth a look. Play any move to try it. Nothing here changes your game; tap Back to game when you are ready.', this.game.moves.length - 1, momentUniverses(moment));
          } else {
            await this.openSideline(this.game.fen, 'Here are the moves I could play. Tap one to see it. Nothing here changes your game; tap Back to game when you are ready.');
          }
          if (this.stale(id, ply)) return;
          choice = await this.askTakeback();
        }
        if (moment) moment.outcome = choice === 'takeback' ? 'taken-back' : 'played-on';
      } else if (!this.demo?.running) {
        this.stopDemo();
      }
      if (choice === 'takeback') {
        if (this.stale(id, ply)) return;
        this.noteTakeback(ply, move.san);
        this.game.takeback();
        this.log.truncate(this.game.moves.length);
        this.pruneSidelines();
        this.thinking = false;
        this.board.setAutoShapes([]);
        this.sync();
        this.status('Your move. Try another one.');
        void coach.prepare(this.game.fen);
        return;
      }
      if (this.stale(id, ply)) return;
    }
    await this.opponentMove(id, reply);
  }

  private async opponentMove(id: number, reply?: Promise<string>): Promise<void> {
    this.thinking = true;
    this.sync();
    this.status('Thinking…');

    const opponent = await this.opponent;
    const [uci] = await Promise.all([reply ?? opponent.chooseMove(this.game), sleep(MIN_THINK_MS)]);
    if (id !== this.gameId) return; // a new game started meanwhile

    const fenBefore = this.game.fen;
    const prev = this.game.lastMove;
    const lastMove = prev && prev.color === this.game.playerColor ? { san: prev.san, to: prev.to } : undefined;
    const move = this.game.play(uci);
    this.thinking = false;
    this.board.setAutoShapes([]);
    this.el['bubble-box'].classList.add('stale');
    this.sync();
    if (this.checkGameOver()) return;
    await this.startPlayerTurn(id, `I played ${move.san}.${this.game.inCheck ? ' Check!' : ''} Your move.`, {
      fenBefore,
      uci,
      lastMove,
    });
  }

  private checkGameOver(): boolean {
    const r = this.game.result;
    if (!r.over) return false;
    if (r.winner === this.game.playerColor) this.say({ kind: 'praise', text: 'Well played! Checkmate, you win.', mood: 'pleased', cue: 'win' });
    else if (r.winner) {
      const next = this.mode.takebacks ? 'Take back to see what happened, or start a new game.' : 'Start a new game when you’re ready.';
      this.say({ kind: 'phase', text: `Checkmate, I win this one. ${next}`, mood: 'concerned', cue: 'loss' });
    }
    else this.say({ kind: 'phase', text: `It's a draw by ${r.reason}.`, mood: 'neutral', cue: 'draw' });
    // What the game's moments and takebacks add up to (task 1.12b).
    const summary = this.record ? gameSummary(this.record) : '';
    if (summary) this.say({ kind: 'phase', text: `This game: ${summary}`, mood: 'neutral' });
    this.status('Game over.');
    this.thinking = false;
    this.sync();
    return true;
  }

  /** After a takeback: sidelines from positions that no longer exist are dropped. */
  private pruneSidelines(): void {
    if (this.record) this.record.sidelines = this.record.sidelines.filter((x) => x.ply <= this.game.moves.length);
  }

  /**
   * Records a takeback with the game (task 1.12b): the move, and the moment the coach had flagged on it,
   * whose outcome becomes "taken back" (also when the player first played on and changed their mind).
   */
  private noteTakeback(ply: number, san: string): void {
    const r = this.record;
    if (!r) return;
    const moment = r.moments.findLast((m) => m.ply === ply && (m.kind === 'mistake' || m.kind === 'missed-tactic'));
    if (moment) moment.outcome = 'taken-back';
    (r.takebacks ??= []).push({ ply, san, flagged: !!moment, concept: moment?.concept });
  }

  private async takeback(): Promise<void> {
    if (this.sideline || this.thinking || this.nav.viewing || !this.mode.takebacks) return;
    const taken = this.game.moves;
    const idx = taken.findLastIndex((m) => m.color === this.game.playerColor);
    if (idx >= 0) this.noteTakeback(idx + 1, taken[idx].san);
    if (!this.game.takeback()) return;
    this.log.truncate(this.game.moves.length);
    this.pruneSidelines();
    this.board.setAutoShapes([]);
    this.sync();
    this.say({ kind: 'phase', text: 'Sure, take it back. Try another move.', mood: 'neutral' });
    this.status('Your move.');
    const coach = await this.coach;
    void coach.prepare(this.game.fen);
  }

  private async hint(): Promise<void> {
    if (this.nav.viewing || this.sideline) return;
    if (this.puzzling) return this.puzzleHint();
    if (this.lesson) return this.lessonHint();
    const id = this.gameId;
    const ply = this.game.moves.length;
    const coach = await this.coach;
    const remark = await coach.hint();
    if (this.record) this.record.hintsUsed++;
    if (!this.stale(id, ply)) this.say(remark);
  }

  // --- Review: a saved game, moment by moment -------------------------------
  // The saved game is laid out on the same board with the same move list,
  // navigation and "Try a sideline" as a live game, but nothing can be played
  // in it. At each moment the coach shows the position before the player's move
  // and asks what they were thinking; "What happened?" shows the position after
  // and what was saved then (the coach's words and arrows). Sidelines tried here
  // are kept with the game (PGN variations at that move).

  private async openReview(saved: SavedGame): Promise<void> {
    let game: Game;
    try {
      game = new Game(saved.playerColor, saved.startFen);
      for (const uci of saved.moves) game.play(uci);
    } catch {
      this.status('That game could not be opened.');
      return;
    }
    this.save(); // the game in progress stays as it is, to come back to
    this.parkPuzzle();
    this.endLesson();
    ++this.gameId; // drops whatever the live game was waiting for
    this.puzzling = undefined;
    this.thinking = false;
    this.sideline = undefined;
    this.sidelineToken++;
    this.sidelineBusy = false;
    this.onSidelineClosed?.();
    this.onSidelineClosed = undefined;
    const moments = sortedMoments(saved);
    const im = saved.imported;
    const opponent = im ? (saved.playerColor === 'white' ? im.black : im.white) : undefined;
    this.game = game;
    this.mode = REVIEW;
    this.record = saved;
    this.reviewing = { moments, index: -1, opponent, curve: saved.curve, say: { ply: 0, text: this.reviewIntroOf(saved, moments.length), offerAnswer: false } };
    const level = levelInfo(saved.level);
    // A game played against a coach is reviewed by that coach; an imported game by the current tier's coach.
    void this.showCoach(saved.imported ? levelInfo(this.settings.level) : level);
    // The coach's face is the game's (above); what it checks in Review and its sidelines is always full depth.
    this.coach = Promise.all([this.analyst, this.book]).then(([a, book]) => new Coach(a, reviewCoachLevel(level), saved.playerColor === 'white' ? 'w' : 'b', REVIEW, book));
    this.nav.reset(game.moves.length);
    this.nav.start();
    this.log.clear();
    for (const e of saved.remarks) this.log.add(e.ply, e.remark);
    this.viewShapes = false;
    this.board.set({ orientation: saved.playerColor, lastMove: undefined });
    this.board.setAutoShapes([]);
    this.el.choices.hidden = true;
    this.stopDemo();
    this.status('Reviewing a saved game.');
    this.sync();
    // Review looks at the whole game once, both sides, every pattern (task 1.7e); older records get it now.
    if (!saved.curve || saved.reviewVersion !== REVIEW_VERSION) void this.analyseForReview(saved);
  }

  /** The coach's first words in Review: the opponent, one line per side on how they played, the moments. */
  private reviewIntroOf(saved: SavedGame, total: number): string {
    const stats = needsAnalysis(saved) ? undefined : gameStats(saved.curve, saved.startFen, saved.labels);
    const them = this.opponentName(saved);
    const mine = saved.playerColor;
    const theirs = mine === 'white' ? 'black' : 'white';
    const perf = stats ? `${performanceLine('You', stats[mine])} ${performanceLine(them, stats[theirs], false)}` : '';
    return reviewIntro(total, them, perf);
  }

  /** Looks at the whole game with the engine and replaces the saved moments with what Review finds. */
  private async analyseForReview(saved: SavedGame): Promise<void> {
    const r = this.reviewing;
    if (!r || !saved.moves.length) return;
    const abort = (r.abort = new AbortController());
    r.analysing = { done: 0, total: saved.moves.length };
    r.say = { ply: 0, text: 'Let me look through the whole game first, both sides. This takes a few seconds.', offerAnswer: false };
    this.status('Looking at the game…');
    this.sync();
    try {
      const [analyst, book] = await Promise.all([this.analyst, this.book]);
      const result = await reviewGame(
        analyst,
        { startFen: saved.startFen, moves: saved.moves, playerColor: saved.playerColor, opponent: r.opponent },
        {
          book,
          signal: abort.signal,
          onProgress: (done, total) => {
            if (this.reviewing !== r) return;
            r.analysing = { done, total };
            this.renderReviewBar();
          },
        },
      );
      if (!result || this.reviewing !== r) return;
      mergeAnalysis(saved, result);
      this.store.save(saved);
      r.moments = sortedMoments(saved);
      r.index = -1;
      r.curve = saved.curve;
      this.log.clear();
      for (const e of saved.remarks) this.log.add(e.ply, e.remark);
      r.say = { ply: 0, text: this.reviewIntroOf(saved, r.moments.length), offerAnswer: false };
      this.status('Reviewing a saved game.');
    } catch (e) {
      console.error(e);
      if (this.reviewing === r) r.say = { ply: 0, text: 'I could not look through this game. You can still step through it and try sidelines.', offerAnswer: false };
    } finally {
      if (this.reviewing === r) {
        r.analysing = undefined;
        r.abort = undefined;
        this.sync();
      }
    }
  }

  /** Back to the game that was in progress (or a new one). */
  private async exitReview(): Promise<void> {
    this.reviewing?.abort?.abort();
    if (this.sideline) this.exitSideline();
    const current = this.store.current();
    await this.newGame(current && current.moves.length ? current : undefined);
  }

  /** The coach has asked its question at this position and the answer is not shown yet. */
  private asking(): boolean {
    const say = this.reviewing?.say;
    return !!say?.offerAnswer && say.ply === this.nav.ply;
  }

  /**
   * The timeline's moments as pin callouts: a small dot on the curve where the move left the evaluation, and the
   * badge on a stem in a band above the graph, so the curve's height stays readable. Pins side by side sit at
   * different heights (`pinRows`); the band is as tall as the rows used. A badge opens that moment, question first.
   */
  private renderDots(r: { moments: SavedMoment[]; index: number }, busy: boolean): void {
    const box = this.el['review-dots'];
    const plot = box.parentElement!;
    const curve = this.reviewing?.curve;
    box.hidden = !r.moments.length || !curve || curve.length < 2;
    if (box.hidden || !curve) {
      plot.style.setProperty('--band', '0px');
      box.replaceChildren();
      return;
    }
    const scale = timelineScale(curve);
    const width = box.clientWidth || 300;
    const xs = r.moments.map((m) => scale.x(m.ply) / TIMELINE_W);
    const rows = pinRows(xs.map((f) => f * width), PIN_GAP, PIN_ROWS);
    const used = Math.max(0, ...rows) + 1;
    const band = used * PIN_ROW + 8;
    plot.style.setProperty('--band', `${band}px`);
    const labels = moveLabels(this.record!);
    const parts: HTMLElement[] = [];
    r.moments.forEach((m, i) => {
      const dot = momentDot(m);
      const tag = this.record?.labels?.[m.ply - 1];
      const colour = tag ? LABEL_INFO[tag].colour : undefined;
      const left = `${xs[i] * 100}%`;
      // Where the move left the evaluation, inside the graph under the band.
      const pointTop = `calc(${band}px + (100% - ${band}px) * ${(scale.y(curve[m.ply] ?? 0) / TIMELINE_H).toFixed(4)})`;
      const pinY = band - 8 - PIN_ROW / 2 - rows[i] * PIN_ROW;
      const stem = document.createElement('span');
      stem.className = `pin-stem ${dot.tone}${i === r.index ? ' current' : ''}`;
      stem.style.left = left;
      stem.style.top = `${pinY}px`;
      stem.style.height = `calc(${pointTop} - ${pinY}px)`;
      if (colour) stem.style.setProperty('--c', colour);
      const point = document.createElement('span');
      point.className = `pin-point ${dot.tone}`;
      point.style.left = left;
      point.style.top = pointTop;
      if (colour) point.style.setProperty('--c', colour);
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `dot ${dot.tone}${i === r.index ? ' current' : ''}`;
      // The move's label when the analysis has one: the same mark as in the move list and on the board.
      b.textContent = tag ? LABEL_INFO[tag].glyph : dot.glyph;
      if (colour) b.style.setProperty(dot.tone === 'theirs' ? 'border-color' : 'background', colour);
      b.style.left = left;
      b.style.top = `${pinY}px`;
      b.disabled = busy;
      const label = labels[m.ply - 1];
      b.setAttribute('aria-label', `Moment ${i + 1} of ${r.moments.length}: ${kindLabel(m)}, ${label}`);
      b.title = `${label} · ${kindLabel(m)}`;
      if (i === r.index) b.setAttribute('aria-current', 'true');
      b.addEventListener('click', () => this.gotoMoment(i));
      parts.push(stem, point, b);
    });
    // Badges last, so a stem never covers one.
    box.replaceChildren(...parts.filter((p) => p.tagName !== 'BUTTON'), ...parts.filter((p) => p.tagName === 'BUTTON'));
  }

  /** Goes to a moment: the position before the move, with the question. */
  private gotoMoment(index: number): void {
    const r = this.reviewing;
    if (!r || this.sideline || !r.moments.length) return;
    r.index = Math.min(Math.max(index, 0), r.moments.length - 1);
    const m = r.moments[r.index];
    r.say = { ply: m.ply - 1, text: reviewPrompt(this.record!, m), offerAnswer: true };
    this.navigate(() => this.nav.goTo(m.ply - 1));
  }

  /** "What happened?": the position after the move, with what the coach said then. */
  private revealMoment(): void {
    const r = this.reviewing;
    if (!r) return;
    r.say = undefined;
    const m = r.moments[r.index];
    this.navigate(() => this.nav.goTo(m.ply));
  }

  private renderReviewBar(): void {
    const r = this.reviewing;
    const bar = this.el['review-bar'];
    bar.hidden = !r || !!this.sideline;
    const box = this.el.choices;
    if (!r) return;
    const m = r.moments[r.index];
    const revealed = !!m && !r.say && this.nav.ply === m.ply;
    // The moment on the board, however the player got there (Next moment, a dot, or stepping with the arrows).
    const here = m?.ply === this.nav.ply ? m : r.moments.find((x) => x.ply === this.nav.ply);
    const busy = r.analysing;
    this.el['review-text'].textContent = busy
      ? `Looking at the game… move ${busy.done} of ${busy.total}`
      : reviewBarText(r.index, r.moments.length, revealed, m);
    this.renderDots(r, !!busy);
    (this.el['review-next'] as HTMLButtonElement).disabled = !!busy || r.index >= r.moments.length - 1;
    this.renderStrip();
    if (busy) {
      box.hidden = true;
    } else if (this.asking() && !this.sideline) {
      box.innerHTML = '<button data-choice="answer" class="primary">What happened?</button>';
      box.hidden = false;
      box.onclick = (e) => {
        if ((e.target as HTMLElement).closest('button')) this.revealMoment();
      };
    } else if (here && !r.say && !this.sideline) {
      // The drill: after the answer, open the line in a sideline, or try the position yourself.
      box.innerHTML = `${here.line?.length || here.answer?.length ? '<button data-choice="line" class="primary">Show line</button>' : ''}<button data-choice="try">Try it yourself</button>`;
      box.hidden = false;
      box.onclick = (e) => {
        const choice = (e.target as HTMLElement).closest('button')?.dataset.choice;
        if (choice === 'line') void this.showMomentLine(here);
        else if (choice === 'try') void this.openSideline(here.fen, 'Try your idea from here. Tap Show engine moves if you want to see what the engine would play. Nothing here changes your game.', here.ply - 1, [], true);
      };
    } else if (!this.sideline) {
      box.hidden = true;
    }
  }

  /**
   * The evaluation through the game (White's view; tap to jump to a move) with the moments sitting on the line.
   * The scale fits this game's own swings (never tighter than ±3 pawns), so they stand out.
   */
  private renderStrip(): void {
    const r = this.reviewing;
    const strip = this.el['review-strip'] as unknown as SVGElement;
    const curve = r?.curve;
    this.el['review-timeline'].hidden = !r || !curve || curve.length < 2;
    if (!r || !curve || curve.length < 2) return;
    const { x, y } = timelineScale(curve);
    const W = TIMELINE_W;
    const H = TIMELINE_H;
    const points = curve.map((cp, i) => `${x(i).toFixed(1)},${y(cp).toFixed(1)}`).join(' ');
    const mid = `<line x1="0" y1="${H / 2}" x2="${W}" y2="${H / 2}" class="strip-mid"/>`;
    const area = `<polygon points="0,${H / 2} ${points} ${W},${H / 2}" class="strip-area"/>`;
    const line = `<polyline points="${points}" class="strip-line"/>`;
    const here = `<line x1="${x(this.nav.ply).toFixed(1)}" y1="0" x2="${x(this.nav.ply).toFixed(1)}" y2="${H}" class="strip-here"/>`;
    strip.innerHTML = mid + area + line + here;
    strip.onclick = (e) => {
      if (this.sideline) return;
      const box = strip.getBoundingClientRect();
      const ply = Math.round(((e.clientX - box.left) / box.width) * (curve.length - 1));
      this.navigate(() => this.nav.goTo(Math.max(0, Math.min(curve.length - 1, ply))));
    };
  }

  /** "Show the line": a sideline from the position before the moment, with the engine's better line played out. */
  private async showMomentLine(m: SavedMoment): Promise<void> {
    if ((!m.line?.length && !m.answer?.length) || this.sideline) return;
    const fresh = m.kind === 'mistake' || m.kind === 'missed-tactic' ? 'Here is the line the engine preferred.' : 'Here is the line.';
    await this.openSideline(m.fen, `${fresh} Gray is what was played in the game. Tap along the other moves to see what the engine wanted. Nothing here changes your game.`, m.ply - 1, momentUniverses(m));
  }

  // --- Saved games: history, PGN and backup ------------------------------

  private openHistory(): void {
    this.save(); // the game in progress shows up with its latest moves
    this.renderHistory();
    this.el['history-note'].textContent = 'Pick a game to review it with the coach. Saved on this device only; back up to move them elsewhere.';
    (this.el.history as HTMLDialogElement).show();
    void this.analyseHistory();
  }

  /**
   * Analyses, one at a time in a worker of its own, the listed games that have no current analysis, so
   * every card gets its graph and accuracy. Stops when the screen closes; what finished is kept.
   */
  private async analyseHistory(): Promise<void> {
    if (this.historyJob) return;
    const abort = (this.historyJob = new AbortController());
    const failed = new Set<string>();
    let analyst: Analyst | undefined;
    try {
      const book = await this.book;
      while (!abort.signal.aborted) {
        const g = reviewableGames(this.store.list()).find((x) => needsAnalysis(x) && !failed.has(x.id));
        if (!g) break;
        analyst ??= await Analyst.create();
        if (abort.signal.aborted) break;
        this.historyProgress = { id: g.id, done: 0, total: g.moves.length };
        this.renderCardGraph(g);
        const opponent = g.imported ? (g.playerColor === 'white' ? g.imported.black : g.imported.white) : undefined;
        let result;
        try {
          result = await reviewGame(analyst, { startFen: g.startFen, moves: g.moves, playerColor: g.playerColor, opponent }, {
            book,
            signal: abort.signal,
            onProgress: (done, total) => {
              this.historyProgress = { id: g.id, done, total };
              this.renderCardGraph(g);
            },
          });
        } catch (e) {
          console.error(e);
          failed.add(g.id); // a record the engine can't read is skipped, the rest go on
          continue;
        }
        if (!result) break;
        const fresh = this.store.get(g.id);
        if (!fresh) continue; // deleted meanwhile
        mergeAnalysis(fresh, result);
        // Saving would move it to the front of the store's order; the list is by date, so that is fine.
        this.store.save(fresh);
        if (fresh.id === this.record?.id) this.record = fresh;
        this.historyProgress = undefined;
        this.renderHistory(); // the card's moment count changes too
      }
    } catch (e) {
      console.error(e);
    } finally {
      analyst?.terminate();
      if (this.historyJob === abort) {
        this.historyJob = undefined;
        this.historyProgress = undefined;
      }
    }
  }

  private renderHistory(): void {
    const all = this.store.list();
    const games = reviewableGames(all);
    const list = this.el['history-list'];
    // A card's open "more" panel stays open when the list is drawn again (the background analysis redraws it).
    const opened = new Set([...list.querySelectorAll<HTMLElement>('li')].filter((li) => li.querySelector<HTMLElement>('.history-buttons')?.hidden === false).map((li) => li.dataset.id));
    list.replaceChildren();
    if (!games.length) {
      const li = document.createElement('li');
      li.className = 'history-empty';
      li.textContent = all.length
        ? 'No finished games yet. Finish a game with the coach, or import your games from Chess.com or Lichess, and they show up here to review.'
        : 'No games yet. Play a game with the coach, or import your games from Chess.com or Lichess, and they show up here to review.';
      list.append(li);
      return;
    }
    for (const g of games) {
      const li = document.createElement('li');
      li.dataset.id = g.id;
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'h-card';
      card.dataset.action = 'review';
      const main = document.createElement('div');
      main.className = 'h-main';
      const title = document.createElement('span');
      title.className = 'h-title';
      const chip = document.createElement('span');
      chip.className = 'chip';
      const meta = document.createElement('p');
      meta.className = 'h-meta';
      const date = new Date(g.startedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
      const moments = g.moments.length ? ` · ${g.moments.length} moment${g.moments.length === 1 ? '' : 's'}` : '';
      const takebacks = g.takebacks?.length ? ` · ${g.takebacks.length} takeback${g.takebacks.length === 1 ? '' : 's'}` : '';
      const moveCount = `${Math.ceil(g.moves.length / 2)} move${g.moves.length > 2 ? 's' : ''}${g.opening ? ` (${g.opening.name})` : ''}`;
      const side = g.playerColor === 'white' ? 'White' : 'Black';
      const won = g.result!.winner === g.playerColor;
      const result = !g.result!.winner ? 'draw' : won ? 'you won' : g.imported ? 'you lost' : 'coach won';
      chip.textContent = result;
      chip.classList.toggle('win', !!g.result!.winner && won);
      chip.classList.toggle('loss', !!g.result!.winner && !won);
      title.textContent = `${date} · ${side} vs ${this.opponentName(g)}`;
      meta.textContent = `${g.imported ? '' : `${modeInfo(g.mode).name} · `}${moveCount}${moments}${takebacks}`;
      const graph = document.createElement('div');
      graph.className = 'h-graph';
      const buttons = document.createElement('div');
      buttons.className = 'history-buttons';
      buttons.hidden = !opened.has(g.id);
      for (const [action, label] of [['copy', 'Copy PGN'], ['download', 'Download PGN'], ['delete', 'Delete']] as const) {
        const b = document.createElement('button');
        b.dataset.action = action;
        b.textContent = label;
        // The card itself opens the review; these are quiet, and Delete says what it does.
        b.className = action === 'delete' ? 'ghost danger' : 'ghost';
        buttons.append(b);
      }
      const more = document.createElement('button');
      more.type = 'button';
      more.className = 'ghost h-more';
      more.dataset.action = 'more';
      more.textContent = '⋯';
      more.setAttribute('aria-label', 'More: copy, download or delete this game');
      more.setAttribute('aria-expanded', String(!buttons.hidden));
      const tag = document.createElement('span');
      tag.className = 'h-source';
      tag.textContent = g.imported ? { pgn: 'Pasted', 'chess.com': 'Chess.com', lichess: 'Lichess' }[g.imported.source] : `With ${levelInfo(g.level).coach.name}`;
      main.append(title, chip);
      card.append(main, graph, meta, tag);
      const row = document.createElement('div');
      row.className = 'h-row';
      row.append(card, more);
      li.append(row, buttons);
      list.append(li);
      this.renderCardGraph(g);
    }
  }

  /** The other side's name on a card: the imported game's player, or the coach the game was played against. */
  private opponentName(g: SavedGame): string {
    if (g.imported) return (g.playerColor === 'white' ? g.imported.black : g.imported.white) || 'opponent';
    return levelInfo(g.level).coach.name;
  }

  /**
   * A card's picture of the game: the evaluation through it (White above the line) with the player's moments
   * on it, and each side's accuracy with its blunders and mistakes. Before the analysis: where it stands.
   */
  private renderCardGraph(g: SavedGame): void {
    const box = this.el['history-list'].querySelector<HTMLElement>(`li[data-id="${CSS.escape(g.id)}"] .h-graph`);
    if (!box) return;
    const p = this.historyProgress?.id === g.id ? this.historyProgress : undefined;
    const stats = needsAnalysis(g) ? undefined : gameStats(g.curve, g.startFen, g.labels);
    if (!stats || !g.curve) {
      box.className = 'h-graph pending';
      const pct = p && p.total ? Math.round((p.done / p.total) * 100) : 0;
      box.innerHTML = `<div class="h-bar"><span style="width:${pct}%"></span></div><span class="h-wait">${p ? `The coach is looking at this game… ${pct}%` : 'Waiting for the coach to look at it'}</span>`;
      return;
    }
    box.className = 'h-graph';
    const curve = g.curve;
    const W = 300;
    const H = 56;
    const most = Math.max(300, ...curve.map(Math.abs));
    const x = (ply: number) => (ply / (curve.length - 1)) * W;
    const y = (cp: number) => H / 2 - (cp / most) * (H / 2 - 3);
    const pts = curve.map((cp, i) => `${x(i).toFixed(1)},${y(cp).toFixed(1)}`).join(' ');
    const dots = sortedMoments(g)
      .map((m) => {
        const label = g.labels?.[m.ply - 1];
        const fill = label ? ` style="fill:${LABEL_INFO[label].colour}"` : '';
        return `<circle cx="${x(m.ply).toFixed(1)}" cy="${y(curve[m.ply] ?? 0).toFixed(1)}" r="3.2" class="g-dot ${momentDot(m).tone}"${fill}/>`;
      })
      .join('');
    // White's share is the light area above the middle, Black's the dark one below.
    const svg = `<svg class="h-eval" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
      <rect x="0" y="0" width="${W}" height="${H}" class="g-black"/>
      <polygon points="0,${H} ${pts} ${W},${H}" class="g-white"/>
      <line x1="0" y1="${H / 2}" x2="${W}" y2="${H / 2}" class="g-mid"/>
      <polyline points="${pts}" class="g-line"/>${dots}</svg>`;
    const mine = g.playerColor;
    // Each side on one line: who, the important labels as marks with a count (words only in the tooltip), accuracy.
    const side = (who: string, color: 'white' | 'black', st: SideStats) => {
      const chips = HEADLINE.filter((l) => st.counts[l])
        .map((l) => {
          const n = st.counts[l]!;
          const words = `${n} ${n === 1 ? LABEL_INFO[l].name : LABEL_INFO[l].plural}`;
          return `<span class="g-chip" style="--c:${LABEL_INFO[l].colour}" title="${words}" aria-label="${words}"><b>${LABEL_INFO[l].glyph}</b>${n}</span>`;
        })
        .join('');
      return `<div class="g-side ${color}"><span class="g-who"><i class="g-swatch ${color}"></i>${escapeHtml(who)}</span><span class="g-marks">${chips}</span><b class="g-acc">${st.accuracy}%</b></div>`;
    };
    const you = side('You', mine, stats[mine]);
    const them = side(this.opponentName(g), mine === 'white' ? 'black' : 'white', stats[mine === 'white' ? 'black' : 'white']);
    box.innerHTML = `${svg}<div class="g-sides" aria-label="Accuracy: you ${stats[mine].accuracy}%, ${escapeHtml(this.opponentName(g))} ${stats[mine === 'white' ? 'black' : 'white'].accuracy}%">${you}${them}</div>`;
  }

  private onHistoryClick(e: MouseEvent): void {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-action]');
    const id = btn?.closest<HTMLElement>('li')?.dataset.id;
    const game = id ? this.store.get(id) : undefined;
    if (!btn || !game) return;
    const note = this.el['history-note'];
    if (btn.dataset.action === 'review') {
      (this.el.history as HTMLDialogElement).close();
      void this.openReview(game);
    } else if (btn.dataset.action === 'more') {
      const panel = btn.closest('li')!.querySelector<HTMLElement>('.history-buttons')!;
      panel.hidden = !panel.hidden;
      btn.setAttribute('aria-expanded', String(!panel.hidden));
    } else if (btn.dataset.action === 'copy') {
      navigator.clipboard
        .writeText(gameToPgn(game))
        .then(() => (note.textContent = 'PGN copied.'))
        .catch(() => (note.textContent = 'Could not copy here. Use Download PGN instead.'));
    } else if (btn.dataset.action === 'download') {
      this.download(gameToPgn(game), `sideline-${new Date(game.startedAt).toISOString().slice(0, 10)}-${game.id}.pgn`, 'application/x-chess-pgn');
      note.textContent = 'PGN downloaded.';
    } else if (btn.dataset.action === 'delete') {
      // Two taps, so a stray tap doesn't lose a game.
      if (btn.dataset.sure !== '1') {
        btn.dataset.sure = '1';
        btn.textContent = 'Tap again to delete';
        return;
      }
      this.store.delete(game.id);
      if (game.id === this.record?.id) this.record = undefined; // the running game is no longer saved
      this.renderHistory();
      note.textContent = 'Deleted.';
    }
  }

  private download(text: string, name: string, type: string): void {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  private backup(): void {
    this.save();
    const data = { ...this.store.exportAll(), puzzles: this.puzzleResults.all(), puzzleLevels: this.puzzleResults.allLevels(), openings: this.openingProgress.all(), practice: this.deck.all() };
    this.download(JSON.stringify(data), `sideline-backup-${new Date().toISOString().slice(0, 10)}.json`, 'application/json');
    this.el['history-note'].textContent = `Backed up ${data.games.length} game${data.games.length === 1 ? '' : 's'} and ${data.puzzles.length} puzzle result${data.puzzles.length === 1 ? '' : 's'} to a file.`;
  }

  private async restore(): Promise<void> {
    const input = this.el['restore-file'] as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    const note = this.el['history-note'];
    try {
      const data = JSON.parse(await file.text());
      const result = this.store.importAll(data);
      const puzzles = result ? this.puzzleResults.importAll(data.puzzles) : 0;
      if (result) this.puzzleResults.importLevels(data.puzzleLevels);
      if (result) this.openingProgress.importAll(data.openings);
      if (result) this.deck.importAll(data.practice);
      note.textContent = result ? `Restored ${result.added} game${result.added === 1 ? '' : 's'}${puzzles ? ` and ${puzzles} puzzle result${puzzles === 1 ? '' : 's'}` : ''}; ${result.skipped} skipped (already here or unreadable).` : 'That file is not a Sideline backup.';
    } catch {
      note.textContent = 'That file could not be read.';
    }
    this.renderHistory();
  }

  // --- Puzzles (task 3.2) ----------------------------------------------------
  // A coach's set is a filter over the pool (its themes at its band). A puzzle is played on the game screen:
  // the opponent's first move is played, the coach asks what it wants, and the player's moves are checked
  // against the solution (another mate counts; a move the engine calls just as good means "try again"). A wrong
  // move plays its refutation as a ghost line, then Try again / Explore. The game in progress waits in storage.

  /**
   * The Puzzles tab (task 3.2b): the six coaches' faces in a row (yours marked), and the chosen coach large, with
   * a line, their themes as tiles with a mastery bar (clean solves toward 10) and your level, and Start for a mix.
   */
  private renderPuzzlesScreen(): void {
    const box = this.el['puzzles-list'];
    const mine = this.settings.level;
    const chosen = levelInfo(this.puzzlePick || mine);
    const face = coachFace;

    const picker = document.createElement('div');
    picker.className = 'p-picker';
    picker.setAttribute('role', 'group');
    picker.setAttribute('aria-label', 'Coaches');
    for (const l of LEVELS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'p-pick';
      b.dataset.pick = String(l.level);
      b.setAttribute('aria-pressed', String(l.level === chosen.level));
      b.setAttribute('aria-label', `${l.coach.name}, about ${l.shownRating}${l.level === mine ? ', your coach' : ''}`);
      const name = document.createElement('span');
      name.className = 'p-pick-name';
      setCoachName(name, l, l.level === mine ? ' ★' : '');
      b.append(face(l, 'sm'), name);
      picker.append(b);
    }

    const focus = document.createElement('section');
    focus.className = 'p-focus';
    void fetchTheme(chosen.theme).then((t) => {
      focus.style.setProperty('--p-accent', t.theme.coach.accent);
      focus.style.setProperty('--p-soft', t.theme.coach.accentSoft ?? t.theme.coach.accent);
    }).catch(() => undefined);
    const hero = document.createElement('div');
    hero.className = 'p-hero';
    const who = document.createElement('div');
    const title = document.createElement('h3');
    title.textContent = `${chosen.coach.name} · about ${chosen.shownRating}`;
    const say = document.createElement('p');
    say.className = 'p-say';
    const names = chosen.specialty.puzzleThemes.map((t) => themeName(t).toLowerCase());
    say.textContent = `My puzzles: ${listAnd(names)}. Tap one to practise it, or start a mix.`;
    who.append(title, say);
    hero.append(face(chosen, 'lg'), who);

    const mastery = this.puzzleResults.mastery(chosen.specialty.puzzleThemes);
    const levels = this.puzzleResults.allLevels();
    const start = startLevel(chosen.puzzleBand);
    const tiles = document.createElement('div');
    tiles.className = 'p-themes';
    for (const t of chosen.specialty.puzzleThemes) {
      const clean = mastery.get(t) ?? 0;
      const done = clean >= MASTERY_GOAL;
      const level = this.puzzleResults.levelOf(t, start);
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `p-tile${done ? ' mastered' : ''}`;
      b.dataset.level = String(chosen.level);
      b.dataset.theme = t;
      const name = document.createElement('span');
      name.className = 'p-name';
      name.textContent = themeName(t);
      const bar = document.createElement('span');
      bar.className = 'p-bar';
      bar.setAttribute('role', 'progressbar');
      bar.setAttribute('aria-valuemin', '0');
      bar.setAttribute('aria-valuemax', String(MASTERY_GOAL));
      bar.setAttribute('aria-valuenow', String(Math.min(clean, MASTERY_GOAL)));
      const fill = document.createElement('i');
      fill.style.width = `${(Math.min(clean, MASTERY_GOAL) / MASTERY_GOAL) * 100}%`;
      bar.append(fill);
      const meta = document.createElement('span');
      meta.className = 'p-meta';
      const tried = clean > 0 || t in levels;
      meta.textContent = done ? `Mastered ✓ · level ${level}` : tried ? `${clean} / ${MASTERY_GOAL} · level ${level}` : 'New';
      b.append(name, bar, meta);
      b.setAttribute('aria-label', `Practise ${themeName(t)}: ${meta.textContent}`);
      tiles.append(b);
    }
    const go = document.createElement('button');
    go.type = 'button';
    go.className = 'primary p-start';
    go.dataset.level = String(chosen.level);
    go.textContent = 'Start a mix';
    go.setAttribute('aria-label', `Start a mix of ${chosen.coach.name}'s puzzles`);
    focus.append(hero, tiles, go);
    const waiting = this.puzzling ?? this.parked?.session;
    const p = waiting?.run?.puzzle;
    if (waiting && p) {
      const cont = document.createElement('button');
      cont.type = 'button';
      cont.className = 'p-continue';
      cont.dataset.continue = '1';
      const what = waiting.current ? themeName(waiting.current) : 'Puzzle';
      cont.innerHTML = '<strong>Continue your puzzle</strong><span></span>';
      cont.lastElementChild!.textContent = `${what} · ${waiting.level.coach.name} · rated ${p.rating}`;
      box.replaceChildren(cont, picker, focus);
    } else box.replaceChildren(picker, focus);
  }

  /** Starts a puzzle session with a coach's set (or one theme of it). */
  private async openPuzzles(level: Level, theme?: string): Promise<void> {
    this.el['puzzles-note'].textContent = '';
    this.save(); // the game in progress stays as it is, to come back to
    this.endLesson();
    this.reviewing?.abort?.abort();
    this.reviewing = undefined;
    if (this.sideline) this.exitSideline();
    this.mode = PUZZLE;
    void this.showCoach(level);
    const session: PuzzleSession = { level, theme, played: new Map(), seen: new Set(), solvedCount: 0, line: [], attempt: { solved: false, misses: 0, hints: 0 }, hintStep: 0, phase: 'intro', recorded: false };
    const prev = this.puzzling;
    const old = prev ?? this.parked?.session;
    if (old) this.endTry(old);
    this.puzzling = session;
    if (!(await this.nextPuzzle())) {
      this.puzzling = prev;
      return;
    }
    this.parked = undefined;
    this.showScreen('play');
    this.railCurrent();
  }

  /**
   * The next puzzle: the session's theme (or, in a mix, the coach's theme played least; `theme` overrides it
   * once, for "Another fork?") near your level in that theme. Loads the band files around the level.
   */
  private async nextPuzzle(theme?: string): Promise<boolean> {
    const pz = this.puzzling;
    if (!pz) return false;
    const t = theme ?? pz.theme ?? pickTheme(pz.level.specialty.puzzleThemes, pz.played);
    const target = this.puzzleResults.levelOf(t, startLevel(pz.level.puzzleBand));
    let p: Puzzle | undefined;
    try {
      // Near the level first; wider when a rare theme has nothing there.
      for (const reach of [150, 400, 2000]) {
        const bands = bandsFor([target - reach, target + reach + 1]);
        const pool = (await Promise.all(bands.map((b) => loadBand(b)))).flat();
        p = choosePuzzle(pool.filter((x) => x.themes.includes(t)), (id) => this.puzzleResults.get(id), { target, exclude: pz.seen });
        if (p || bands.length === POOL_BANDS.length) break;
      }
    } catch (e) {
      console.error(e);
      this.el['puzzles-note'].textContent = 'The puzzles could not be loaded. Check your connection and try again.';
      if (pz === this.puzzling && pz.run) this.status('The next puzzle could not be loaded.');
      return false;
    }
    if (pz !== this.puzzling) return false;
    if (!p) {
      this.say({ kind: 'phase', text: 'That is every puzzle of this theme for now. Pick another one.', mood: 'neutral' });
      return false;
    }
    pz.current = t;
    pz.played.set(t, (pz.played.get(t) ?? 0) + 1);
    await this.startPuzzle(p);
    return true;
  }

  private async startPuzzle(p: Puzzle): Promise<void> {
    const pz = this.puzzling;
    if (!pz) return;
    const id = ++this.gameId;
    this.retryCleanup?.();
    const run = new PuzzleRun(p);
    Object.assign(pz, { run, line: [], attempt: { solved: false, misses: 0, hints: 0 }, hintStep: 0, phase: 'intro', recorded: false });
    pz.seen.add(p.id);
    this.thinking = true;
    this.game = new Game(run.solverColor, p.fen);
    this.record = undefined;
    this.coach = Promise.all([this.analyst, this.book]).then(([a, book]) => new Coach(a, pz.level, run.solverColor === 'white' ? 'w' : 'b', PUZZLE, book));
    this.nav.reset(0);
    this.log.clear();
    this.viewShapes = false;
    this.stopDemo();
    this.el.choices.hidden = true;
    this.board.set({ orientation: run.solverColor, lastMove: undefined });
    this.board.setAutoShapes([]);
    this.status('Their move…');
    this.sync();
    await sleep(700); // the position first, then their move
    if (id !== this.gameId) return;
    const first = this.game.play(run.firstMove);
    this.thinking = false;
    pz.phase = 'solving';
    this.sync();
    const side = run.solverColor === 'white' ? 'White' : 'Black';
    this.say({ kind: 'phase', text: `They played ${first.san}. What does that move want? Then find the best move for ${side}.`, mood: 'thinking' });
    this.status(`${side} to move.`);
    void (await this.coach).prepare(this.game.fen);
  }

  private async onPuzzleMove(from: Square, to: Square): Promise<void> {
    const pz = this.puzzling;
    const run = pz?.run;
    if (!pz || !run || pz.phase !== 'solving') return;
    const id = this.gameId;
    let promotion = '';
    if (this.game.isPromotion(from, to)) {
      promotion = await this.askPromotion(this.game.playerColor);
      if (id !== this.gameId) return;
    }
    const uci = from + to + promotion;
    const fenBefore = this.game.fen;
    const kind = run.check(uci);
    this.stopDemo();
    this.el.choices.hidden = true;
    const move = this.game.play(uci);
    const ply = this.game.moves.length;
    this.board.setAutoShapes([]);
    this.el['bubble-box'].classList.add('stale');
    this.sync();

    if (kind !== 'other') {
      pz.line.push(uci);
      const reply = run.advance(kind);
      if (run.solved) return this.puzzleSolved();
      this.thinking = true;
      this.setMood('pleased');
      this.status('Right! Their reply…');
      this.sync();
      await sleep(MIN_THINK_MS);
      if (this.stale(id, ply) || !reply) return;
      const r = this.game.play(reply);
      pz.line.push(reply);
      pz.hintStep = 0;
      this.thinking = false;
      this.sync();
      this.say({ kind: 'phase', text: `Right. They answered ${r.san}. Keep going.`, mood: 'pleased' });
      this.status('Your move.');
      return;
    }

    // Not the solution: the engine decides whether it also holds up or is a wrong move.
    this.thinking = true;
    this.status('Thinking…');
    this.sync();
    const coach = await this.coach;
    const rating = await coach.rateMove(fenBefore, uci).catch(() => undefined);
    if (this.stale(id, ply)) return;
    if (rating && judgeOther(rating) === 'also-good') {
      this.game.takeback();
      this.log.truncate(this.game.moves.length);
      this.thinking = false;
      this.board.setAutoShapes([]);
      this.sync();
      this.say({ kind: 'line', text: `${move.san} works too, but there is something stronger here. Try again.`, mood: 'thinking' });
      this.status('Your move. Look for something stronger.');
      return;
    }
    pz.attempt.misses++;
    pz.phase = 'wrong';
    const played = { from, to, promotion: (promotion || undefined) as LineMoveLike['promotion'], uci, san: move.san, mine: true };
    const [judged, ev] = await Promise.all([
      coach.judgeSidelineMove(fenBefore, played).catch(() => undefined),
      this.analyst.then((a) => a.evaluate(this.game.fen, 1)).catch(() => undefined),
    ]);
    if (this.stale(id, ply)) return;
    this.thinking = false;
    const answer = (ev?.lines[0]?.pv ?? []).slice(0, 4);
    const remark: Remark = {
      kind: 'line',
      text: `Not this one. ${judged?.text ?? ''}`.trim(),
      mood: 'concerned',
      severity: 'mistake',
      cue: 'missed',
      marks: [{ square: to, kind: 'bad' }],
    };
    this.say(remark);
    this.setMood('concerned', 'mistake');
    if (answer.length) {
      this.demo = { fenAfter: this.game.fen, ucis: answer, remark, running: false };
      void this.playDemo();
    }
    this.sync();
    this.status('Try again, or explore why it fails.');
    let choice = await this.askPuzzleRetry();
    while (choice === 'explore') {
      // Engine moves start hidden here: they would give the puzzle away.
      await this.openSideline(fenBefore, 'This is the puzzle position. The gray line is your move and the reply; play any move to try another idea. Tap Back to game to return to the puzzle.', ply - 1, [{ label: 'What happened', ucis: [uci, ...answer] }], true);
      if (this.stale(id, ply)) return;
      this.status('Try again, or explore why it fails.');
      choice = await this.askPuzzleRetry();
    }
    this.stopDemo();
    this.game.takeback();
    this.log.truncate(this.game.moves.length);
    pz.phase = 'solving';
    this.board.setAutoShapes([]);
    this.sync();
    this.status('Your move. Try again.');
  }

  /** After a wrong move: Try again (back to the puzzle position) or Explore (the sideline). */
  private askPuzzleRetry(): Promise<'retry' | 'explore'> {
    const box = this.el.choices;
    box.innerHTML =
      `<button data-choice="retry" class="primary">Try again</button><button data-choice="explore">Explore</button>` +
      (this.demo ? `<button data-choice="replay" class="icon ghost" aria-label="Replay the line">↻</button>` : '');
    box.hidden = false;
    return new Promise((resolve) => {
      const board = this.el.board;
      const tap = () => {
        if (this.demo?.running) this.endDemo();
      };
      board.addEventListener('click', tap, true);
      this.retryCleanup = () => {
        box.hidden = true;
        box.onclick = null;
        board.removeEventListener('click', tap, true);
        this.retryCleanup = undefined;
      };
      box.onclick = (e) => {
        const btn = (e.target as HTMLElement).closest('button');
        if (!btn) return;
        if (btn.dataset.choice === 'replay') {
          this.sync();
          void this.playDemo();
          return;
        }
        this.retryCleanup?.();
        this.demoToken++;
        if (this.demo) this.demo.running = false;
        resolve(btn.dataset.choice as 'retry' | 'explore');
      };
    });
  }

  private async puzzleHint(): Promise<void> {
    const pz = this.puzzling;
    const want = pz?.run?.expected;
    if (!pz || !want || pz.phase !== 'solving') return;
    pz.hintStep = Math.min(pz.hintStep + 1, 4);
    pz.attempt.hints = Math.max(pz.attempt.hints, pz.hintStep);
    const h = puzzleHint(this.game.fen, want, pz.hintStep);
    this.say({ kind: 'hint', text: h.text, mood: 'thinking', shapes: h.shapes });
  }

  /** Writes this try to the results (once). */
  private recordPuzzle(solved: boolean): void {
    const pz = this.puzzling;
    if (!pz?.run || pz.recorded) return;
    pz.attempt.solved = solved;
    this.puzzleResults.record(pz.run.puzzle, pz.attempt);
    // The theme's level follows the result (task 3.2b).
    if (pz.current) this.puzzleResults.setLevel(pz.current, nextLevel(this.puzzleResults.levelOf(pz.current, startLevel(pz.level.puzzleBand)), pz.attempt));
    pz.recorded = true;
  }

  private puzzleSolved(): void {
    const pz = this.puzzling;
    const run = pz?.run;
    if (!pz || !run) return;
    pz.phase = 'solved';
    pz.solvedCount++;
    this.recordPuzzle(true);
    this.thinking = false;
    const words = solvedWords(run, pz.line);
    const last = pz.line.at(-1)!;
    const hinted = pz.attempt.hints >= 3 ? ' Next time, try it with fewer hints.' : '';
    const cue: Cue = !pz.attempt.misses && !pz.attempt.hints ? 'solvedFirstTry' : 'solved';
    this.say({ kind: 'praise', text: words.text + hinted, mood: 'pleased', marks: [{ square: last.slice(2, 4) as Square, kind: 'good' }], cue });
    this.setMood('pleased');
    this.sync();
    this.status('Solved.');
    const box = this.el.choices;
    const again = words.theme && (POOL_THEMES as readonly string[]).includes(words.theme) ? words.theme : undefined;
    box.innerHTML =
      (again ? `<button data-choice="again">Another ${themeName(again).toLowerCase()}?</button>` : '') +
      `<button data-choice="next" class="primary">Next puzzle</button>`;
    box.hidden = false;
    box.onclick = (e) => {
      const c = (e.target as HTMLElement).closest('button')?.dataset.choice;
      if (!c) return;
      box.hidden = true;
      box.onclick = null;
      void this.nextPuzzle(c === 'again' ? again : undefined);
    };
  }

  /** Skip: counted as a try that was not solved (the next one is a little easier), never as a miss. */
  private async skipPuzzle(): Promise<void> {
    const pz = this.puzzling;
    if (!pz || pz.phase === 'intro') return;
    if (this.sideline) this.exitSideline();
    if (pz.phase !== 'solved') this.recordPuzzle(false);
    this.el.choices.hidden = true;
    await this.nextPuzzle();
  }

  /** Back to the Puzzles tab: the puzzle is set aside (Continue brings it back) and the game is back underneath. */
  private async exitPuzzles(): Promise<void> {
    if (!this.puzzling) return;
    await this.backToGame();
    this.showScreen('puzzles');
  }

  /** Play while a puzzle is on the board: the puzzle is set aside and the game comes back as it was left. */
  private async backToGame(): Promise<void> {
    this.showScreen('play');
    const current = this.store.current();
    await this.newGame(current && current.moves.length ? current : undefined); // parks the puzzle first
  }

  /** A try left half-way counts as tried if the player did something in it (once). */
  private endTry(pz: PuzzleSession): void {
    if (pz.phase === 'solved' || pz.recorded || !(pz.line.length || pz.attempt.misses || pz.attempt.hints)) return;
    const keep = this.puzzling;
    this.puzzling = pz;
    this.recordPuzzle(false);
    this.puzzling = keep;
  }

  /** Sets the puzzle on the board aside (see `parked`); nothing when no puzzle is on the board. */
  private parkPuzzle(): void {
    const pz = this.puzzling;
    if (!pz) return;
    if (this.sideline) this.exitSideline();
    this.retryCleanup?.();
    this.stopDemo();
    this.el.choices.hidden = true;
    this.thinking = false;
    this.parked = { session: pz, remarks: this.log.all.map((e) => ({ ply: e.ply, remark: e.remark })) };
    this.puzzling = undefined;
  }

  /** Brings the parked puzzle back where it was: the position after the moves found so far, and the coach's words. */
  private async continuePuzzle(): Promise<void> {
    if (this.puzzling) return this.showScreen('play');
    const parked = this.parked;
    const pz = parked?.session;
    const run = pz?.run;
    if (!parked || !pz || !run) return;
    this.parked = undefined;
    this.save(); // the game in progress stays as it is
    this.endLesson();
    ++this.gameId;
    this.reviewing?.abort?.abort();
    this.reviewing = undefined;
    this.puzzling = pz;
    this.mode = PUZZLE;
    void this.showCoach(pz.level);
    this.showScreen('play');
    this.railCurrent();
    if (pz.phase === 'solved' || run.solved) {
      await this.nextPuzzle();
      return;
    }
    // Rebuilt from the puzzle itself: a reply or an engine answer that was still on its way is not lost or doubled.
    const game = new Game(run.solverColor, run.puzzle.fen);
    game.play(run.firstMove);
    const found = run.solution.slice(0, run.index);
    for (const u of found) game.play(u);
    this.game = game;
    this.record = undefined;
    pz.line = [...found];
    pz.phase = 'solving';
    pz.hintStep = 0;
    this.coach = Promise.all([this.analyst, this.book]).then(([a, book]) => new Coach(a, pz.level, run.solverColor === 'white' ? 'w' : 'b', PUZZLE, book));
    this.nav.reset(game.moves.length);
    this.log.clear();
    for (const e of parked.remarks) if (e.ply <= game.moves.length) this.log.add(e.ply, e.remark);
    this.viewShapes = false;
    this.thinking = false;
    this.board.set({ orientation: run.solverColor, lastMove: undefined });
    this.board.setAutoShapes([]);
    this.sync();
    this.status('Welcome back. Your move.');
  }

  /** The bar under the board in a puzzle: what it is, and Skip / Back to puzzles. */
  private renderPuzzleBar(): void {
    const pz = this.puzzling;
    const bar = this.el['puzzle-bar'];
    bar.hidden = !pz || !!this.sideline;
    if (!pz) return;
    const p = pz.run?.puzzle;
    const what = pz.current ? themeName(pz.current) : `${pz.level.coach.name}'s puzzles`;
    this.el['puzzle-text'].textContent = [what, p ? `rated ${p.rating}` : '', pz.solvedCount ? `${pz.solvedCount} solved` : ''].filter(Boolean).join(' · ');
    (this.el['puzzle-skip'] as HTMLButtonElement).disabled = pz.phase === 'intro';
    this.el['puzzle-skip'].hidden = pz.phase === 'solved'; // the card under the coach offers Next puzzle then
  }

  // --- Openings (task 6.2) ------------------------------------------------
  // The Openings tab (laid out like Puzzles): the coaches' faces, Continue, then the courses by side and by
  // what you face, with progress for the chosen coach. A course page: the intro from the data and every line
  // for that coach, most common first. A lesson is one line on the game screen: the defining and learned moves
  // play by themselves, the player's other moves are asked and checked against the course and the engine.

  /** The six coaches' faces in a row (yours marked); `attr` names the data attribute a tap sets. */
  private coachPicker(chosen: Level, mine: number, attr: string): HTMLElement {
    const picker = document.createElement('div');
    picker.className = 'p-picker';
    picker.setAttribute('role', 'group');
    picker.setAttribute('aria-label', 'Coaches');
    for (const l of LEVELS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'p-pick';
      b.dataset[attr] = String(l.level);
      b.setAttribute('aria-pressed', String(l.level === chosen.level));
      b.setAttribute('aria-label', `${l.coach.name}, about ${l.shownRating}${l.level === mine ? ', your coach' : ''}`);
      const name = document.createElement('span');
      name.className = 'p-pick-name';
      setCoachName(name, l, l.level === mine ? ' ★' : '');
      b.append(coachFace(l, 'sm'), name);
      picker.append(b);
    }
    return picker;
  }

  /** A panel in a coach's accent, without switching the page's theme. */
  private tinted(el: HTMLElement, l: Level): HTMLElement {
    void fetchTheme(l.theme).then((t) => {
      el.style.setProperty('--p-accent', t.theme.coach.accent);
      el.style.setProperty('--p-soft', t.theme.coach.accentSoft ?? t.theme.coach.accent);
    }).catch(() => undefined);
    return el;
  }

  private pieceUrl = (code: string) => `${this.loaded.base}${this.loaded.theme.pieces.folder}/${code}.${this.loaded.theme.pieces.format}`;

  private progressBar(done: number, total: number): HTMLElement {
    const bar = document.createElement('span');
    bar.className = 'p-bar';
    bar.setAttribute('role', 'progressbar');
    bar.setAttribute('aria-valuemin', '0');
    bar.setAttribute('aria-valuemax', String(total));
    bar.setAttribute('aria-valuenow', String(done));
    const fill = document.createElement('i');
    fill.style.width = `${total ? (Math.min(done, total) / total) * 100 : 0}%`;
    bar.append(fill);
    return bar;
  }

  private renderOpeningsScreen(): void {
    this.el['openings-note'].textContent = '';
    if (this.openingView) return void this.renderCoursePage(this.openingView);
    this.el['openings-title'].textContent = 'Openings';
    this.el['openings-close'].textContent = 'Back to play';
    const box = this.el['openings-list'];
    const mine = this.settings.level;
    const chosen = levelInfo(this.openingPick || mine);
    const picker = this.coachPicker(chosen, mine, 'opick');

    const focus = this.tinted(document.createElement('section'), chosen);
    focus.className = 'p-focus';
    const hero = document.createElement('div');
    hero.className = 'p-hero';
    const who = document.createElement('div');
    const title = document.createElement('h3');
    title.textContent = `${chosen.coach.name} · about ${chosen.shownRating}`;
    const say = document.createElement('p');
    say.className = 'p-say';
    say.textContent = 'Pick an opening. I teach the replies players at my level play most, from Lichess games.';
    who.append(title, say);
    hero.append(coachFace(chosen, 'lg'), who);
    focus.append(hero);
    // Drill (task 6.3): the moves due over every course this coach teaches.
    const over = this.drillOverview(chosen.level);
    const drill = document.createElement('div');
    drill.className = 'o-drill';
    const dtext = document.createElement('span');
    dtext.className = 'p-meta';
    if (over.known) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = over.due ? 'primary' : '';
      b.dataset.odrill = 'tab';
      b.textContent = 'Drill';
      dtext.textContent = over.due ? `${over.due} move${over.due === 1 ? '' : 's'} due for review` : `Nothing due right now · ${over.known} move${over.known === 1 ? '' : 's'} learned`;
      drill.append(b, dtext);
    } else {
      dtext.textContent = 'Learn a line, then drill it here: the moves come back for review after 1, 3, 7, 14 and 30 days.';
      drill.append(dtext);
    }
    focus.append(drill);

    const metas = new Map<string, HTMLElement>();
    const boards = new Map<string, HTMLElement>();
    for (const side of CATALOG) {
      const h = document.createElement('h3');
      h.className = 'o-side';
      h.textContent = side.title;
      focus.append(h);
      for (const g of side.groups) {
        const gh = document.createElement('h4');
        gh.className = 'o-group';
        gh.textContent = g.title;
        focus.append(gh);
        for (const row of g.rows) {
          if (row.label) {
            const p = document.createElement('p');
            p.className = 'o-row-label';
            p.textContent = row.label;
            if (row.note) {
              const n = document.createElement('span');
              n.textContent = ` ${row.note}`;
              p.append(n);
            }
            focus.append(p);
          }
          const grid = document.createElement('div');
          grid.className = 'o-cards';
          for (const c of row.courses) {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'o-card';
            b.dataset.course = c.id;
            const board = document.createElement('span');
            board.className = 'o-mini';
            const name = document.createElement('span');
            name.className = 'p-name';
            name.textContent = c.title;
            const meta = document.createElement('span');
            meta.className = 'p-meta';
            meta.textContent = ' ';
            const text = document.createElement('span');
            text.className = 'o-card-text';
            text.append(name, this.progressBar(0, 1), meta);
            b.append(board, text);
            metas.set(c.id, meta);
            boards.set(c.id, board);
            grid.append(b);
          }
          focus.append(grid);
        }
      }
    }

    const cur = this.openingProgress.current;
    const parts: HTMLElement[] = [];
    if (cur) {
      const cont = document.createElement('button');
      cont.type = 'button';
      cont.className = 'p-continue';
      cont.dataset.ocontinue = '1';
      cont.innerHTML = '<strong>Continue your lesson</strong><span></span>';
      cont.lastElementChild!.textContent = `${courseTitle(cur.course)} · ${levelInfo(cur.tier).coach.name}`;
      parts.push(cont);
    }
    box.replaceChildren(...parts, picker, focus);

    void loadIndex().then((index) => {
      for (const [id, meta] of metas) {
        const c = index.get(id);
        if (!c) continue;
        const total = c.playerNodes[chosen.level - 1] ?? 0;
        const done = Math.min(total, this.openingProgress.countFor(id, chosen.level));
        const due = this.drillDeck(id, chosen.level).due.size;
        meta.textContent = (done >= total && total ? `All ${total} moves learned ✓` : `${done} / ${total} moves learned`) + (due ? ` · ${due} due` : '');
        const card = meta.closest('button')!;
        card.querySelector('.p-bar')!.replaceWith(this.progressBar(done, total));
        card.setAttribute('aria-label', `${courseTitle(id)}: ${meta.textContent} with ${chosen.coach.name}`);
        boards.get(id)!.replaceChildren(miniBoard(c.startFen, c.side, this.pieceUrl));
      }
    }).catch(() => {
      this.el['openings-note'].textContent = 'The courses could not be loaded. Check your connection and try again.';
    });
  }

  /** A course page: the intro, then every line for the chosen coach (most common first), each to (re)play. */
  private async renderCoursePage(id: string): Promise<void> {
    this.el['openings-title'].textContent = courseTitle(id);
    this.el['openings-close'].textContent = 'All openings';
    const box = this.el['openings-list'];
    let tree: CourseTree;
    try {
      tree = await loadCourse(id);
    } catch {
      this.el['openings-note'].textContent = 'This course could not be loaded. Check your connection and try again.';
      return;
    }
    if (this.openingView !== id) return;
    const mine = this.settings.level;
    const chosen = levelInfo(this.openingPick || mine);
    const tier = chosen.level;
    const learned = (k: string) => this.openingProgress.isLearned(id, k);
    const lines = courseLines(tree, tier);
    const status = lineStatuses(tree, lines, learned);
    const total = new Set(lines.flatMap((l) => quizNodes(l).map((n) => n.id))).size;
    const done = Math.min(total, this.openingProgress.countFor(id, tier));

    const focus = this.tinted(document.createElement('section'), chosen);
    focus.className = 'p-focus';
    const hero = document.createElement('div');
    hero.className = 'p-hero';
    const who = document.createElement('div');
    const title = document.createElement('h3');
    title.textContent = `With ${chosen.coach.name} · about ${chosen.shownRating}`;
    const say = document.createElement('p');
    say.className = 'p-say';
    say.textContent = introWords(tree, tier);
    who.append(title, say);
    hero.append(coachFace(chosen, 'lg'), who);
    const prog = document.createElement('div');
    prog.className = 'o-progress';
    const meta = document.createElement('span');
    meta.className = 'p-meta';
    meta.textContent = `${done} / ${total} moves learned · ${lines.length} lines`;
    prog.append(this.progressBar(done, total), meta);
    const next = nextLine(tree, lines, learned);
    const go = document.createElement('button');
    go.type = 'button';
    go.className = 'primary p-start';
    if (next) go.dataset.oline = next.key;
    go.textContent = status.includes('next') ? (done ? 'Next line' : 'Start the first line') : 'Practise the first line';
    focus.append(hero, prog, go);
    const deck = this.drillDeck(id, tier);
    if (deck.keys.length) {
      const dr = document.createElement('button');
      dr.type = 'button';
      dr.className = 'p-start';
      dr.dataset.odrill = 'course';
      dr.textContent = deck.due.size ? `Drill · ${deck.due.size} due` : 'Drill (nothing due)';
      focus.append(dr);
    }

    // Moves after the defining ones, numbered from where the course starts.
    let start = tree.nodes[0];
    for (let i = 0; i < tree.defining.length; i++) start = tree.nodes[start.children.find((c) => tree.nodes[c].defining)!];
    const list = document.createElement('ol');
    list.className = 'o-lines';
    lines.forEach((l, i) => {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `o-line ${status[i]}`;
      b.dataset.oline = l.key;
      const moves = document.createElement('span');
      moves.className = 'o-moves';
      moves.textContent = lineText(start.fen, l.nodes.slice(tree.defining.length).map((n) => n.san));
      const tags = document.createElement('span');
      tags.className = 'o-tags';
      const share = document.createElement('span');
      share.textContent = `${l.reach >= 0.01 ? Math.round(l.reach * 100) : '<1'}% of games`;
      tags.append(share);
      const chip = (text: string, cls: string) => {
        const c = document.createElement('span');
        c.className = `o-chip ${cls}`;
        c.textContent = text;
        tags.append(c);
      };
      if (status[i] === 'learned') chip('Learned ✓', 'learned');
      if (status[i] === 'next') chip('Next', 'next');
      if (l.trap) chip('Trap', 'trap');
      b.append(moves, tags);
      b.setAttribute('aria-label', `Line ${i + 1}: ${moves.textContent}. ${[...tags.children].map((c) => c.textContent).join(', ')}`);
      li.append(b);
      list.append(li);
    });
    const head = document.createElement('h4');
    head.className = 'o-group';
    head.textContent = 'Every line, most common first';
    box.replaceChildren(this.coachPicker(chosen, mine, 'opick'), focus, head, list);
  }

  private onOpeningsClick(e: MouseEvent): void {
    const t = e.target as HTMLElement;
    const pick = t.closest<HTMLElement>('[data-opick]');
    if (pick) {
      this.openingPick = Number(pick.dataset.opick);
      this.renderOpeningsScreen();
      return this.screenCoach();
    }
    if (t.closest('[data-ocontinue]')) return void this.continueLesson();
    const drill = t.closest<HTMLElement>('[data-odrill]');
    if (drill) {
      const tier = levelInfo(this.openingPick || this.settings.level).level;
      return void this.startDrill(drill.dataset.odrill === 'course' ? this.openingView : undefined, tier, drill.dataset.odrill === 'course' ? 'course' : 'tab');
    }
    const course = t.closest<HTMLElement>('[data-course]');
    if (course) {
      this.openingView = course.dataset.course;
      this.renderOpeningsScreen();
      this.el['openings-screen'].scrollTop = 0;
      return;
    }
    const line = t.closest<HTMLElement>('[data-oline]');
    if (line && this.openingView) void this.startLesson(this.openingView, levelInfo(this.openingPick || this.settings.level).level, line.dataset.oline);
  }

  private async continueLesson(): Promise<void> {
    const cur = this.openingProgress.current;
    if (!cur) return;
    const ls = this.lesson;
    if (ls && ls.tree.id === cur.course && ls.line.key === cur.line && ls.level.level === cur.tier) return this.showScreen('play');
    await this.startLesson(cur.course, cur.tier, cur.line);
  }

  /** Starts a lesson: one line of a course with a coach (the line given, else the most common one not learned yet). */
  private async startLesson(courseId: string, tier: number, lineKey?: string): Promise<void> {
    let tree: CourseTree;
    try {
      tree = await loadCourse(courseId);
    } catch {
      this.el['openings-note'].textContent = 'This course could not be loaded. Check your connection and try again.';
      return;
    }
    const level = levelInfo(tier);
    const lines = courseLines(tree, tier);
    const learned = (k: string) => this.openingProgress.isLearned(courseId, k);
    const line = (lineKey ? lines.find((l) => l.key === lineKey) : undefined) ?? nextLine(tree, lines, learned);
    if (!line) return;
    const { steps, practice } = lessonSteps(tree, line, tier, learned);
    const ls: LessonSession = { tree, level, lines, line, steps, index: 0, practice, phase: 'auto', hintStep: 0, learnedNow: 0, found: 0, asked: steps.filter((s) => s.kind === 'quiz').length };
    const token = this.lessonOnBoard(ls);
    this.openingView = courseId;
    this.openingProgress.setCurrent({ course: courseId, tier, line: line.key, at: Date.now() });
    const n = lines.indexOf(line);
    // The first line steps through the defining moves with their ideas; later lines set them up at once.
    let start = '';
    if (n > 0) {
      while (ls.steps[ls.index]?.node.defining) this.game.play(ls.steps[ls.index++].node.uci);
      this.sync();
      start = `It starts ${definingText(tree)}, the ${tree.opening}. `;
    }
    const intro = n === 0 ? `${introWords(tree, tier)} ` : '';
    const what = practice
      ? "You know this line, so let's practise it: I'll ask every move again."
      : `Line ${n + 1} of ${lines.length}. ${start}Tap Next to go through the moves; when it is your turn I'll tell you what is needed and you find the move.`;
    this.say({ kind: 'phase', text: `${intro}${what}`, mood: 'neutral' });
    this.status('');
    if (!(await this.waitNext(ls, token, 'Start', false))) return;
    await this.walkLesson(ls, token);
  }

  /** Puts a lesson or drill on the board from the start position (the game in progress waits in storage). Returns its token. */
  private lessonOnBoard(ls: LessonSession): number {
    const { tree, level } = ls;
    this.save(); // the game in progress stays as it is, to come back to
    this.parkPuzzle();
    this.reviewing?.abort?.abort();
    this.reviewing = undefined;
    if (this.sideline) this.exitSideline();
    this.endLesson();
    ++this.gameId;
    const token = ++this.lessonToken;
    this.mode = OPENING;
    void this.showCoach(level);
    this.lesson = ls;
    this.openingPick = level.level;
    const color: Color = tree.side === 'w' ? 'white' : 'black';
    this.game = new Game(color);
    this.record = undefined;
    this.coach = Promise.all([this.analyst, this.book]).then(([a, book]) => new Coach(a, level, tree.side, OPENING, book));
    this.nav.reset(0);
    this.log.clear();
    this.viewShapes = false;
    this.stopDemo();
    this.el.choices.hidden = true;
    this.thinking = true;
    this.board.set({ orientation: color, lastMove: undefined });
    this.board.setAutoShapes([]);
    this.showScreen('play');
    this.sync();
    return token;
  }

  /** Plays the lesson's steps from `index` until the next move to ask, or the end of the line. */
  private async walkLesson(ls: LessonSession, token: number): Promise<void> {
    if (!ls.drill) return this.stepLesson(ls, token);
    const live = () => token === this.lessonToken && this.lesson === ls;
    const tier = ls.level.level;
    while (live() && ls.index < ls.steps.length) {
      const step = ls.steps[ls.index];
      if (step.kind === 'quiz') return this.askLessonMove(ls);
      const n = step.node;
      const words = n.who !== 'opponent' || n.defining ? '' : step.trap ? trapWords(ls.tree, n, tier) : step.branch ? branchWords(ls.tree, step, tier) : '';
      if (words) {
        this.say({ kind: 'phase', text: words, mood: step.trap ? 'surprised' : 'thinking' });
        await sleep(Math.min(2600, 900 + words.length * 12));
      } else await sleep(n.defining ? 450 : 700);
      if (!live()) return;
      ls.phase = 'auto';
      this.thinking = true;
      this.game.play(n.uci);
      this.board.setAutoShapes([]);
      this.status(n.who === 'player' ? `You know this one: ${nodeLabel(ls.tree, n)}.` : `${nodeLabel(ls.tree, n)}.`);
      this.sync();
      ls.index++;
    }
    if (live()) this.lessonDone(ls);
  }

  /**
   * A lesson's walk (the Learn rework): each shown move plays when the player taps Next, with a sentence on what
   * it does (and for their move, how often it is played); their move just before a question is worded with it.
   */
  private async stepLesson(ls: LessonSession, token: number): Promise<void> {
    const live = () => token === this.lessonToken && this.lesson === ls;
    const tier = ls.level.level;
    let pending = '';
    let pendingShapes: IdeaShape[] = [];
    while (live() && ls.index < ls.steps.length) {
      const step = ls.steps[ls.index];
      if (step.kind === 'quiz') return this.askLessonMove(ls, pending, pendingShapes);
      ls.phase = 'auto';
      this.thinking = true;
      await sleep(ls.skip ? 200 : 350);
      if (!live()) return;
      this.game.play(step.node.uci);
      this.board.setAutoShapes([]);
      this.sync();
      ls.index++;
      const words = shownWords(ls.tree, step, tier);
      // The board draws what the words say: red for their move's ideas, green for yours.
      const shapes = tagShapes(shownTags(step.node, tier), step.node.uci.slice(2, 4) as Square, step.node.fen, step.node.who === 'player' ? 'green' : 'red');
      if (ls.steps[ls.index]?.kind === 'quiz' && step.node.who === 'opponent') {
        pending = words;
        pendingShapes = shapes;
        continue;
      }
      pending = '';
      pendingShapes = [];
      if (ls.skip) continue;
      this.say({ kind: 'phase', text: words, mood: step.trap ? 'surprised' : 'neutral', shapes });
      this.status('');
      if (ls.index < ls.steps.length && !(await this.waitNext(ls, token))) return;
    }
    if (live()) this.lessonDone(ls);
  }

  /** Waits for Next (or Enter / Space). "Skip to my move" plays the shown moves without waiting until the next question. */
  private waitNext(ls: LessonSession, token: number, label = 'Next ›', skip = true): Promise<boolean> {
    const live = () => token === this.lessonToken && this.lesson === ls;
    this.thinking = false;
    this.sync();
    const box = this.el.choices;
    const more = skip && ls.steps.slice(ls.index).some((s) => s.kind === 'quiz');
    box.innerHTML = (more ? '<button data-choice="skip">Skip to my move</button>' : '') + `<button data-choice="next" class="primary">${label}</button>`;
    box.hidden = false;
    return new Promise((resolve) => {
      const done = () => {
        box.hidden = true;
        box.onclick = null;
        document.removeEventListener('keydown', key);
        resolve(live());
      };
      const key = (e: KeyboardEvent) => {
        if (!live()) return document.removeEventListener('keydown', key);
        if ((e.key === 'Enter' || e.key === ' ') && !(e.target instanceof Element && e.target.closest('button, select, input, textarea'))) {
          e.preventDefault();
          done();
        }
      };
      document.addEventListener('keydown', key);
      box.onclick = (e) => {
        const c = (e.target as HTMLElement).closest('button')?.dataset.choice;
        if (!c) return;
        if (c === 'skip') ls.skip = true;
        done();
      };
    });
  }

  /** The player's turn: in a lesson, the goal first (what is needed, from the course move's board facts); in practice and drills, asked cold. */
  private askLessonMove(ls: LessonSession, pending = '', pendingShapes: IdeaShape[] = []): void {
    ls.phase = 'quiz';
    ls.hintStep = 0;
    ls.tries = 0;
    ls.shown = false;
    ls.skip = false;
    if (ls.drill) ls.drill.missed = false;
    this.thinking = false;
    this.sync();
    const tier = ls.level.level;
    const prev = ls.steps[ls.index - 1]?.node;
    if (!ls.drill) {
      const node = ls.steps[ls.index].node;
      const ask = ls.practice ? 'What would you play here?' : goalQuestion(this.game.fen, node);
      const text = `${pending ? `${pending} ` : ''}${prev?.trap ? 'Punish it. ' : ''}${ask}`;
      const shapes = [...pendingShapes, ...(ls.practice ? [] : goalShapes(this.game.fen, node))];
      this.say({ kind: 'phase', text, mood: 'thinking', shapes });
      this.status(`Your move${ls.practice ? ' (practice)' : ''}.`);
      return;
    }
    let text = '';
    if (prev?.who === 'opponent' && !prev.defining && !prev.trap && tier >= 3) {
      const idea = ideaSentence(prev.tags, tier, nodeLabel(ls.tree, prev));
      if (idea) text = `${idea} `;
    }
    text += prev?.trap ? 'Your move: punish it.' : 'What would you play here?';
    this.say({ kind: 'phase', text, mood: 'thinking' });
    this.status(`Your move${ls.drill ? ' (drill)' : ls.practice ? ' (practice)' : ''}.`);
  }

  private async onLessonMove(from: Square, to: Square): Promise<void> {
    const ls = this.lesson;
    if (!ls || ls.phase !== 'quiz') return;
    const token = this.lessonToken;
    const live = () => token === this.lessonToken && this.lesson === ls;
    let promotion = '';
    if (this.game.isPromotion(from, to)) {
      promotion = await this.askPromotion(this.game.playerColor);
      if (!live()) return;
    }
    const uci = from + to + promotion;
    const fenBefore = this.game.fen;
    const node = ls.steps[ls.index].node;
    this.el.choices.hidden = true;
    this.stopDemo();
    this.board.setAutoShapes([]);
    this.el['bubble-box'].classList.add('stale');
    if (isCourseMove(fenBefore, uci, node)) {
      this.game.play(node.uci);
      this.sync();
      return this.lessonFound(ls, token);
    }
    if (ls.drill) return this.drillMiss(ls, fenBefore, uci);
    const move = this.game.play(uci);
    const ply = this.game.moves.length;
    ls.phase = 'auto';
    this.thinking = true;
    this.status('Thinking…');
    this.sync();
    const coach = await this.coach;
    let alt: Awaited<ReturnType<Coach['rateMove']>> | undefined;
    let course: typeof alt;
    try {
      alt = await coach.rateMove(fenBefore, uci);
      course = await coach.rateMove(fenBefore, node.uci);
    } catch {
      /* no engine: treated as "try again" below */
    }
    if (!live()) return;
    const verdict = alt && course ? judgeAlternative(alt.lossCp, course.lossCp) : undefined;
    if (verdict !== 'mistake') {
      // Not the course move: what it does against what was needed, the engine's view, then the player plays the course move.
      this.game.takeback();
      this.log.truncate(this.game.moves.length);
      ls.phase = 'quiz';
      this.thinking = false;
      this.sync();
      const parent = ls.tree.nodes[node.parent];
      const previous = parent.parent >= 0 ? { to: parent.uci.slice(2, 4) as Square, captured: parent.san.includes('x') } : undefined;
      const cmp = compareWords(fenBefore, uci, node, ls.level.level, previous);
      const eng = !alt ? '' : verdict === 'fine' ? ' The engine is fine with it too.' : ` The engine rates it ${(alt.lossCp / 100).toFixed(1)} pawns worse than its best move here.`;
      this.retryOrShow(ls, `${cmp}${eng}`);
      return;
    }
    // A mistake: what goes wrong (the engine's answer as a ghost line), then Try again or Explore (a sideline).
    ls.phase = 'wrong';
    const played = { from, to, promotion: (promotion || undefined) as LineMoveLike['promotion'], uci, san: move.san, mine: true };
    const [judged, ev] = await Promise.all([
      coach.judgeSidelineMove(fenBefore, played).catch(() => undefined),
      this.analyst.then((a) => a.evaluate(this.game.fen, 1)).catch(() => undefined),
    ]);
    if (!live()) return;
    this.thinking = false;
    const answer = (ev?.lines[0]?.pv ?? []).slice(0, 4);
    const remark: Remark = { kind: 'line', text: `Not this one. ${judged?.text ?? ''}`.trim(), mood: 'concerned', severity: 'mistake', marks: [{ square: to, kind: 'bad' }] };
    this.say(remark);
    this.setMood('concerned', 'mistake');
    if (answer.length) {
      this.demo = { fenAfter: this.game.fen, ucis: answer, remark, running: false };
      void this.playDemo();
    }
    this.sync();
    this.status('Try again, or explore why it fails.');
    let choice = await this.askPuzzleRetry();
    while (choice === 'explore') {
      await this.openSideline(fenBefore, 'This is the lesson position. The gray line is your move and the reply; play any move to try another idea. Tap Back to game to return to the lesson.', ply - 1, [{ label: 'What happened', ucis: [uci, ...answer] }], true);
      if (!live()) return;
      this.status('Try again, or explore why it fails.');
      choice = await this.askPuzzleRetry();
    }
    if (!live()) return;
    this.stopDemo();
    this.game.takeback();
    this.log.truncate(this.game.moves.length);
    ls.phase = 'quiz';
    this.board.setAutoShapes([]);
    this.sync();
    this.retryOrShow(ls, '');
  }

  /** After a wrong try: try again (with the goal repeated), or after two tries the course move is shown and the player plays it. */
  private retryOrShow(ls: LessonSession, why: string): void {
    const node = ls.steps[ls.index].node;
    ls.tries = (ls.tries ?? 0) + 1;
    if (ls.tries >= 2 || ls.shown) {
      ls.shown = true;
      const idea = foundSentence(node.tags, ls.level.level);
      this.say({ kind: 'line', text: `${why ? `${why} ` : ''}This course plays ${nodeLabel(ls.tree, node)}. ${idea} Play it on the board.`.trim(), mood: 'thinking', shapes: [{ orig: node.uci.slice(0, 2) as Square, dest: node.uci.slice(2, 4) as Square, brush: 'green' }] });
      this.status('Your move: play the arrow.');
      return;
    }
    const goal = ls.practice ? '' : ` ${goalQuestion(this.game.fen, node)}`;
    this.say({ kind: 'line', text: `${why ? `${why} ` : ''}Try again.${goal}`.trim(), mood: 'thinking' });
    this.status('Your move. Try again.');
  }

  /**
   * The course move is on the board (found, or played after another fine move `altSan`): the coach names its
   * idea (and after a trap, what the punishment wins). Found without a hint, it is learned.
   */
  private async lessonFound(ls: LessonSession, token: number, altSan?: string): Promise<void> {
    if (ls.drill) return this.drillFound(ls, token);
    const tree = ls.tree;
    const tier = ls.level.level;
    const node = ls.steps[ls.index].node;
    const prev = tree.nodes[node.parent];
    const label = nodeLabel(tree, node);
    const idea = foundSentence(node.tags, tier);
    const hinted = ls.hintStep > 0 || !!ls.shown;
    let text = altSan ? `${altSan} works too, but this course plays ${label}.` : `Right: ${label}.`;
    if (idea) text += ` ${idea}`;
    const punish = prev.trap ? punishWords(tree, prev, node) : '';
    if (punish) text += ` ${punish}`;
    else if (!prev.trap && tier >= 4) {
      const more = lineAfterReply(prev, node, tier >= 6 ? 4 : 2);
      if (more) text += ` The engine's line goes on ${more}.`;
    }
    if (!altSan && !hinted) {
      ls.found++;
      if (!this.openingProgress.isLearned(tree.id, pathKey(tree, node))) {
        this.openingProgress.learn(tree.id, pathKey(tree, node), tier, node.tier);
        this.deck.add(openingCardId(tree.id, pathKey(tree, node)));
        ls.learnedNow++;
      }
    } else if (!ls.practice) text += altSan ? ' Play the course move next time to learn it.' : ls.shown ? ' I showed you this one, so it comes back next time.' : ' You had a hint, so this move comes back next time.';
    // What the move does, drawn: green arrows to what it attacks, circles on the centre squares and on what it defends.
    const shapes = [
      ...tagShapes(foundTags(node.tags, tier), node.uci.slice(2, 4) as Square, node.fen, 'green'),
      ...defends(prev.fen, node.uci).map((p) => ({ orig: p.square, brush: 'green' as const })),
    ];
    this.say({ kind: 'praise', text, mood: altSan ? 'neutral' : 'pleased', marks: [{ square: node.uci.slice(2, 4) as Square, kind: 'good' }], shapes, cue: altSan || hinted ? undefined : 'lessonRight' });
    if (!altSan) this.setMood('pleased');
    ls.phase = 'auto';
    this.thinking = true;
    ls.index++;
    this.sync();
    this.status('');
    if (ls.index < ls.steps.length && !(await this.waitNext(ls, token))) return;
    if (token !== this.lessonToken || this.lesson !== ls) return;
    await this.walkLesson(ls, token);
  }

  private lessonHint(): void {
    const ls = this.lesson;
    if (!ls || ls.phase !== 'quiz') return;
    const node = ls.steps[ls.index].node;
    ls.hintStep = Math.min(ls.hintStep + 1, 2);
    const from = node.uci.slice(0, 2) as Square;
    const p = new Chess(this.game.fen).get(from);
    // A lesson already said the goal: the first hint is the piece. Drills ask cold: the first hint is the idea.
    if (ls.hintStep === 1 && !ls.drill && p) this.say({ kind: 'hint', text: `The piece to move is your ${PIECE_NAME[p.type]} on ${from}.`, mood: 'thinking', shapes: [{ orig: from, brush: 'green' }] });
    else if (ls.hintStep === 1) this.say({ kind: 'hint', text: ideaHint(node.tags), mood: 'thinking' });
    else this.say({ kind: 'hint', text: `This course plays ${nodeLabel(ls.tree, node)}.`, mood: 'thinking', shapes: [{ orig: node.uci.slice(0, 2) as Square, dest: node.uci.slice(2, 4) as Square, brush: 'green' }] });
  }

  /** The end of the line: what was learned, then Next line / Back to the course. */
  private lessonDone(ls: LessonSession): void {
    if (ls.drill) return this.drillDone(ls);
    ls.phase = 'done';
    this.thinking = false;
    this.openingProgress.setCurrent(undefined);
    const tree = ls.tree;
    const tier = ls.level.level;
    const learned = (k: string) => this.openingProgress.isLearned(tree.id, k);
    const status = lineStatuses(tree, ls.lines, learned);
    const total = new Set(ls.lines.flatMap((l) => quizNodes(l).map((n) => n.id))).size;
    const count = Math.min(total, this.openingProgress.countFor(tree.id, tier));
    let text: string;
    if (ls.practice) text = `That's the line. You found ${ls.found} of ${ls.asked} move${ls.asked === 1 ? '' : 's'} without a hint.`;
    else text = `That's the end of this line. ${ls.learnedNow ? `You learned ${ls.learnedNow} new move${ls.learnedNow === 1 ? '' : 's'}` : 'No new moves learned this time'}: ${count} / ${total} for this course with me.`;
    if (!status.includes('next')) text += ' You know every line of this course at my level now. Replay any of them, or pick a stronger coach for more.';
    this.say({ kind: 'praise', text, mood: 'pleased' });
    this.status('Line done.');
    this.sync();
    const nextIdx = status.indexOf('next');
    const next = nextIdx >= 0 ? ls.lines[nextIdx] : ls.lines[(ls.lines.indexOf(ls.line) + 1) % ls.lines.length];
    const box = this.el.choices;
    box.innerHTML = `<button data-choice="course">Back to course</button><button data-choice="next" class="primary">${nextIdx >= 0 ? 'Next line' : 'Practise the next line'}</button>`;
    box.hidden = false;
    box.onclick = (e) => {
      const c = (e.target as HTMLElement).closest('button')?.dataset.choice;
      if (!c) return;
      box.hidden = true;
      box.onclick = null;
      if (c === 'next') void this.startLesson(tree.id, tier, next.key);
      else void this.exitLesson();
    };
  }

  /** Back to the course page: the game comes back underneath (Continue on the tab brings the lesson back). */
  private async exitLesson(): Promise<void> {
    const ls = this.lesson;
    if (!ls) return;
    this.openingView = ls.drill?.from === 'tab' ? undefined : ls.tree.id;
    this.openingPick = ls.level.level;
    await this.backToGame();
    this.showScreen('openings');
  }

  /** Stops the lesson on the board (its walk, a waiting Try again card); nothing when there is none. */
  private endLesson(): void {
    if (!this.lesson) return;
    this.lessonToken++;
    this.retryCleanup?.();
    this.stopDemo();
    this.el.choices.hidden = true;
    this.el.choices.onclick = null;
    this.thinking = false;
    const sl = this.sideline;
    this.lesson = undefined;
    if (sl) this.exitSideline();
  }

  // --- Drill (task 6.3) ------------------------------------------------------
  // Spaced repetition of the learned moves: a card per learned player move (app/practice.ts). A drill plays a
  // course from the start with the lesson's walk; their replies are picked by share at the coach's tier, steered
  // toward due cards (coach/opening-drill.ts); every move of yours is asked. A miss shows the course move with its
  // idea (the card comes back in a day), a clean find pushes the card out, and sometimes asks "Why this move?".

  /** A course's deck for a coach: the learned moves that coach teaches (lower tiers included), and the due ones. */
  private drillDeck(course: string, tier: number, now = Date.now()): { keys: string[]; due: Set<string> } {
    const learned = this.openingProgress.learned(course);
    const keys = deckKeys(learned, tier);
    const due = new Set(
      keys.filter((k) => {
        const id = openingCardId(course, k);
        return cardDue(this.deck.get(id) ?? newCard(id, learned[k].at), now);
      }),
    );
    return { keys, due };
  }

  /** Moves due over every course for a coach, and the course a drill from the tab takes (most due, else most learned). */
  private drillOverview(tier: number): { due: number; known: number; course?: string } {
    let due = 0;
    let known = 0;
    let best: { id: string; due: number; known: number } | undefined;
    for (const id of Object.keys(this.openingProgress.all())) {
      const d = this.drillDeck(id, tier);
      if (!d.keys.length) continue;
      due += d.due.size;
      known += d.keys.length;
      if (!best || d.due.size > best.due || (d.due.size === best.due && d.keys.length > best.known)) best = { id, due: d.due.size, known: d.keys.length };
    }
    return { due, known, course: best?.id };
  }

  /** Starts a drill run of a course (from the tab: the course with the most moves due) with a coach. */
  private async startDrill(courseId: string | undefined, tier: number, from: 'tab' | 'course'): Promise<void> {
    const note = this.el['openings-note'];
    const id = courseId ?? this.drillOverview(tier).course;
    if (!id) {
      note.textContent = 'Learn a line first: a drill asks the moves you have learned.';
      return;
    }
    let tree: CourseTree;
    try {
      tree = await loadCourse(id);
    } catch {
      note.textContent = 'This course could not be loaded. Check your connection and try again.';
      return;
    }
    const { keys, due } = this.drillDeck(id, tier);
    const known = new Set(keys);
    const path = drillPath(tree, tier, (k) => known.has(k), (k) => due.has(k));
    const steps = drillSteps(path);
    const asked = steps.filter((s) => s.kind === 'quiz').length;
    if (!asked) {
      note.textContent = 'Learn a line of this course first: a drill asks the moves you have learned.';
      return;
    }
    const learned = this.openingProgress.learned(id);
    for (const k of keys) this.deck.add(openingCardId(id, k), learned[k].at);
    const level = levelInfo(tier);
    const line: CourseLine = { nodes: path, reach: 0, trap: path.some((n) => n.trap), key: pathKey(tree, path.at(-1)!) };
    const ls: LessonSession = { tree, level, lines: courseLines(tree, tier), line, steps, index: 0, practice: true, phase: 'auto', hintStep: 0, learnedNow: 0, found: 0, asked, drill: { from, hits: 0, misses: 0, missed: false, due: due.size } };
    const token = this.lessonOnBoard(ls);
    this.openingView = from === 'course' ? id : undefined;
    const text = due.size
      ? `Drill: ${due.size} move${due.size === 1 ? ' is' : 's are'} due in this course. I'll pick their replies the way players at my level do, leaning toward the moves that are due. You play yours.`
      : "Drill: nothing is due in this course right now, so this is extra practice. I'll pick their replies the way players at my level do. You play yours.";
    this.say({ kind: 'phase', text, mood: 'neutral' });
    this.status('Watch the moves…');
    await sleep(1200);
    await this.walkLesson(ls, token);
  }

  /** Records the asked move's card once: a clean find is a hit, a wrong move or a hint a miss. */
  private recordDrill(ls: LessonSession, hit: boolean): void {
    const d = ls.drill;
    if (!d || d.missed) return;
    const node = ls.steps[ls.index].node;
    this.deck.record(openingCardId(ls.tree.id, pathKey(ls.tree, node)), hit);
    if (hit) d.hits++;
    else {
      d.misses++;
      d.missed = true;
    }
  }

  /** A move other than the course's in a drill: the course move with its idea (an arrow), to play next. */
  private drillMiss(ls: LessonSession, fenBefore: string, uci: string): void {
    const node = ls.steps[ls.index].node;
    this.recordDrill(ls, false);
    const san = sanOf(fenBefore, uci) ?? uci;
    const idea = ideaSentence(node.tags, ls.level.level);
    // The tapped move is only on chessground's board: put the position back once its move handling is over.
    setTimeout(() => this.lesson === ls && this.sync());
    this.say({
      kind: 'line',
      text: `This course plays ${nodeLabel(ls.tree, node)} here, not ${san}.${idea ? ` ${idea}` : ''} Play it to go on; this move comes back sooner.`,
      mood: 'concerned',
      shapes: [{ orig: node.uci.slice(0, 2) as Square, dest: node.uci.slice(2, 4) as Square, brush: 'green' }],
    });
    this.status('Play the course move.');
  }

  /** Buttons under the coach; resolves with the index tapped (never, if the drill ends first). */
  private askChoices(texts: string[]): Promise<number> {
    const box = this.el.choices;
    box.replaceChildren(
      ...texts.map((t, i) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.dataset.choice = String(i);
        b.textContent = t;
        return b;
      }),
    );
    box.classList.add('stacked');
    box.hidden = false;
    return new Promise((resolve) => {
      this.retryCleanup = () => {
        box.hidden = true;
        box.onclick = null;
        box.classList.remove('stacked');
        this.retryCleanup = undefined;
      };
      box.onclick = (e) => {
        const b = (e.target as HTMLElement).closest('button');
        if (!b) return;
        this.retryCleanup?.();
        resolve(Number(b.dataset.choice));
      };
    });
  }

  /** The course move is on the board in a drill: right (sometimes "Why this move?"), or found after a miss. */
  private async drillFound(ls: LessonSession, token: number): Promise<void> {
    const live = () => token === this.lessonToken && this.lesson === ls;
    const tree = ls.tree;
    const tier = ls.level.level;
    const node = ls.steps[ls.index].node;
    const prev = tree.nodes[node.parent];
    const label = nodeLabel(tree, node);
    const idea = ideaSentence(node.tags, tier);
    const wrongBefore = ls.drill!.missed;
    const clean = !wrongBefore && ls.hintStep === 0;
    this.recordDrill(ls, clean);
    ls.phase = 'auto';
    this.thinking = true;
    this.sync();
    const marks = [{ square: node.uci.slice(2, 4) as Square, kind: 'good' as const }];
    let text: string;
    const why = clean && !prev.trap && Math.random() < WHY_CHANCE ? whyChoices(node.tags) : undefined;
    if (why) {
      this.say({ kind: 'praise', text: `Right: ${label}. Why this move?`, mood: 'pleased', marks, cue: 'lessonRight' });
      this.setMood('pleased');
      this.status('Pick the idea behind it.');
      const i = await this.askChoices(why.choices.map((c) => c.text));
      if (!live()) return;
      const right = why.choices.find((c) => c.right)!;
      const because = idea || right.text;
      text = why.choices[i].right ? `Yes. ${because}` : `Not that one: ${label} doesn't do that. ${because}`;
    } else if (clean) text = `Right: ${label}.${idea ? ` ${idea}` : ''}`;
    else text = !wrongBefore ? `That's it: ${label}. You had a hint, so it comes back sooner.` : `That's it: ${label}.`;
    const punish = prev.trap ? punishWords(tree, prev, node) : '';
    if (punish) text += ` ${punish}`;
    this.say({ kind: 'praise', text, mood: clean ? 'pleased' : 'neutral', marks, cue: clean && !why ? 'lessonRight' : undefined });
    if (clean) this.setMood('pleased');
    ls.index++;
    this.sync();
    this.status(ls.index < ls.steps.length ? 'Their move…' : '');
    await sleep(Math.min(3200, 1200 + text.length * 10));
    if (!live()) return;
    await this.walkLesson(ls, token);
  }

  /** The end of a drill run: how it went and what is still due, then Drill again / back. */
  private drillDone(ls: LessonSession): void {
    const d = ls.drill!;
    ls.phase = 'done';
    this.thinking = false;
    const tier = ls.level.level;
    const total = d.hits + d.misses;
    const left = d.from === 'tab' ? this.drillOverview(tier).due : this.drillDeck(ls.tree.id, tier).due.size;
    const where = d.from === 'tab' ? 'over all your courses' : 'in this course';
    let text = `That's the end of this run: ${d.hits} of ${total} move${total === 1 ? '' : 's'} found without a hint.`;
    text += left ? ` ${left} move${left === 1 ? ' is' : 's are'} still due ${where}.` : ` Nothing else is due ${where}.`;
    if (d.misses) text += ` ${d.misses === 1 ? 'The one' : `The ${d.misses}`} you missed come${d.misses === 1 ? 's' : ''} back tomorrow.`;
    this.say({ kind: 'praise', text, mood: 'pleased' });
    this.status('Run done.');
    this.sync();
    const box = this.el.choices;
    box.innerHTML = `<button data-choice="course">${d.from === 'tab' ? 'Back to openings' : 'Back to course'}</button><button data-choice="again" class="primary">Drill again</button>`;
    box.hidden = false;
    box.onclick = (e) => {
      const c = (e.target as HTMLElement).closest('button')?.dataset.choice;
      if (!c) return;
      box.hidden = true;
      box.onclick = null;
      if (c === 'again') void this.startDrill(d.from === 'tab' ? undefined : ls.tree.id, tier, d.from);
      else void this.exitLesson();
    };
  }

  /** The bar under the board in a lesson: the course, the coach and which line. */
  private renderLessonBar(): void {
    const ls = this.lesson;
    const bar = this.el['lesson-bar'];
    bar.hidden = !ls || !!this.sideline;
    if (!ls) return;
    this.el['lesson-exit'].hidden = ls.phase === 'done'; // the card under the coach offers it then
    if (ls.drill) {
      const done = ls.drill.hits + ls.drill.misses;
      this.el['lesson-text'].textContent = [courseTitle(ls.tree.id), ls.level.coach.name, `drill · ${done} of ${ls.asked} move${ls.asked === 1 ? '' : 's'}`].join(' · ');
      this.el['lesson-exit'].textContent = ls.drill.from === 'tab' ? 'Back to openings' : 'Back to course';
      return;
    }
    this.el['lesson-exit'].textContent = 'Back to course';
    const n = ls.lines.indexOf(ls.line);
    this.el['lesson-text'].textContent = [courseTitle(ls.tree.id), ls.level.coach.name, `line ${n + 1} of ${ls.lines.length}`, ls.practice ? 'practice' : ''].filter(Boolean).join(' · ');
  }

  // --- Lines (task 1.9) ---------------------------------------------------
  // "Try a sideline" opens a tree of Lines from a position: the chart next to the board shows every
  // opened move in its lane (how good it was against the engine's best move in its own position),
  // and at the cursor the options for the next move as dashed moves. The player chooses both sides'
  // moves (a tap on an option, or a move on the board); nothing here changes the game. The coach
  // words the move on the board (its lane, then what the board code found) and nothing else.
  // The game is paused and untouched. Lesson only.

  /** A button in the bubble that opens a sideline (the coach suggests it, e.g. at a tactic). */
  private offerSideline(): void {
    const box = this.el.choices;
    box.innerHTML = `<button data-choice="try" class="primary">Try it out</button>`;
    box.hidden = false;
    box.onclick = (e) => {
      if (!(e.target as HTMLElement).closest('button')) return;
      box.hidden = true;
      this.startSideline();
    };
  }

  /** From the button: the position shown (the live one, or an earlier one being viewed). */
  private startSideline(): void {
    if (!this.mode.sidelines || this.sideline || this.thinking) return;
    void this.openSideline(this.nav.viewing ? this.game.positionAt(this.nav.ply).fen : this.game.fen, undefined, this.nav.viewing ? this.nav.ply : this.game.moves.length, [], true);
  }

  /**
   * Opens a sideline from `fen`. `seeds` are Lines opened at the start: what happened in the game
   * (gray) and what the engine wanted (amber). Resolves when the player goes back to the game.
   */
  private async openSideline(fen: string, intro?: string, ply = this.game.moves.length, seeds: Universe[] = [], spoilerFree = false): Promise<void> {
    const sl = new LineTree(fen, this.game.playerColor);
    if (sl.result.over) {
      this.status('The game is over here, so there is nothing to try.');
      return;
    }
    this.sideline = sl;
    this.sidelinePly = ply;
    this.sidelineToken++;
    this.optionsAt = undefined;
    this.pendingNodes.clear();
    // The engine's moves are shown from the start, except where seeing them would give the answer away.
    this.arrowsOn = !spoilerFree;
    const last = ply > 0 ? this.game.moves[ply - 1]?.san : undefined;
    this.forkLabel = last ? plyLabel(this.game.startFen, ply, last) : 'Start';
    this.el.choices.hidden = true;
    this.stopDemo();
    this.board.setAutoShapes([]);
    sl.root.notes.push(
      intro ??
        (sl.isPlayerTurn
          ? (spoilerFree ? 'Play a move on the board, or tap Show engine moves to see what the engine would play. Nothing here changes your game.' : 'Tap a dashed move to try it, or play any move on the board. Nothing here changes your game.')
          : 'Here is what I could play. Tap one to see it. Nothing here changes your game.'),
    );
    const roots: LineNode[] = [];
    // In Review the moves the game really went on with are always there, as the gray Line.
    if (this.reviewing) {
      const played = this.game.moves.slice(ply, ply + REVIEW_SEED_PLIES).map((m) => m.uci);
      if (played.length) {
        // A moment's own "What happened" carries the coach's reply, not necessarily what was played.
        seeds = [{ label: 'What happened', ucis: played }, ...seeds.map((s) => (s.label === 'What happened' ? { ...s, label: 'The reply' } : s))];
      }
    }
    for (const s of seeds) {
      let node = sl.root;
      try {
        for (const [i, uci] of s.ucis.entries()) {
          node = sl.open(node, uci, s.label === 'What happened' ? 'game' : 'engine');
          if (i === 0) roots.push(node);
        }
      } catch {
        /* a saved line that does not fit the position: keep what opened */
      }
    }
    this.status('Trying a sideline.');
    const closed = new Promise<void>((resolve) => (this.onSidelineClosed = resolve));
    this.sync();
    void this.rateSeeded(sl);
    void this.loadOptions(sl, this.sidelineToken);
    return closed;
  }

  /** A move made on the board in Review: a sideline opens at the position shown, with that move already played. */
  private async sidelineFromReview(from: Square, to: Square): Promise<void> {
    if (this.reviewing?.analysing) return;
    const ply = this.nav.ply;
    const fen = this.nav.viewing ? this.game.positionAt(ply).fen : this.game.fen;
    // Not awaited: the promise resolves when the sideline closes; the sideline itself is open at once.
    void this.openSideline(fen, 'You are in a sideline now. Nothing here changes your game.', ply, [], true);
    await this.onSidelineMove(from, to);
  }

  /** Back to the game, exactly as it was. */
  private exitSideline(): void {
    if (!this.sideline) return;
    const sl = this.sideline;
    // Kept with the game (as a PGN variation) when the player explored something: the path to the cursor.
    const path = sl.path();
    if (path.some((n) => n.author !== 'game') && this.record) {
      this.record.sidelines.push({
        ply: this.sidelinePly,
        rootFen: sl.rootFen,
        moves: path.map((n) => ({ uci: n.uci, san: n.san, mine: (n.color === 'w') === (this.game.playerColor === 'white') })),
      });
      if (this.reviewing) this.store.save(this.record);
    }
    this.sideline = undefined;
    this.sidelineToken++;
    this.optionsAt = undefined;
    this.pendingNodes.clear();
    this.board.setAutoShapes(this.shapesAt(this.nav.ply));
    this.sync();
    this.status('Back to the game.');
    this.onSidelineClosed?.();
    this.onSidelineClosed = undefined;
  }

  /** Removes the move on the board (and everything after it) from the chart. */
  private sidelineUndo(): void {
    const sl = this.sideline;
    if (!sl || sl.cursor === sl.root) return;
    sl.removeFrom(sl.cursor);
    this.cursorMoved(sl);
    this.status('Move removed.');
  }

  /** After the cursor moved: redraw, and rank the options for the new position. */
  private cursorMoved(sl: LineTree): void {
    this.sidelineToken++;
    this.optionsAt = undefined;
    this.sync();
    void this.loadOptions(sl, this.sidelineToken);
  }

  /** Steps along the Lines: to the fork, back, forward (an opened move, else the engine's best option), to the end. */
  private sideStep(to: 'start' | 'back' | 'forward' | 'end'): void {
    const sl = this.sideline;
    if (!sl) return;
    if (to === 'start') sl.start();
    else if (to === 'back') sl.prev();
    else if (to === 'end') sl.end();
    else {
      const next = sl.nextOf(sl.cursor);
      if (next) sl.goto(next);
      else {
        const best = this.optionsAt?.nodeId === sl.cursor.id ? this.optionsAt.options[0] : undefined;
        if (!best) return;
        this.openOption(best);
        return;
      }
    }
    this.cursorMoved(sl);
  }

  /** Rates the cursor's position: the options for the next move. */
  private async loadOptions(sl: LineTree, token: number): Promise<void> {
    const node = sl.cursor;
    if (sl.result.over) return;
    this.sidelineBusy = true;
    this.renderSideline();
    let options: Option[] = [];
    try {
      const coach = await this.coach;
      options = await coach.options(node.fen, 4);
      // What players at the level often choose, even if the engine rates it lower.
      const h = this.maiaHistory(sl, node);
      const likely = await (await this.opponent).likelyMoves(node.fen, h.moves, h.base).catch(() => []);
      if (token === this.sidelineToken && this.sideline === sl) options = await coach.withCommon(node.fen, options, likely);
    } catch {
      /* no engine: the player can still play moves on the board */
    }
    if (token !== this.sidelineToken || this.sideline !== sl) return;
    this.sidelineBusy = false;
    this.optionsAt = { nodeId: node.id, options };
    this.renderSideline();
  }

  /** The options at the cursor that are not opened yet. */
  private ghosts(sl: LineTree): Option[] {
    if (this.optionsAt?.nodeId !== sl.cursor.id || !this.arrowsOn) return [];
    return this.optionsAt.options.filter((o) => !sl.cursor.kids.some((k) => k.uci === o.uci));
  }

  /** Opens an option (the engine's move, from the chart) and goes to it. */
  private openOption(o: Option): void {
    const sl = this.sideline;
    if (!sl) return;
    if (!sl.canOpen(sl.cursor, o.uci)) return void this.status('That is as many Lines as fit on one chart. Remove a move, or go back to the game.');
    const node = sl.open(sl.cursor, o.uci, o.lane === 'other' ? 'you' : 'engine', o);
    sl.goto(node);
    this.cursorMoved(sl);
    void this.noteFor(sl, node);
  }

  /** A move played on the board at the cursor: any side, opened as the player's own Line. */
  private async onSidelineMove(from: Square, to: Square): Promise<void> {
    const sl = this.sideline;
    if (!sl || sl.result.over) return;
    let promotion = '';
    if (sl.isPromotion(from, to)) promotion = await this.askPromotion(sl.turn);
    if (this.sideline !== sl) return;
    const uci = from + to + promotion;
    if (!sl.canOpen(sl.cursor, uci)) {
      this.status('That is as many Lines as fit on one chart. Remove a move, or go back to the game.');
      this.sync();
      return;
    }
    const opt = this.optionsAt?.nodeId === sl.cursor.id ? this.optionsAt.options.find((o) => o.uci === uci) : undefined;
    const node = sl.open(sl.cursor, uci, opt && opt.lane !== 'other' ? 'engine' : 'you', opt);
    sl.goto(node);
    this.cursorMoved(sl);
    void this.noteFor(sl, node);
  }

  /** The moves that led to `node`, for Maia: the game up to where the sideline starts, then the Line. */
  private maiaHistory(sl: LineTree, node: LineNode): { moves: string[]; base: string } {
    return { moves: [...this.game.moves.slice(0, this.sidelinePly).map((m) => m.uci), ...sl.ucis(node)], base: this.game.startFen };
  }

  /** Rates a move if needed (one search when it is not among the engine's lines) and words it. */
  private async noteFor(sl: LineTree, node: LineNode): Promise<void> {
    this.pendingNodes.add(node);
    try {
      const coach = await this.coach;
      if (!node.rating) node.rating = await coach.rateMove(node.parent!.fen, node.uci);
      // A move that is already open (the game's own, or one played on the board) is marked too.
      if (!node.rating.common) {
        const h = this.maiaHistory(sl, node.parent!);
        const likely = await (await this.opponent).likelyMoves(node.parent!.fen, h.moves, h.base).catch(() => []);
        if (isCommon(likely, node.uci)) node.rating = { ...node.rating, common: true };
      }
      if (this.sideline === sl) this.renderSideline();
      node.notes = [await coach.lineNote(sl.rootFen, sl.ucis(node), node.rating)];
      node.reason = coach.reason(sl.rootFen, sl.ucis(node), node.fen, node.rating);
    } catch {
      node.notes = ['I could not rate this move.'];
    }
    this.pendingNodes.delete(node);
    if (this.sideline === sl) this.sync();
  }

  /** Rates the Lines a sideline opened with, one after the other (each costs a search at most). */
  private async rateSeeded(sl: LineTree): Promise<void> {
    for (const node of sl.all()) {
      if (this.sideline !== sl) return;
      await this.noteFor(sl, node);
    }
  }

  /** The board, chart and buttons for the open sideline. */
  private renderSideline(): void {
    const sl = this.sideline;
    if (!sl) return;
    const cur = sl.cursor;
    const over = sl.result.over;
    const turn = sl.turn;
    const last = cur === sl.root ? undefined : cur;
    this.board.set({
      fen: cur.fen,
      turnColor: turn,
      check: sl.inCheck ? turn : false,
      lastMove: last ? [last.uci.slice(0, 2) as Key, last.uci.slice(2, 4) as Key] : undefined,
      viewOnly: false,
      movable: { color: over ? undefined : turn, dests: over ? new Map() : (sl.dests as Map<Key, Key[]>) },
    });
    this.renderMaterial(cur.fen); // the material of the sideline's position, so the strips are never missing
    this.renderEndSignals(cur.fen, false);
    const ghosts = this.ghosts(sl);
    const at = drawChart(
      this.el.chart as unknown as SVGSVGElement,
      { tree: sl, ghosts, forkLabel: this.forkLabel, thinking: this.sidelineBusy, pending: this.pendingNodes, minWidth: this.el['chart-wrap'].clientWidth },
      { node: (n) => this.pickNode(n), ghost: (o) => this.openOption(o) },
    );
    const wrap = this.el['chart-wrap'];
    wrap.scrollLeft = at.x - wrap.clientWidth / 2;
    wrap.scrollTop = at.y - wrap.clientHeight / 2;
    const reasonShapes: DrawShape[] = (cur.reason?.squares ?? []).map((s) => ({ orig: s as Key, brush: 'yellow' }));
    // Options are arrows in their quality's colour and width (no numbers: the chart shows the same colours),
    // strongest drawn last so it stays on top; the cursor's move wears its badge on the piece.
    const arrows: DrawShape[] = [...ghosts].reverse().map((g) => ({ orig: g.uci.slice(0, 2) as Key, dest: g.uci.slice(2, 4) as Key, brush: `q-${g.lane}` }));
    const badge = cur === sl.root ? undefined : badgeOf(cur.rating);
    const badgeMark: DrawShape[] = badge ? [labelShape(cur.uci.slice(2, 4), badge)] : [];
    this.board.setAutoShapes([...reasonShapes, ...arrows, ...badgeMark]);
    const opts = this.el['sideline-arrows'];
    opts.classList.toggle('on', this.arrowsOn);
    opts.setAttribute('aria-pressed', String(this.arrowsOn));
    opts.textContent = this.arrowsOn ? 'Hide engine moves' : 'Show engine moves';
    (this.el['sideline-undo'] as HTMLButtonElement).disabled = cur === sl.root;
    (this.el['nav-start'] as HTMLButtonElement).disabled = cur === sl.root;
    (this.el['nav-back'] as HTMLButtonElement).disabled = cur === sl.root;
    (this.el['nav-forward'] as HTMLButtonElement).disabled = !sl.nextOf(cur) && !ghosts.length;
    (this.el['nav-live'] as HTMLButtonElement).disabled = !sl.nextOf(cur);
    this.el.viewbar.hidden = true;
    this.el['board-area'].classList.remove('viewing');
    for (const id of ['hint', 'sideline', 'takeback']) (this.el[id] as HTMLButtonElement).disabled = true;
    this.el.portrait.classList.toggle('busy', this.sidelineBusy);
    this.renderBubble();
  }

  private pickNode(n: LineNode): void {
    const sl = this.sideline;
    if (!sl || sl.cursor === n) return;
    sl.goto(n);
    this.cursorMoved(sl);
  }

  /**
   * The three choices after a flagged move: Take back, Explore (a sideline on what happened), Play on.
   * A tap on the board is Play on (once the ghost line has finished; a tap during it skips to the end).
   */
  private askTakeback(): Promise<'takeback' | 'play-on' | 'show'> {
    const box = this.el.choices;
    const hasDemo = !!this.demo;
    box.innerHTML =
      `<button data-choice="takeback">Take back</button><button data-choice="show" class="primary">Explore</button><button data-choice="play-on" class="ghost">Play on</button>` +
      (hasDemo ? `<button data-choice="replay" class="icon ghost" aria-label="Replay the line">↻</button>` : '') +
      `<p class="choices-hint">Tap the board to play on.</p>`;
    box.hidden = false;
    this.status('Take it back, explore it, or play on?');
    const shown = Date.now();
    return new Promise((resolve) => {
      const board = this.el.board;
      const finish = (c: 'takeback' | 'play-on' | 'show') => {
        box.hidden = true;
        box.onclick = null;
        board.removeEventListener('click', tap, true);
        if (c !== 'show') this.stopDemo();
        else {
          this.demoToken++;
          if (this.demo) this.demo.running = false;
        } // the sideline takes the board; the line can be replayed afterwards
        resolve(c);
      };
      const tap = () => {
        if (Date.now() - shown < 600) return; // the tap that made the move
        if (this.demo?.running) this.endDemo();
        else finish('play-on');
      };
      board.addEventListener('click', tap, true);
      box.onclick = (e) => {
        const btn = (e.target as HTMLElement).closest('button');
        if (!btn) return;
        if (btn.dataset.choice === 'replay') {
          this.sync();
          void this.playDemo();
          return;
        }
        finish(btn.dataset.choice as 'takeback' | 'play-on' | 'show');
      };
    });
  }

  /** Shows a picker over the board and resolves with q, r, b or n. */
  private askPromotion(color: Color): Promise<string> {
    const c = color === 'white' ? 'w' : 'b';
    const box = this.el.promotion;
    box.innerHTML = (['q', 'r', 'b', 'n'] as const)
      .map(
        (p) =>
          `<button data-piece="${p}" aria-label="Promote to ${p}"><img src="${this.loaded.base}${this.loaded.theme.pieces.folder}/${c}${p.toUpperCase()}.${this.loaded.theme.pieces.format}" alt=""></button>`,
      )
      .join('');
    box.hidden = false;
    return new Promise((resolve) => {
      box.onclick = (e) => {
        const btn = (e.target as HTMLElement).closest('button');
        if (!btn) return;
        box.hidden = true;
        resolve(btn.dataset.piece!);
      };
    });
  }
}
