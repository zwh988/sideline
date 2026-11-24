// The game screen: board, coach bubble, move list and controls.
// The coach speaks only when its rules say so (src/coach/coach.ts); the
// status line under the bubble carries routine game information.
import { Chessground } from '@lichess-org/chessground';
import type { Api } from '@lichess-org/chessground/api';
import type { DrawShape } from '@lichess-org/chessground/draw';
import type { Key } from '@lichess-org/chessground/types';
import type { Square } from 'chess.js';
import { Analyst } from '../coach/analyst';
import { loadOpeningBook, openingBookIfLoaded, type OpeningBook } from '../coach/openings';
import { Coach, joinRemarks, type Remark, type Shape } from '../coach/coach';
import { Branch } from './branches';
import { gameToPgn } from './pgn';
import { ImportDialog } from './import-dialog';
import { GameStore, newGameId, type SavedGame, type SavedMoment } from './store';
import { momentUniverses, type Universe, reviewBarText, reviewIntro, reviewPrompt, sortedMoments, mergeAnalysis, moveLabels, turningPoints } from './review';
import { reviewGame } from '../coach/review';
import { Game, type Color } from './game';
import { LEVELS, levelInfo } from './levels';
import { MODES, REVIEW, modeInfo, type Mode, type ModeId } from './modes';
import { balanceText, materialOf } from './material';
import { Navigation, RemarkLog, plyLabel } from './navigation';
import { createOpponent, type Opponent } from './opponent';
import type { Theme } from './theme';

type ColorChoice = Color | 'random';

interface Settings {
  level: number;
  color: ColorChoice;
  mode: ModeId;
}

const SETTINGS_KEY = 'sideline.settings';
const COACH_NAME = 'Coach';
const MIN_THINK_MS = 600; // the coach shouldn't reply instantly

