// The game screen: board, coach bubble, move list and controls.
// The coach speaks only when its rules say so (src/coach/coach.ts); the
// status line under the bubble carries routine game information.
import { Chessground } from '@lichess-org/chessground';
import type { Api } from '@lichess-org/chessground/api';
import type { DrawShape } from '@lichess-org/chessground/draw';
import type { Key } from '@lichess-org/chessground/types';
import { Chess, SQUARES, type Square } from 'chess.js';
import { Analyst } from '../coach/analyst';
import { Coach, joinRemarks, type Remark, type Shape } from '../coach/coach';
import { Game, type Color } from './game';
import { LEVELS, levelInfo } from './levels';
import { MODES, modeInfo, type Mode, type ModeId } from './modes';
import { LineInput, MAX_LINE_MOVES, type Line, type LineMove, type TapResult } from './lines-input';
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
  /** The line being entered with tap-arrows (Explain mode), if any. Live position only. */
  private input?: LineInput;
  /** The line last explained, so the player can change it. */
  private lastLine?: Line;
  /** A rejected arrow, shown for a moment so the player sees why nothing happened. */
  private invalid?: { from: Square; to: Square };
  private el: Record<string, HTMLElement> = {};

  constructor(
    private root: HTMLElement,
    private theme: Theme,
    private themeBase: string,
  ) {
    this.render();
    this.analyst = Analyst.create();
    this.opponent = createOpponent(levelInfo(this.settings.level).maiaElo, (loaded, total) => {
      if (this.game.moves.length === 0 && total) this.status(`Getting ready… ${Math.round((loaded / total) * 100)}%`);
    });
    void this.newGame();
  }

  private render(): void {
    this.root.innerHTML = `
      <header class="top">
        <h1>Sideline</h1>
        <div class="controls">
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
          <button id="new-game">New game</button>
        </div>
      </header>
      <main class="layout">
        <div id="board-area" class="board-area">
          <div id="board" class="cg-wrap"></div>
          <div id="promotion" class="promotion" hidden></div>
          <div class="nav" role="group" aria-label="Move navigation">
            <button id="nav-start" aria-label="First position">«</button>
            <button id="nav-back" aria-label="Previous move">‹</button>
            <button id="nav-forward" aria-label="Next move">›</button>
            <button id="nav-live" aria-label="Latest position">»</button>
          </div>
          <div id="explain-bar" class="explainbar" hidden>
            <p id="explain-text" class="explain-text" aria-live="polite"></p>
            <div class="explain-buttons">
              <button id="explain-undo">Undo</button>
              <button id="explain-cancel">Cancel</button>
              <button id="explain-done" class="primary">Done</button>
            </div>
          </div>
          <div id="viewbar" class="viewbar" hidden>
            <span id="viewtext"></span>
            <button id="back-to-game" class="primary">Back to game</button>
          </div>
        </div>
        <aside class="side">
          <div class="coach">
            <div id="portrait" class="portrait" aria-hidden="true">
              <span class="initial">${COACH_NAME[0]}</span>
            </div>
            <div id="bubble-box" class="bubble">
              <div class="coach-name">${COACH_NAME} <span id="mood" class="mood"></span></div>
              <div id="bubble" class="log" aria-live="polite"></div>
              <div id="choices" class="choices" hidden></div>
            </div>
          </div>
          <p id="status" class="status"></p>
          <div class="actions">
            <button id="hint">Hint</button>
            <button id="explain">Show a line</button>
            <button id="takeback">Take back</button>
            <button id="flip">Flip board</button>
          </div>
          <ol id="moves" class="moves"></ol>
          <p class="credits">${this.theme.credits ?? ''}</p>
        </aside>
      </main>`;

    for (const id of ['board', 'promotion', 'bubble', 'bubble-box', 'mood', 'portrait', 'choices', 'status', 'moves', 'level', 'mode', 'color', 'takeback', 'hint', 'board-area', 'viewbar', 'viewtext', 'nav-start', 'nav-back', 'nav-forward', 'nav-live', 'back-to-game', 'explain', 'explain-bar', 'explain-text', 'explain-undo', 'explain-cancel', 'explain-done']) {
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
    this.root.querySelector('#new-game')!.addEventListener('click', () => void this.newGame());
    this.root.querySelector('#flip')!.addEventListener('click', () => this.board.toggleOrientation());
    this.el.takeback.addEventListener('click', () => void this.takeback());
    this.el.hint.addEventListener('click', () => void this.hint());
    this.el.explain.addEventListener('click', () => this.startExplain());
    this.el['explain-undo'].addEventListener('click', () => this.explainUndo());
    this.el['explain-cancel'].addEventListener('click', () => this.endExplain());
    this.el['explain-done'].addEventListener('click', () => void this.explainDone());
    this.el.board.addEventListener('click', (e) => this.onBoardTap(e));

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

  private async newGame(): Promise<void> {
    const id = ++this.gameId;
    this.thinking = false;
    this.input = undefined;
    this.lastLine = undefined;
    this.invalid = undefined;
    // `?fen=` starts from a position, playing the side to move (for testing,
    // and later for starting games from repertoire positions).
    const startFen = new URLSearchParams(location.search).get('fen') ?? undefined;
    const color: Color = startFen
      ? startFen.split(' ')[1] === 'b'
        ? 'black'
        : 'white'
      : this.settings.color === 'random'
        ? Math.random() < 0.5
          ? 'white'
          : 'black'
        : this.settings.color;
    const level = levelInfo(this.settings.level);
    const mode = (this.mode = modeInfo(this.settings.mode));
    try {
      this.game = new Game(color, startFen);
    } catch {
      this.game = new Game(color); // invalid FEN: normal start
    }
    this.coach = this.analyst.then((a) => new Coach(a, level, color === 'white' ? 'w' : 'b', mode));
    this.nav.reset(0);
    this.log.clear();
    this.viewShapes = false;
    this.board.set({ orientation: color, lastMove: undefined });
    this.board.setAutoShapes([]);
    this.el.choices.hidden = true;
    this.sync();

    const opponent = await this.opponent;
    if (id !== this.gameId) return;
    opponent.elo = level.maiaElo;

    const side = color === 'white' ? 'White' : 'Black';
    if (this.game.isPlayerTurn) {
      this.say({ kind: 'phase', text: `Let's play! You're ${side}, so you go first.`, mood: 'neutral' });
      await this.startPlayerTurn(id);
    } else {
      this.say({ kind: 'phase', text: `Let's play! You're ${side}, so I'll start.`, mood: 'neutral' });
      await this.opponentMove(id);
    }
  }

  /** Pushes the game state to the board and controls. */
  private sync(): void {
    const g = this.game;
    const nav = this.nav;
    this.el['board-area'].classList.toggle('exploring', !!this.input);
    this.el['explain-bar'].hidden = !this.input;
    nav.setLive(g.moves.length);
    if (this.input) return this.renderExplain();
    this.board.set({ viewOnly: false });
    const view = nav.viewing ? g.positionAt(nav.ply) : undefined;
    const shown = view ?? { fen: g.fen, turn: g.turn, inCheck: g.inCheck, lastMove: g.lastMove };
    const last = shown.lastMove;
    // Viewing the past: the board is read-only.
    const canMove = !nav.viewing && g.isPlayerTurn && !g.result.over && !this.thinking;
    this.board.set({
      fen: shown.fen,
      turnColor: shown.turn,
      check: shown.inCheck ? shown.turn : false,
      lastMove: last ? [last.from as Key, last.to as Key] : undefined,
      movable: { color: canMove ? g.playerColor : undefined, dests: canMove ? (g.dests as Map<Key, Key[]>) : new Map() },
    });
    // Arrows from the remark said at a viewed position; back to the live ones after.
    if (nav.viewing) {
      this.board.setAutoShapes(this.shapesAt(nav.ply));
      this.viewShapes = true;
    } else if (this.viewShapes) {
      this.board.setAutoShapes(this.shapesAt(nav.live));
      this.viewShapes = false;
    }
    this.renderMoves();
    this.renderBubble();
    this.renderNav(shown.lastMove?.san);
    this.el.takeback.hidden = !this.mode.takebacks;
    (this.el.takeback as HTMLButtonElement).disabled = nav.viewing || this.thinking || !g.moves.some((m) => m.color === g.playerColor);
    (this.el.hint as HTMLButtonElement).disabled = !canMove;
    // Explaining a line starts from the live position, on the player's turn.
    (this.el.explain as HTMLButtonElement).disabled = !canMove;
    this.el.portrait.classList.toggle('busy', this.thinking);
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
    this.el.viewbar.hidden = !nav.viewing;
    this.el['board-area'].classList.toggle('viewing', nav.viewing);
    this.el.viewtext.textContent = nav.viewing
      ? `Viewing ${plyLabel(this.game.startFen, nav.ply, san)}${nav.hasNewMove ? ' · new move played' : ''}`
      : '';
    this.el.moves.querySelector('.cur')?.classList.remove('cur');
    this.el.moves.querySelector(`[data-ply="${nav.ply}"]`)?.classList.add('cur');
  }

  /** Runs a navigation change, then redraws. */
  private navigate(change: () => void): void {
    change();
    this.sync();
  }

  private onKey(e: KeyboardEvent): void {
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    if (e.target instanceof Element && e.target.closest('select, input, textarea')) return;
    if (this.input) {
      if (e.key === 'Escape') this.endExplain();
      return; // no move navigation while a line is being entered
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
    if (!this.nav.viewing) this.el.moves.scrollTop = this.el.moves.scrollHeight;
  }

  /** The bubble: the coach's remarks for the position, newest at the bottom. */
  private renderBubble(): void {
    const nav = this.nav;
    const entries = nav.viewing ? this.log.at(nav.ply) : this.log.recent(nav.live);
    const bubble = this.el.bubble;
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
    this.el['bubble-box'].classList.remove('stale');
    // While looking at the past, the new remark waits in the log (arrows too).
    // (or entering a line: the arrows on the board are the player's).
    if (!this.nav.viewing && !this.input) {
      this.board.setAutoShapes((r.shapes ?? []).map(drawShape));
    }
    this.renderBubble();
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
      if (remark.offerExplain && this.mode.prompts) this.offerExplain();
    }
  }

  private async onPlayerMove(from: Square, to: Square): Promise<void> {
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
      if (remark.offerTakeback && this.mode.takebacks && (await this.askTakeback()) === 'takeback') {
        if (this.stale(id, ply)) return;
        this.game.takeback();
        this.log.truncate(this.game.moves.length);
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

  private async takeback(): Promise<void> {
    if (this.input || this.thinking || this.nav.viewing || !this.mode.takebacks || !this.game.takeback()) return;
    this.log.truncate(this.game.moves.length);
    this.board.setAutoShapes([]);
    this.sync();
    this.say({ kind: 'phase', text: 'Sure, take it back. Try another move.', mood: 'neutral' });
    this.status('Your move.');
    const coach = await this.coach;
    void coach.prepare(this.game.fen);
  }

  private async hint(): Promise<void> {
    if (this.nav.viewing || this.input) return;
    const id = this.gameId;
    const ply = this.game.moves.length;
    const coach = await this.coach;
    const remark = await coach.hint();
    if (!this.stale(id, ply)) this.say(remark);
  }

  // --- Explain your idea: lines with tap-arrows ---------------------------

  /** A button in the bubble that opens arrow mode (the coach asks, e.g. at a tactic). */
  private offerExplain(label = 'Let me show you'): void {
    const box = this.el.choices;
    box.innerHTML = `<button data-choice="explain" class="primary">${label}</button>`;
    box.hidden = false;
    box.onclick = (e) => {
      if (!(e.target as HTMLElement).closest('button')) return;
      box.hidden = true;
      this.startExplain(label === 'Change my line' ? this.lastLine?.moves : undefined);
    };
  }

  private startExplain(prefill?: readonly LineMove[]): void {
    const g = this.game;
    if (this.input || this.nav.viewing || this.thinking || g.result.over || !g.isPlayerTurn) return;
    this.el.choices.hidden = true;
    this.input = new LineInput(g.fen, true);
    if (prefill) this.input.load(prefill);
    this.board.setAutoShapes([]);
    this.viewShapes = false;
    this.sync();
  }

  /** Leaves arrow mode without checking anything. */
  private endExplain(): void {
    if (!this.input) return;
    this.input = undefined;
    this.invalid = undefined;
    this.board.setAutoShapes(this.shapesAt(this.nav.live));
    this.sync();
  }

  private explainUndo(): void {
    if (!this.input?.undo()) return;
    this.invalid = undefined;
    this.renderExplain();
  }

  /** Redraws the board and the bar: the line so far, the selection, a rejected arrow. */
  private renderExplain(): void {
    const input = this.input!;
    const last = input.moves.at(-1);
    const turn = input.fen.split(' ')[1] === 'w' ? 'white' : 'black';
    this.board.set({
      fen: input.fen,
      turnColor: turn,
      check: new Chess(input.fen).inCheck() ? turn : false,
      lastMove: last ? [last.from as Key, last.to as Key] : undefined,
      viewOnly: true,
      movable: { color: undefined, dests: new Map() },
    });
    const shapes: DrawShape[] = input.moves.map((m, i) => ({
      orig: m.from as Key,
      dest: m.to as Key,
      brush: m.mine ? 'green' : 'blue',
      label: { text: String(i + 1) },
    }));
    if (input.selected) {
      shapes.push({ orig: input.selected as Key, brush: 'yellow' });
      for (const d of input.dests) shapes.push({ orig: d as Key, brush: 'paleGrey' });
    }
    if (this.invalid) shapes.push({ orig: this.invalid.from as Key, dest: this.invalid.to as Key, brush: 'red' });
    this.board.setAutoShapes(shapes);

    (this.el['explain-undo'] as HTMLButtonElement).disabled = input.isEmpty;
    (this.el['explain-done'] as HTMLButtonElement).disabled = input.isEmpty;
    if (!this.el['explain-text'].dataset.msg) this.explainText(this.explainPrompt());
    delete this.el['explain-text'].dataset.msg;
  }

  private explainPrompt(): string {
    const input = this.input!;
    if (input.isFull) return `That's ${MAX_LINE_MOVES} moves, the most I can check. Tap Done.`;
    if (input.ended) return 'The game ends here. Tap Done.';
    const n = input.moves.length + 1;
    return input.nextIsMine
      ? `Move ${n}: tap one of your pieces, then where it goes.`
      : `Move ${n}: their reply. Tap one of their pieces, then where it goes.`;
  }

  private explainText(text: string, keep = false): void {
    this.el['explain-text'].textContent = text;
    if (keep) this.el['explain-text'].dataset.msg = '1';
  }

  /** Taps on the board while entering a line: piece, then square. */
  private onBoardTap(e: MouseEvent): void {
    const input = this.input;
    if (!input) return;
    const rect = this.el.board.getBoundingClientRect();
    const col = Math.min(7, Math.max(0, Math.floor(((e.clientX - rect.left) / rect.width) * 8)));
    const row = Math.min(7, Math.max(0, Math.floor(((e.clientY - rect.top) / rect.height) * 8)));
    const white = this.board.state.orientation === 'white';
    const sq = ('abcdefgh'[white ? col : 7 - col] + (white ? 8 - row : row + 1)) as Square;
    if (!SQUARES.includes(sq)) return;
    void this.applyTap(input.tap(sq));
  }

  private async applyTap(r: TapResult): Promise<void> {
    const input = this.input!;
    this.invalid = undefined;
    let message: string | undefined;
    switch (r.kind) {
      case 'invalid':
        this.invalid = { from: r.from, to: r.to };
        message = r.why;
        setTimeout(() => {
          if (this.input === input && this.invalid) {
            this.invalid = undefined;
            this.renderExplain();
          }
        }, 1200);
        break;
      case 'ignored':
        message = r.why;
        break;
      case 'full':
        message = `That's ${MAX_LINE_MOVES} moves, the most I can check. Tap Done.`;
        break;
      case 'needs-promotion': {
        const piece = await this.askPromotion(this.game.playerColor);
        if (this.input !== input) return;
        input.add(r.from, r.to, piece as LineMove['promotion']);
        break;
      }
    }
    if (message) this.explainText(message, true);
    this.renderExplain();
  }

  /** Done: leaves arrow mode and asks the coach to check the line against the engine. */
  private async explainDone(): Promise<void> {
    const input = this.input;
    if (!input || input.isEmpty) return;
    const line = input.line;
    const id = this.gameId;
    const ply = this.game.moves.length;
    this.input = undefined;
    this.invalid = undefined;
    this.lastLine = line;
    this.thinking = true;
    this.board.setAutoShapes([]);
    this.sync();
    this.status('Checking your line…');
    const coach = await this.coach;
    let remark: Remark | undefined;
    try {
      remark = await coach.explainLine(line);
    } catch {
      /* engine trouble: say so below */
    }
    if (this.stale(id, ply)) return;
    this.thinking = false;
    this.sync();
    this.status('Your move.');
    if (!remark) {
      this.say({ kind: 'line', text: "I couldn't check that line. Try again.", mood: 'concerned' });
      return;
    }
    this.say(remark);
    this.offerExplain('Change my line');
  }

  /** Shows "Take back" / "Play on" in the bubble and waits for a choice. */
  private askTakeback(): Promise<'takeback' | 'play-on'> {
    const box = this.el.choices;
    box.innerHTML = `<button data-choice="takeback" class="primary">Take back</button><button data-choice="play-on">Play on</button>`;
    box.hidden = false;
    this.status('Take it back, or play on?');
    return new Promise((resolve) => {
      box.onclick = (e) => {
        const btn = (e.target as HTMLElement).closest('button');
        if (!btn) return;
        box.hidden = true;
        resolve(btn.dataset.choice as 'takeback' | 'play-on');
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
