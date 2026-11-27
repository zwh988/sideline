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
import { LANE_ARROW, LANE_COLOUR, drawChart, laneBadgeSvg } from './linechart';
import { LANE_NAME, LANES, LineTree, badgeOf, isCommon, verdictOf, type LineNode, type Option } from './linetree';
import { gameToPgn } from './pgn';
import { ImportDialog } from './import-dialog';
import { GameStore, newGameId, type SavedGame, type SavedMoment } from './store';
import { kindLabel, momentDot, momentUniverses, type Universe, reviewBarText, reviewIntro, reviewPrompt, sortedMoments, mergeAnalysis, moveLabels, turningPoints } from './review';
import { REVIEW_VERSION, reviewGame } from '../coach/review';
import { Game, resultOf, type Color } from './game';
import { LEVELS, levelInfo, levelLabel, type Level } from './levels';
import { MODES, PUZZLE, REVIEW, modeInfo, type Mode, type ModeId } from './modes';
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

type ColorChoice = Color | 'random';

interface Settings {
  level: number;
  color: ColorChoice;
  mode: ModeId;
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
  const glyph = MARK_GLYPH[m.kind];
  const size = glyph.length > 1 ? 26 : 32;
  return {
    orig: m.square as Key,
    customSvg: {
      html: `<g class="mark-badge"><circle cx="72" cy="28" r="26" fill="${MARK_COLOUR[m.kind]}" stroke="var(--on-accent)" stroke-width="4"/><text x="72" y="${glyph.length > 1 ? 37 : 39}" text-anchor="middle" font-size="${size}" font-weight="800" font-family="system-ui,sans-serif" fill="var(--on-accent)">${glyph}</text></g>`,
      center: 'orig',
    },
  };
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
};