function loadSettings(): Settings {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? 'null');
    if (saved && typeof saved.level === 'number') return { ...saved, mode: modeInfo(saved.mode).id };
  } catch {
    /* storage unavailable: use defaults */
  }
  return { level: 2, color: 'white', mode: 'lesson' };
}

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
  /** The sideline the player is trying, if any ("Try a sideline"): one level, the game is paused. */
  private sideline?: Branch;
  /** Resolves the wait for the sideline to be closed (used by "Show me" after a mistake). */
  private onSidelineClosed?: () => void;
  /** Bumped whenever the sideline changes, so a late engine reply for an old state is dropped. */
  private sidelineToken = 0;
  /** True while the coach picks its reply in the sideline. */
  private sidelineBusy = false;
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
  /** Universes: the lines a sideline starts with (a Review moment's), the forks taken, and the chips shown now. */
  private rootUniverses: Universe[] = [];
  private forks = 0;
  private universeKey = '';
  /** At most this many forks per sideline, so the screen stays readable. */
  private static readonly MAX_FORKS = 3;
  /** The game ply a sideline started from (a sideline can start from an earlier viewed position). */
  private sidelinePly = 0;

  constructor(
    private root: HTMLElement,
    private theme: Theme,
    private themeBase: string,
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
      <header class="top">
        <h1>Sideline</h1>
        <div class="controls">
          <div id="settings" class="settings">
          <label>Level
            <select id="level">${LEVELS.map(
              (l) => `<option value="${l.level}">${l.level} · Chess.com ${l.chessCom}</option>`,
            ).join('')}</select>
          </label>
          <label>Mode
            <select id="mode">${MODES.map((m) => `<option value="${m.id}">${m.name}</option>`).join('')}</select>
          </label>
          <label>Play as
            <select id="color">
              <option value="white">White</option>
              <option value="black">Black</option>
              <option value="random">Random</option>
            </select>
          </label>
          </div>
          <button id="new-game">New game</button>
          <button id="history-open">History</button>
          <button id="settings-toggle" class="settings-toggle" aria-expanded="false" aria-controls="settings">Settings</button>
        </div>
      </header>
      <main class="layout">
        <div id="board-area" class="board-area">
          <div class="board-stack">
            <div id="board" class="cg-wrap"></div>
            <div id="promotion" class="promotion" hidden></div>
          </div>
          <p id="material" class="material" aria-label="Captured material"></p>
          <div class="nav" role="group" aria-label="Move navigation">
            <button id="nav-start" aria-label="First position">«</button>
            <button id="nav-back" aria-label="Previous move">‹</button>
            <button id="nav-forward" aria-label="Next move">›</button>
            <button id="nav-live" aria-label="Latest position">»</button>
          </div>
          <div id="sideline-bar" class="sidelinebar" hidden>
            <p class="sideline-title">Sideline · nothing here changes your game</p>
            <p id="sideline-line" class="sideline-line"></p>
            <div id="sideline-universes" class="universes" aria-label="Other universes from here"></div>
            <div class="sideline-buttons">
              <button id="sideline-undo">Undo</button>
              <button id="sideline-good">Show what's good</button>
              <button id="sideline-exit" class="primary">Back to game</button>
            </div>
          </div>
          <div id="review-bar" class="viewbar reviewbar" hidden>
            <span id="review-text"></span>
            <svg id="review-strip" class="review-strip" viewBox="0 0 300 44" preserveAspectRatio="none" role="img" aria-label="The evaluation through the game. Tap to jump to a move." hidden></svg>
            <div class="review-buttons">
              <button id="review-prev">‹ Moment</button>
              <button id="review-next">Moment ›</button>
              <button id="review-exit" class="primary">Back to my game</button>
            </div>
          </div>
          <div id="viewbar" class="viewbar" hidden>
            <span id="viewtext"></span>
            <button id="back-to-game" class="primary">Back to game</button>
          </div>
        </div>
        <dialog id="history" class="history" aria-label="Your games">
          <div class="history-head"><h2>Your games</h2><button id="history-close">Close</button></div>
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
            <div id="portrait" class="portrait" aria-hidden="true">
              <span class="initial">${COACH_NAME[0]}</span>
            </div>
            <div id="bubble-box" class="bubble">
              <div class="coach-name">${COACH_NAME} <span id="mood" class="mood"></span></div>
              <div id="bubble" class="log" aria-live="polite"></div>
            </div>
          </div>
          <div id="choices" class="choices" hidden></div>
          <p id="status" class="status"></p>
          <div class="actions">
            <button id="hint">Hint</button>
            <button id="sideline">Try a sideline</button>
            <button id="takeback">Take back</button>
            <button id="flip">Flip board</button>
          </div>
          <ol id="moves" class="moves"></ol>
          <p class="credits">${this.theme.credits ?? ''}</p>
        </aside>
      </main>`;

    for (const id of ['board', 'promotion', 'bubble', 'bubble-box', 'mood', 'portrait', 'choices', 'status', 'moves', 'level', 'mode', 'color', 'takeback', 'hint', 'board-area', 'viewbar', 'viewtext', 'nav-start', 'nav-back', 'nav-forward', 'nav-live', 'back-to-game', 'material', 'sideline', 'sideline-bar', 'sideline-line', 'sideline-universes', 'sideline-undo', 'sideline-good', 'sideline-exit', 'history', 'history-open', 'history-close', 'history-note', 'history-list', 'settings-toggle', 'review-bar', 'review-text', 'review-strip', 'review-prev', 'review-next', 'review-exit', 'import-open', 'backup', 'restore', 'restore-file']) {
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
    // Phones: the level, mode and colour sit behind a Settings button, and a long coach remark opens on a tap.
    this.el['settings-toggle'].addEventListener('click', () => {
      const open = this.root.querySelector('.top')!.classList.toggle('open');
      this.el['settings-toggle'].setAttribute('aria-expanded', String(open));
    });
    this.el['bubble-box'].addEventListener('click', () => this.root.querySelector('.coach')!.classList.toggle('expanded'));
    this.root.querySelector('#new-game')!.addEventListener('click', () => void this.newGame());
    this.root.querySelector('#flip')!.addEventListener('click', () => this.board.toggleOrientation());
    this.el.takeback.addEventListener('click', () => void this.takeback());
    this.el.hint.addEventListener('click', () => void this.hint());
    this.el['history-open'].addEventListener('click', () => this.openHistory());
    this.el['history-close'].addEventListener('click', () => (this.el.history as HTMLDialogElement).close());
    this.el['history-list'].addEventListener('click', (e) => this.onHistoryClick(e));
    this.el['import-open'].addEventListener('click', () => {
      (this.el.history as HTMLDialogElement).close();
      this.importDialog.open();
    });
    this.el['review-prev'].addEventListener('click', () => this.stepMoment(-1));
    this.el['review-next'].addEventListener('click', () => this.stepMoment(1));
    this.el['review-exit'].addEventListener('click', () => void this.exitReview());
    this.el.backup.addEventListener('click', () => this.backup());
    this.el.restore.addEventListener('click', () => this.el['restore-file'].click());
    this.el['restore-file'].addEventListener('change', () => void this.restore());
    this.el.sideline.addEventListener('click', () => this.startSideline());
    this.el['sideline-undo'].addEventListener('click', () => this.sidelineUndo());
    this.el['sideline-good'].addEventListener('click', () => void this.showGood());
    this.el['sideline-exit'].addEventListener('click', () => this.exitSideline());

    this.importDialog = new ImportDialog(this.root, {
      store: this.store,
      level: () => this.settings.level,
      createAnalyst: () => Analyst.create(),
      onChange: () => this.renderHistory(),
    });

    this.el['nav-start'].addEventListener('click', () => this.navigate(() => this.nav.start()));
    this.el['nav-back'].addEventListener('click', () => this.navigate(() => this.nav.back()));
    this.el['nav-forward'].addEventListener('click', () => this.navigate(() => this.nav.forward()));
    this.el['nav-live'].addEventListener('click', () => this.navigate(() => this.nav.goLive()));
    this.el['back-to-game'].addEventListener('click', () => this.navigate(() => this.nav.goLive()));
    this.el.moves.addEventListener('click', (e) => {
      const cell = (e.target as HTMLElement).closest<HTMLElement>('[data-ply]');
      if (cell) this.navigate(() => this.nav.goTo(Number(cell.dataset.ply)));
    });
    document.addEventListener('keydown', (e) => this.onKey(e));

    this.board = Chessground(this.el.board, {
      coordinates: true,
      animation: { duration: 200 },
      highlight: { lastMove: true, check: true },
      premovable: { enabled: false },
      draggable: { showGhost: true },
      movable: {
        free: false,
        showDests: true,
        events: { after: (orig, dest) => void this.onPlayerMove(orig as Square, dest as Square) },
      },
    });
  }

  private updateSettings(change: Partial<Settings>): void {
    this.settings = { ...this.settings, ...change };
    saveSettings(this.settings);
    if (change.level !== undefined) this.status('New level set. It applies from your next game.');
    if (change.mode !== undefined) this.status(`${modeInfo(change.mode).name} mode set. It applies from your next game.`);
  }

  /** Starts a new game, or (with `resume`) carries on a saved one exactly where it stopped. */
  private async newGame(resume?: SavedGame): Promise<void> {
    const id = ++this.gameId;
    this.reviewing?.abort?.abort();
    this.reviewing = undefined;
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
    if (!r || !this.game || this.reviewing) return; // a reviewed game is saved only when a sideline is kept
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
    if (this.sideline) return this.renderSideline();
    this.board.set({ viewOnly: false });
    const view = nav.viewing ? g.positionAt(nav.ply) : undefined;
    const shown = view ?? { fen: g.fen, turn: g.turn, inCheck: g.inCheck, lastMove: g.lastMove };
    const last = shown.lastMove;
    // Viewing the past: the board is read-only.
    const canMove = !this.reviewing && !nav.viewing && g.isPlayerTurn && !g.result.over && !this.thinking;
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
    this.renderMaterial(shown.fen);
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
    const white = this.game.playerColor === 'white';
    const mine = white ? m.lostByBlack : m.lostByWhite; // what I captured
    const theirs = white ? m.lostByWhite : m.lostByBlack;
    this.el.material.textContent = `You took ${mine || '–'} · ${this.reviewing ? 'Opponent' : 'Coach'} took ${theirs || '–'} · ${balanceText(m.balance, white ? 'w' : 'b')}`;
  }

  private shapesAt(ply: number): DrawShape[] {
    return this.log
      .at(ply)
      .flatMap((e) => e.remark.shapes ?? [])
      .map(drawShape);
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
      return; // no move navigation in a sideline
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
      // In a sideline the bubble shows what the coach said there, not the game's log.
      bubble.replaceChildren(
        ...sideline.notes.slice(-6).map((text, i, all) => {
          const p = document.createElement('p');
          p.className = i < all.length - 1 ? 'entry old' : 'entry';
          p.textContent = text;
          return p;
        }),
      );
      this.el.mood.textContent = '';
      this.el.portrait.dataset.mood = 'neutral';
      bubble.scrollTop = bubble.scrollHeight;
      return;
    }
    const say = this.reviewing?.say;
    if (say && say.ply === nav.ply) {
      const p = document.createElement('p');
      p.className = 'entry';
      p.textContent = say.text;
      bubble.replaceChildren(p);
      this.el.mood.textContent = '';
      this.el.portrait.dataset.mood = 'thinking';
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
    this.el.portrait.dataset.mood = newest?.mood ?? 'neutral';
    bubble.scrollTop = nav.viewing ? 0 : bubble.scrollHeight;
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
      this.board.setAutoShapes((r.shapes ?? []).map(drawShape));
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
      if (remark.offerSideline && this.mode.prompts && this.mode.sidelines) this.offerSideline();
    }
  }

  private async onPlayerMove(from: Square, to: Square): Promise<void> {
    if (this.sideline) return this.onSidelineMove(from, to);
    const id = this.gameId;
    let promotion = '';
    if (this.game.isPromotion(from, to)) {
      promotion = await this.askPromotion(this.game.playerColor);
      if (id !== this.gameId) return;
    }
    this.el.choices.hidden = true;
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
      if (remark.offerTakeback && this.mode.takebacks) {
        choice = await this.askTakeback();
        // "Show me": the coach plays its answer in a sideline; afterwards the choice is offered again.
        while (choice === 'show') {
          if (moment) moment.showedMe = true;
          await this.openSideline(this.game.fen, 'Here is what I would play. Nothing here changes your game; tap Back to game when you are ready.');
          if (this.stale(id, ply)) return;
          choice = await this.askTakeback();
        }
        if (moment) moment.outcome = choice === 'takeback' ? 'taken-back' : 'played-on';
      }
      if (choice === 'takeback') {
        if (this.stale(id, ply)) return;
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
    this.status('Game over.');
    this.thinking = false;
    this.sync();
    return true;
  }

  /** After a takeback: sidelines from positions that no longer exist are dropped. */
  private pruneSidelines(): void {
    if (this.record) this.record.sidelines = this.record.sidelines.filter((x) => x.ply <= this.game.moves.length);
  }

  private async takeback(): Promise<void> {
    if (this.sideline || this.thinking || this.nav.viewing || !this.mode.takebacks || !this.game.takeback()) return;
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
    ++this.gameId; // drops whatever the live game was waiting for
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
    this.reviewing = { moments, index: -1, opponent, curve: saved.curve, say: { ply: 0, text: reviewIntro(moments.length, opponent, turning), offerAnswer: false } };
    const level = levelInfo(saved.level);
    this.coach = Promise.all([this.analyst, this.book]).then(([a, book]) => new Coach(a, level, saved.playerColor === 'white' ? 'w' : 'b', REVIEW, book));
    this.nav.reset(game.moves.length);
    this.nav.start();
    this.log.clear();
    for (const e of saved.remarks) this.log.add(e.ply, e.remark);
    this.viewShapes = false;
    this.board.set({ orientation: saved.playerColor, lastMove: undefined });
    this.board.setAutoShapes([]);
    this.el.choices.hidden = true;
    this.status('Reviewing a saved game.');
    this.sync();
    // Review looks at the whole game once, both sides, every pattern (task 1.7e); older records get it now.
    if (!saved.curve) void this.analyseForReview(saved);
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
      r.say = { ply: 0, text: reviewIntro(r.moments.length, r.opponent, turningPoints(saved.curve).map((t) => labels[t.ply - 1])), offerAnswer: false };
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

  /** Goes to the next or previous moment: the position before the move, with the question. */
  private stepMoment(delta: number): void {
    const r = this.reviewing;
    if (!r || this.sideline || !r.moments.length) return;
    r.index = Math.min(Math.max(r.index + delta, 0), r.moments.length - 1);
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
    const busy = r.analysing;
    this.el['review-text'].textContent = busy
      ? `Looking at the game… move ${busy.done} of ${busy.total}`
      : reviewBarText(r.index, r.moments.length, revealed, m);
    (this.el['review-prev'] as HTMLButtonElement).disabled = !!busy || r.index <= 0;
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
    } else if (revealed && !this.sideline) {
      // The drill: after the answer, see the engine's line played out, or try the position yourself.
      box.innerHTML = `${m.line?.length ? '<button data-choice="line" class="primary">Show the line</button>' : ''}<button data-choice="try">Try it yourself</button>`;
      box.hidden = false;
      box.onclick = (e) => {
        const choice = (e.target as HTMLElement).closest('button')?.dataset.choice;
        if (choice === 'line') void this.showMomentLine(m);
        else if (choice === 'try') void this.openSideline(m.fen, 'Try your idea from here. Nothing here changes your game.', m.ply - 1, undefined, momentUniverses(m));
      };
    } else if (!this.sideline) {
      box.hidden = true;
    }
  }

  /** The evaluation through the game, White's view, with the moments marked and the position shown. Tap to jump. */
  private renderStrip(): void {
    const r = this.reviewing;
    const strip = this.el['review-strip'] as unknown as SVGElement;
    const curve = r?.curve;
    strip.toggleAttribute('hidden', !r || !curve || curve.length < 3);
    if (!r || !curve || curve.length < 3) return;
    const W = 300;
    const H = 44;
    const x = (ply: number) => (ply / (curve.length - 1)) * W;
    const y = (cp: number) => H / 2 - (cp / 1000) * (H / 2 - 2);
    const mid = `<line x1="0" y1="${H / 2}" x2="${W}" y2="${H / 2}" class="strip-mid"/>`;
    const area = `<polygon points="0,${H / 2} ${curve.map((cp, i) => `${x(i).toFixed(1)},${y(cp).toFixed(1)}`).join(' ')} ${W},${H / 2}" class="strip-area"/>`;
    const line = `<polyline points="${curve.map((cp, i) => `${x(i).toFixed(1)},${y(cp).toFixed(1)}`).join(' ')}" class="strip-line"/>`;
    const marks = r.moments
      .map((m, i) => {
        const kind = m.kind === 'mistake' || m.kind === 'missed-tactic' ? 'bad' : m.kind === 'found-tactic' ? 'good' : 'theirs';
        return `<line x1="${x(m.ply).toFixed(1)}" y1="0" x2="${x(m.ply).toFixed(1)}" y2="${H}" class="strip-mark ${kind}${i === r.index ? ' current' : ''}"/>`;
      })
      .join('');
    const here = `<line x1="${x(this.nav.ply).toFixed(1)}" y1="0" x2="${x(this.nav.ply).toFixed(1)}" y2="${H}" class="strip-here"/>`;
    strip.innerHTML = mid + area + line + marks + here;
    strip.onclick = (e) => {
      if (this.sideline) return;
      const box = strip.getBoundingClientRect();
      const ply = Math.round(((e.clientX - box.left) / box.width) * (curve.length - 1));
      this.navigate(() => this.nav.goTo(Math.max(0, Math.min(curve.length - 1, ply))));
    };
  }

  /** "Show the line": a sideline from the position before the moment, with the engine's better line played out. */
  private async showMomentLine(m: SavedMoment): Promise<void> {
    if (!m.line?.length || this.sideline) return;
    const fresh = m.kind === 'mistake' || m.kind === 'missed-tactic' ? 'Here is the line the engine preferred.' : 'Here is the line.';
    await this.openSideline(m.fen, `${fresh} Nothing here changes your game.`, m.ply - 1, m.line, momentUniverses(m));
  }

  // --- Saved games: history, PGN and backup ------------------------------

  private openHistory(): void {
    this.save(); // the game in progress shows up with its latest moves
    this.renderHistory();
    this.el['history-note'].textContent = 'Saved on this device only. Back up to move them elsewhere.';
    (this.el.history as HTMLDialogElement).showModal();
  }

  private renderHistory(): void {
    const games = this.store.list();
    const list = this.el['history-list'];
    list.replaceChildren();
    if (!games.length) {
      const li = document.createElement('li');
      li.className = 'history-empty';
      li.textContent = 'No games yet. Play a move and it is saved here.';
      list.append(li);
      return;
    }
    for (const g of games) {
      const li = document.createElement('li');
      li.dataset.id = g.id;
      const text = document.createElement('p');
      const date = new Date(g.startedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
      const moments = g.moments.length ? ` · ${g.moments.length} moment${g.moments.length === 1 ? '' : 's'}` : '';
      const moveCount = `${Math.ceil(g.moves.length / 2)} move${g.moves.length > 2 ? 's' : ''}${g.opening ? ` (${g.opening.name})` : ''}`;
      const side = g.playerColor === 'white' ? 'White' : 'Black';
      if (g.imported) {
        const im = g.imported;
        const opponent = g.playerColor === 'white' ? im.black : im.white;
        const result = !g.result ? 'unfinished' : g.result.winner ? (g.result.winner === g.playerColor ? 'you won' : 'you lost') : 'draw';
        const from = { pgn: 'pasted', 'chess.com': 'Chess.com', lichess: 'Lichess' }[im.source];
        text.textContent = `${date} · imported (${from}) · ${side} vs ${opponent} · ${moveCount} · ${result}${moments}`;
      } else {
        const result = !g.result ? (g.id === this.record?.id ? 'in progress' : 'unfinished') : g.result.winner ? (g.result.winner === g.playerColor ? 'you won' : 'coach won') : 'draw';
        text.textContent = `${date} · ${side} · level ${g.level} · ${modeInfo(g.mode).name} · ${moveCount} · ${result}${moments}`;
      }
      const buttons = document.createElement('div');
      buttons.className = 'history-buttons';
      for (const [action, label] of [['review', 'Review'], ['copy', 'Copy PGN'], ['download', 'Download PGN'], ['delete', 'Delete']] as const) {
        const b = document.createElement('button');
        b.dataset.action = action;
        b.textContent = label;
        buttons.append(b);
      }
      li.append(text, buttons);
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
    const data = this.store.exportAll();
    this.download(JSON.stringify(data), `sideline-backup-${new Date().toISOString().slice(0, 10)}.json`, 'application/json');
    this.el['history-note'].textContent = `Backed up ${data.games.length} game${data.games.length === 1 ? '' : 's'} to a file.`;
  }

  private async restore(): Promise<void> {
    const input = this.el['restore-file'] as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    const note = this.el['history-note'];
    try {
      const result = this.store.importAll(JSON.parse(await file.text()));
      note.textContent = result ? `Restored ${result.added} game${result.added === 1 ? '' : 's'}; ${result.skipped} skipped (already here or unreadable).` : 'That file is not a Sideline backup.';
    } catch {
      note.textContent = 'That file could not be read.';
    }
    this.renderHistory();
  }

  // --- Try a sideline -----------------------------------------------------
  // The player plays a move or a short line on the board without committing.
  // The coach answers with Stockfish's best move (not the level-matched
  // opponent), and after each of the player's moves says whether it holds up
  // and names the concept, or says it can't. One level deep; the game is
  // paused and untouched. Lesson only.

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
    void this.openSideline(this.nav.viewing ? this.game.positionAt(this.nav.ply).fen : this.game.fen, undefined, this.nav.viewing ? this.nav.ply : this.game.moves.length);
  }

  /** Opens a sideline from `fen`. Resolves when the player goes back to the game. */
  private async openSideline(fen: string, intro?: string, ply = this.game.moves.length, autoLine?: string[], universes: Universe[] = []): Promise<void> {
    const sl = new Branch(fen, this.game.playerColor);
    if (sl.result.over) {
      this.status('The game is over here, so there is nothing to try.');
      return;
    }
    this.sideline = sl;
    this.rootUniverses = universes;
    this.forks = 0;
    this.universeKey = '';
    this.sidelinePly = ply;
    this.sidelineToken++;
    this.el.choices.hidden = true;
    this.board.setAutoShapes([]);
    sl.notes.push(
      intro ??
        (sl.isPlayerTurn
          ? 'Try a move and I will tell you what happens. Nothing here changes your game.'
          : 'Let me show you. Nothing here changes your game.'),
    );
    this.status('Trying a sideline.');
    const closed = new Promise<void>((resolve) => (this.onSidelineClosed = resolve));
    this.sync();
    if (autoLine?.length) void this.playLine(sl, this.sidelineToken, async () => (await this.coach).lineNotes(fen, autoLine));
    else if (!sl.isPlayerTurn) await this.sidelineReply(sl, undefined, true);
    return closed;
  }

  /** Back to the game, exactly as it was. */
  private exitSideline(): void {
    if (!this.sideline) return;
    const sl = this.sideline;
    // Kept with the game (as a PGN variation) when something was actually tried.
    if (sl.moves.length && this.record) {
      this.record.sidelines.push({
        ply: this.sidelinePly,
        rootFen: sl.rootFen,
        moves: sl.moves.map((m) => ({ uci: m.uci, san: m.san, mine: m.mine })),
      });
      if (this.reviewing) this.store.save(this.record);
    }
    this.sideline = undefined;
    this.sidelineToken++;
    this.sidelineBusy = false;
    this.board.setAutoShapes(this.shapesAt(this.nav.ply));
    this.sync();
    this.status('Back to the game.');
    this.onSidelineClosed?.();
    this.onSidelineClosed = undefined;
  }

  /** Takes back the player's last move in the sideline (and the coach's answer). */
  private sidelineUndo(): void {
    const sl = this.sideline;
    if (!sl || !sl.undo()) return;
    this.sidelineToken++;
    this.sidelineBusy = false;
    this.status('Try another move.');
    this.sync();
  }

  private async onSidelineMove(from: Square, to: Square): Promise<void> {
    const sl = this.sideline;
    if (!sl || this.sidelineBusy || !sl.isPlayerTurn) return;
    let token = this.sidelineToken;
    let promotion = '';
    if (sl.isPromotion(from, to)) {
      promotion = await this.askPromotion(this.game.playerColor);
      if (token !== this.sidelineToken) return;
    }
    const fenBefore = sl.fen;
    const move = sl.play(from + to + promotion);
    token = ++this.sidelineToken;
    this.sidelineBusy = true;
    this.sync();
    this.status('Thinking…');
    const coach = await this.coach;
    // The coach judges the move and picks its reply together (one engine search serves both).
    const playerLine = { rootFen: sl.rootFen, ucis: sl.moves.map((m) => m.uci) };
    const [remark] = await Promise.all([
      coach.judgeSidelineMove(fenBefore, move, playerLine),
      this.sidelineReply(sl, token),
      sleep(MIN_THINK_MS),
    ]);
    if (token !== this.sidelineToken || this.sideline !== sl) return;
    sl.notes.push(remark.text);
    // The coach's reply gets its words too (what it does, the concept, what it completes). A refuting reply
    // was already named by the verdict, so only a pay-off is added then.
    if (sl.moves.length > playerLine.ucis.length) {
      const reply = coach.describeSidelineMove({ rootFen: sl.rootFen, ucis: sl.moves.map((m) => m.uci) }, remark.mood === 'concerned');
      if (reply) sl.notes.push(reply);
    }
    this.renderBubble();
    this.sidelineEnded(sl);
  }

  /**
   * The coach's reply in a sideline: the engine's best move. Called with a
   * token when the player's move is being judged at the same time (that call
   * then plays the move and leaves the bubble to the judge).
   */
  private async sidelineReply(sl: Branch, token = ++this.sidelineToken, announce = false): Promise<void> {
    if (sl.result.over) {
      this.sidelineBusy = false;
      this.sync();
      return;
    }
    this.sidelineBusy = true;
    this.sync();
    this.status('Thinking…');
    let uci: string | undefined;
    try {
      const coach = await this.coach;
      uci = await coach.sidelineReply(sl.fen);
    } catch {
      /* engine trouble: fall back below */
    }
    if (token !== this.sidelineToken || this.sideline !== sl) return; // left or changed meanwhile
    this.sidelineBusy = false;
    const legal = [...sl.dests].flatMap(([f, ts]) => ts.map((t) => f + t));
    const reply = uci && legal.includes(uci.slice(0, 4)) ? uci : legal[0];
    const fenBefore = sl.fen;
    const move = sl.play(reply);
    // The coach says what it plays when it moves first ("Show me"); after the player's move the
    // judgement of that move is the remark, so the reply is only played.
    if (announce) sl.notes.push((await this.coach).describeSidelineReply(fenBefore, reply));
    this.sync();
    this.status(`I played ${move.san}.${sl.inCheck ? ' Check!' : ''} Your move.`);
    this.sidelineEnded(sl, true);
  }

  /** Says so when the line has ended: a board fact (mate or a draw). `byCoach`: the coach just moved. */
  private sidelineEnded(sl: Branch, byCoach = false): void {
    const r = sl.result;
    if (!r.over) return;
    // The player's own mate is announced by the judgement of that move.
    if (r.winner && r.winner !== this.game.playerColor) sl.notes.push('Checkmate: in this line I win.');
    else if (!r.winner) sl.notes.push(`This line ends in a draw by ${r.reason}.`);
    else if (byCoach) sl.notes.push('Checkmate: in this line you win.');
    this.status('The line is over. Undo a move or go back.');
    this.renderBubble();
  }

  /**
   * "Show what's good": the engine's best line from here, played out on the sideline's board one move at a
   * time with the words for each (what it wins, the concept, what it completes later), or a plain statement
   * that no pattern could be named. Undo takes it back.
   */
  private async showGood(): Promise<void> {
    const sl = this.sideline;
    if (!sl || this.sidelineBusy || sl.result.over) return;
    const token = ++this.sidelineToken;
    this.status('Looking for the best line…');
    await this.playLine(sl, token, async () => (await this.coach).bestLine(sl.fen));
  }

  /**
   * Plays a line on the sideline's board one move at a time, with the coach's note for each (and what the
   * line is up front). `get` supplies the line and its words; the sideline stays busy meanwhile.
   */
  private async playLine(
    sl: Branch,
    token: number,
    get: () => Promise<{ ucis: string[]; intro: string; notes: string[] } | undefined>,
  ): Promise<void> {
    this.sidelineBusy = true;
    this.sync();
    let best: Awaited<ReturnType<typeof get>>;
    try {
      best = await get();
    } catch {
      best = undefined;
    }
    if (token !== this.sidelineToken || this.sideline !== sl) return;
    if (!best) {
      this.sidelineBusy = false;
      this.status('I could not find a line here.');
      this.sync();
      return;
    }
    sl.notes.push(best.intro);
    this.renderBubble();
    for (let i = 0; i < best.ucis.length; i++) {
      await sleep(1200);
      if (token !== this.sidelineToken || this.sideline !== sl) return;
      try {
        sl.play(best.ucis[i]);
      } catch {
        break;
      }
      sl.notes.push(best.notes[i]);
      this.sync();
      if (sl.result.over) break;
    }
    this.sidelineBusy = false;
    this.sync();
    if (sl.result.over) return this.sidelineEnded(sl, true);
    this.status(sl.isPlayerTurn ? 'That is the line. Undo to try your own idea, or play on.' : 'That is the line.');
    if (!sl.isPlayerTurn) await this.sidelineReply(sl, token, true);
  }

  /** The board, banner and buttons for the open sideline. */
  private renderSideline(): void {
    const sl = this.sideline!;
    const last = sl.lastMove;
    const turn = sl.turn;
    const canMove = sl.isPlayerTurn && !sl.result.over && !this.sidelineBusy;
    this.board.set({
      fen: sl.fen,
      turnColor: turn,
      check: sl.inCheck ? turn : false,
      lastMove: last ? [last.from as Key, last.to as Key] : undefined,
      viewOnly: false,
      movable: { color: canMove ? this.game.playerColor : undefined, dests: canMove ? (sl.dests as Map<Key, Key[]>) : new Map() },
    });
    this.el['sideline-line'].textContent = sl.lineText || 'Make a move on the board.';
    (this.el['sideline-undo'] as HTMLButtonElement).disabled = !sl.moves.some((m) => m.mine) || this.sidelineBusy;
    (this.el['sideline-good'] as HTMLButtonElement).disabled = this.sidelineBusy || sl.result.over;
    this.el.viewbar.hidden = true;
    this.el['board-area'].classList.remove('viewing');
    for (const id of ['hint', 'sideline', 'takeback']) (this.el[id] as HTMLButtonElement).disabled = true;
    this.el.portrait.classList.toggle('busy', this.sidelineBusy);
    this.renderBubble();
    void this.refreshUniverses(sl);
  }

  // --- Universes: other ways the line could have gone -----------------------
  // Chips under the sideline: the moment's own universes (what happened, what the engine wanted) and,
  // after the coach's reply, "if they don't": the opponent's next-best real choices. A chip plays that
  // universe from its fork point with notes, and shows how the player punishes the deviation (or says
  // nothing is won). Every line is the engine's; at most MAX_FORKS forks per sideline.

  private async refreshUniverses(sl: Branch): Promise<void> {
    const box = this.el['sideline-universes'];
    const last = sl.moves.at(-1);
    const idle = !this.sidelineBusy && !sl.result.over;
    const key = `${sl.fen}|${idle}|${this.forks}`;
    if (key === this.universeKey) return;
    this.universeKey = key;
    box.replaceChildren();
    if (!idle) return;
    const chips: { label: string; title?: string; run: () => void }[] = this.rootUniverses.map((u) => ({
      label: u.label,
      run: () => void this.runUniverse(sl, u),
    }));
    if (last && !last.mine && sl.isPlayerTurn) {
      const idx = sl.moves.length - 1;
      try {
        const coach = await this.coach;
        const devs = await coach.deviations(sl.fenAt(idx), last.uci);
        if (this.sideline !== sl || this.universeKey !== key) return;
        for (const d of devs) {
          chips.push({ label: `If they play ${d.san}`, title: `The engine rates it ${(d.lossCp / 100).toFixed(1)} pawns worse for them than ${last.san}.`, run: () => void this.runDeviation(sl, idx, d.uci, d.san) });
        }
      } catch {
        /* no engine: only the moment's own universes */
      }
    }
    const capped = this.forks >= App.MAX_FORKS;
    for (const c of chips) {
      const b = document.createElement('button');
      b.textContent = c.label;
      if (c.title) b.title = c.title;
      b.disabled = capped;
      b.addEventListener('click', c.run);
      box.append(b);
    }
    if (capped && chips.length) {
      const p = document.createElement('p');
      p.className = 'universe-note';
      p.textContent = 'That is as many forks as fit on one board. Undo, or go back to the game.';
      box.append(p);
    }
  }

  /** A universe from the sideline's start: its line played out, with the coach's notes. */
  private async runUniverse(sl: Branch, u: Universe): Promise<void> {
    if (this.sideline !== sl || this.sidelineBusy) return;
    this.forks++;
    const token = ++this.sidelineToken;
    sl.truncate(0);
    this.universeKey = '';
    await this.playLine(sl, token, async () => {
      const r = (await this.coach).lineNotes(sl.rootFen, u.ucis, undefined, `${u.label}:`);
      return r;
    });
  }

  /** "If they play X": back to the fork, their other move, then how the player punishes it. */
  private async runDeviation(sl: Branch, index: number, uci: string, san: string): Promise<void> {
    if (this.sideline !== sl || this.sidelineBusy) return;
    this.forks++;
    const token = ++this.sidelineToken;
    sl.truncate(index);
    sl.play(uci);
    sl.notes.push(`If they play ${san} instead:`);
    this.universeKey = '';
    this.sync();
    await this.playLine(sl, token, async () => {
      const p = await (await this.coach).punishment(sl.fen);
      return p && { ...p, intro: p.wins ? p.intro : `That reply gives you nothing by force. ${p.intro}` };
    });
  }

  /** Shows "Take back" / "Play on" in the bubble and waits for a choice. */
  private askTakeback(): Promise<'takeback' | 'play-on' | 'show'> {
    const box = this.el.choices;
    box.innerHTML = `<button data-choice="takeback" class="primary">Take back</button><button data-choice="show">Show me</button><button data-choice="play-on">Play on</button>`;
    box.hidden = false;
    this.status('Take it back, or play on?');
    return new Promise((resolve) => {
      box.onclick = (e) => {
        const btn = (e.target as HTMLElement).closest('button');
        if (!btn) return;
        box.hidden = true;
        resolve(btn.dataset.choice as 'takeback' | 'play-on' | 'show');
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
          `<button data-piece="${p}" aria-label="Promote to ${p}"><img src="${this.themeBase}${this.theme.pieces.folder}/${c}${p.toUpperCase()}.${this.theme.pieces.format}" alt=""></button>`,
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