type Screen = 'play' | 'review' | 'settings' | 'puzzles';

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
          <p id="history-note" class="history-note" aria-live="polite">Saved on this device only.</p>
          <ol id="history-list" class="history-list"></ol>
          <div class="history-foot">
            <button id="import-open">Import games</button>
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
          <ol id="moves" class="moves"></ol>
        </aside>
      </main>`;

    for (const id of ['board', 'promotion', 'bubble', 'bubble-box', 'mood', 'portrait', 'choices', 'status', 'moves', 'level', 'mode', 'color', 'takeback', 'hint', 'board-area', 'viewbar', 'viewtext', 'nav-start', 'nav-back', 'nav-forward', 'nav-live', 'back-to-game', 'cap-top', 'cap-bottom', 'board-note', 'more', 'more-menu', 'ask', 'ask-menu', 'sideline', 'sideline-bar', 'chart', 'chart-wrap', 'sideline-arrows', 'sideline-undo', 'sideline-exit', 'history', 'history-open', 'history-close', 'history-note', 'history-list', 'rail-play', 'rail-settings', 'menu-play', 'menu-review', 'menu-settings', 'newgame', 'ng-level', 'ng-mode', 'ng-color', 'ng-cancel', 'ng-start', 'settings-screen', 'settings-close', 'review-bar', 'review-text', 'review-strip', 'review-dots', 'review-timeline', 'review-next', 'review-exit', 'import-open', 'backup', 'restore', 'restore-file', 'rail-puzzles', 'menu-puzzles', 'puzzles-screen', 'puzzles-close', 'puzzles-note', 'puzzles-list', 'puzzle-bar', 'puzzle-text', 'puzzle-skip', 'puzzle-exit']) {
      this.el[id] = this.root.querySelector(`#${id}`)!;
    }
    const level = this.el.level as HTMLSelectElement;
    const mode = this.el.mode as HTMLSelectElement;
    const color = this.el.color as HTMLSelectElement;
    level.value = String(this.settings.level);
    mode.value = this.settings.mode;
    color.value = this.settings.color;

    level.addEventListener('change', () => this.updateSettings({ level: Number(level.value) }));
    mode.addEventListener('change', () => this.updateSettings({ mode: modeInfo(mode.value).id }));
    color.addEventListener('change', () => this.updateSettings({ color: color.value as ColorChoice }));
    // A long coach remark opens on a tap (phones).
    this.el['bubble-box'].addEventListener('click', () => this.root.querySelector('.coach')!.classList.toggle('expanded'));
    this.root.querySelector('#new-game')!.addEventListener('click', () => this.openNewGameSheet());
    this.el['ng-cancel'].addEventListener('click', () => (this.el.newgame as HTMLDialogElement).close());
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
    for (const [id, screen] of [['rail-play', 'play'], ['rail-puzzles', 'puzzles'], ['history-open', 'review'], ['rail-settings', 'settings'], ['menu-play', 'play'], ['menu-puzzles', 'puzzles'], ['menu-review', 'review'], ['menu-settings', 'settings']] as const) {
      this.el[id].addEventListener('click', () => (screen === 'play' && this.puzzling ? void this.backToGame() : this.showScreen(screen)));
    }
    this.el['settings-close'].addEventListener('click', () => this.showScreen('play'));
    this.el.history.addEventListener('close', () => this.railCurrent());
    this.el['settings-screen'].addEventListener('close', () => this.railCurrent());
    this.el['puzzles-screen'].addEventListener('close', () => this.railCurrent());
    this.el['puzzles-close'].addEventListener('click', () => this.showScreen('play'));
    this.el['puzzles-list'].addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('button[data-continue]')) return void this.continuePuzzle();
      const pick = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-pick]');
      if (pick) {
        this.puzzlePick = Number(pick.dataset.pick);
        this.renderPuzzlesScreen();
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
  }

  /** Switches screen: Play is the game itself; Game review and Settings are full screens over it (not modal, so the rail stays usable). */
  private showScreen(screen: Screen): void {
    const history = this.el.history as HTMLDialogElement;
    const settings = this.el['settings-screen'] as HTMLDialogElement;
    const puzzles = this.el['puzzles-screen'] as HTMLDialogElement;
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
      settings.show();
    }
    this.railCurrent();
  }

  /** Marks the rail item of the screen that is open. */
  private railCurrent(): void {
    const open = (id: string) => (this.el[id] as HTMLDialogElement).open;
    const screen = open('history') ? 'history-open' : open('settings-screen') ? 'rail-settings' : open('puzzles-screen') || this.puzzling ? 'rail-puzzles' : 'rail-play';
    for (const id of ['rail-play', 'rail-puzzles', 'history-open', 'rail-settings']) {
      if (id === screen) this.el[id].setAttribute('aria-current', 'page');
      else this.el[id].removeAttribute('aria-current');
    }
  }

  /** Starts a new game, or (with `resume`) carries on a saved one exactly where it stopped. */
  private async newGame(resume?: SavedGame): Promise<void> {
    this.parkPuzzle();
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
      this.say({ kind: 'phase', text: `Let's play! You're ${side}, so you go first.`, mood: 'neutral' });
      await this.startPlayerTurn(id);
    } else {
      this.say({ kind: 'phase', text: `Let's play! You're ${side}, so I'll start.`, mood: 'neutral' });
      await this.opponentMove(id);
    }
  }

  /** Writes the game in progress to this device (nothing is saved before the first move). */
  private save(): void {
    const r = this.record;
    if (!r || !this.game || this.reviewing || this.puzzling) return; // a reviewed game is saved only when a sideline is kept
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
    if (this.sideline) return this.renderSideline();
    this.board.set({ viewOnly: false });
    const view = nav.viewing ? g.positionAt(nav.ply) : undefined;
    const shown = view ?? { fen: g.fen, turn: g.turn, inCheck: g.inCheck, lastMove: g.lastMove };
    const last = shown.lastMove;
    // Viewing the past: the board is read-only.
    const canMove = !this.reviewing && !nav.viewing && g.isPlayerTurn && !g.result.over && !this.thinking && (!this.puzzling || this.puzzling.phase === 'solving');
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
    // In Review nothing is played in the game: a move of either side on the shown position opens a sideline with it.
    if (this.reviewing && !this.reviewing.analysing) {
      const dests = new LineTree(shown.fen, g.playerColor).dests;
      this.board.set({ movable: { color: shown.turn, dests: dests as Map<Key, Key[]> } });
    }
    this.renderMaterial(shown.fen);
    this.renderEndSignals(shown.fen, !nav.viewing && !this.reviewing && !this.puzzling && g.result.over);
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
    const cell = (c?: { san: string; ply: number }) =>
      !c ? '<span></span>' : c.ply === 0 ? `<span>${c.san}</span>` : `<button data-ply="${c.ply}" class="mv">${c.san}</button>`;
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
        p.textContent = text;
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
        p.textContent = node.reason.text;
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
      p.textContent = say.text;
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
      p.textContent = e.remark.text;
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

  /** Shows the coach of a tier: its name, and its theme pack (board, pieces, accent, portraits). */
  private async showCoach(level: Level): Promise<void> {
    const token = ++this.coachToken;
    for (const el of this.root.querySelectorAll('.js-coach-name')) el.textContent = level.coach.name;
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
    if (r.winner === this.game.playerColor) this.say({ kind: 'praise', text: 'Checkmate. You win, well played!', mood: 'pleased' });
    else if (r.winner) {
      const next = this.mode.takebacks ? 'Take back to see what happened, or start a new game.' : 'Start a new game when you’re ready.';
      this.say({ kind: 'phase', text: `Checkmate, I win this one. ${next}`, mood: 'concerned' });
    }
    else this.say({ kind: 'phase', text: `It's a draw by ${r.reason}.`, mood: 'neutral' });
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
    const labels = moveLabels(saved);
    const turning = turningPoints(saved.curve).map((t) => labels[t.ply - 1]);
    this.reviewing = { moments, index: -1, opponent, curve: saved.curve, say: { ply: 0, text: reviewIntro(moments.length, opponent, turning, gameSummary(saved)), offerAnswer: false } };
    const level = levelInfo(saved.level);
    // A game played against a coach is reviewed by that coach; an imported game by the current tier's coach.
    void this.showCoach(saved.imported ? levelInfo(this.settings.level) : level);
    this.coach = Promise.all([this.analyst, this.book]).then(([a, book]) => new Coach(a, level, saved.playerColor === 'white' ? 'w' : 'b', REVIEW, book));
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
          level: levelInfo(saved.level),
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
      const labels = moveLabels(saved);
      r.moments = sortedMoments(saved);
      r.index = -1;
      r.curve = saved.curve;
      this.log.clear();
      for (const e of saved.remarks) this.log.add(e.ply, e.remark);
      r.say = { ply: 0, text: reviewIntro(r.moments.length, r.opponent, turningPoints(saved.curve).map((t) => labels[t.ply - 1]), gameSummary(saved)), offerAnswer: false };
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

  /** The timeline: one dot per moment, marked like the board's badges; a dot opens that moment with the question first. */
  private renderDots(r: { moments: SavedMoment[]; index: number }, busy: boolean): void {
    const box = this.el['review-dots'];
    const curve = this.reviewing?.curve;
    box.hidden = !r.moments.length || !curve || curve.length < 2;
    const scale = curve && curve.length > 1 ? timelineScale(curve) : undefined;
    box.replaceChildren(
      ...r.moments.map((m, i) => {
        const dot = momentDot(m);
        const b = document.createElement('button');
        b.type = 'button';
        b.className = `dot ${dot.tone}${i === r.index ? ' current' : ''}`;
        b.textContent = dot.glyph;
        if (scale && curve) {
          // On the evaluation line, where the move of the moment left it.
          b.style.left = `${(scale.x(m.ply) / TIMELINE_W) * 100}%`;
          b.style.top = `${(scale.y(curve[m.ply] ?? 0) / TIMELINE_H) * 100}%`;
        }
        b.disabled = busy;
        const label = moveLabels(this.record!)[m.ply - 1];
        b.setAttribute('aria-label', `Moment ${i + 1} of ${r.moments.length}: ${kindLabel(m)}, ${label}`);
        b.title = `${label} · ${kindLabel(m)}`;
        if (i === r.index) b.setAttribute('aria-current', 'true');
        b.addEventListener('click', () => this.gotoMoment(i));
        return b;
      }),
    );
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
  }

  private renderHistory(): void {
    const games = this.store.list();
    const list = this.el['history-list'];
    list.replaceChildren();
    if (!games.length) {
      const li = document.createElement('li');
      li.className = 'history-empty';
      li.textContent = 'No games yet. Play a move with the coach, or import your games from Chess.com or Lichess, and they show up here to review.';
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
      if (g.imported) {
        const im = g.imported;
        const opponent = g.playerColor === 'white' ? im.black : im.white;
        const result = !g.result ? 'unfinished' : g.result.winner ? (g.result.winner === g.playerColor ? 'you won' : 'you lost') : 'draw';
        title.textContent = `${date} · ${side} vs ${opponent}`;
        chip.textContent = result;
        chip.classList.toggle('win', result === 'you won');
        chip.classList.toggle('loss', result === 'you lost');
        meta.textContent = `${moveCount}${moments}${takebacks}`;
      } else {
        const result = !g.result ? (g.id === this.record?.id ? 'in progress' : 'unfinished') : g.result.winner ? (g.result.winner === g.playerColor ? 'you won' : 'coach won') : 'draw';
        title.textContent = `${date} · ${side}`;
        chip.textContent = result;
        chip.classList.toggle('win', result === 'you won');
        chip.classList.toggle('loss', result === 'coach won');
        meta.textContent = `Tier ${g.level} · ${levelInfo(g.level).coach.name} · ${modeInfo(g.mode).name} · ${moveCount}${moments}${takebacks}`;
      }
      const buttons = document.createElement('div');
      buttons.className = 'history-buttons';
      buttons.hidden = true;
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
      more.setAttribute('aria-expanded', 'false');
      const tag = document.createElement('span');
      tag.className = 'h-source';
      tag.textContent = g.imported ? { pgn: 'Pasted', 'chess.com': 'Chess.com', lichess: 'Lichess' }[g.imported.source] : 'With the coach';
      main.append(title, chip);
      card.append(main, meta, tag);
      const row = document.createElement('div');
      row.className = 'h-row';
      row.append(card, more);
      li.append(row, buttons);
      list.append(li);
    }
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
    const data = { ...this.store.exportAll(), puzzles: this.puzzleResults.all(), puzzleLevels: this.puzzleResults.allLevels() };
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
    const face = (l: Level, size: 'sm' | 'lg') => {
      const d = document.createElement('div');
      d.className = `p-face ${size}`;
      d.innerHTML = faceSvg('neutral');
      // The coach's own portrait and accent, without switching the page's theme.
      void fetchTheme(l.theme).then((t) => {
        d.style.setProperty('--p-accent', t.theme.coach.accent);
        d.style.setProperty('--p-soft', t.theme.coach.accentSoft ?? t.theme.coach.accent);
        const url = portraitUrl(t, size === 'lg' ? 'pleased' : 'neutral');
        if (url) d.innerHTML = `<img src="${url}" alt="">`;
      }).catch(() => undefined);
      return d;
    };

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
      name.textContent = l.level === mine ? `${l.coach.name} ★` : l.coach.name;
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
    this.say({ kind: 'praise', text: words.text + hinted, mood: 'pleased', marks: [{ square: last.slice(2, 4) as Square, kind: 'good' }] });
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
    const badgeMark: DrawShape[] = badge ? [markShape({ square: cur.uci.slice(2, 4) as Square, kind: badge === '!' ? 'good' : badge === '?' ? 'bad' : 'blunder' })] : [];
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
