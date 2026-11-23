// The game screen: board, coach bubble, move list and controls.
// The coach speaks only when its rules say so (src/coach/coach.ts); the
// status line under the bubble carries routine game information.
import { Chessground } from '@lichess-org/chessground';
import type { Api } from '@lichess-org/chessground/api';
import type { DrawShape } from '@lichess-org/chessground/draw';
import type { Key } from '@lichess-org/chessground/types';
import type { Square } from 'chess.js';
import { Analyst } from '../coach/analyst';
import { Coach, joinRemarks, type Remark } from '../coach/coach';
import { Game, type Color } from './game';
import { LEVELS, levelInfo } from './levels';
import { MODES, modeInfo, type Mode, type ModeId } from './modes';
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
        <div class="board-area">
          <div id="board" class="cg-wrap"></div>
          <div id="promotion" class="promotion" hidden></div>
        </div>
        <aside class="side">
          <div class="coach">
            <div id="portrait" class="portrait" aria-hidden="true">
              <span class="initial">${COACH_NAME[0]}</span>
            </div>
            <div id="bubble-box" class="bubble">
              <div class="coach-name">${COACH_NAME} <span id="mood" class="mood"></span></div>
              <p id="bubble" aria-live="polite"></p>
              <div id="choices" class="choices" hidden></div>
            </div>
          </div>
          <p id="status" class="status"></p>
          <div class="actions">
            <button id="hint">Hint</button>
            <button id="takeback">Take back</button>
            <button id="flip">Flip board</button>
          </div>
          <ol id="moves" class="moves"></ol>
          <p class="credits">${this.theme.credits ?? ''}</p>
        </aside>
      </main>`;

    for (const id of ['board', 'promotion', 'bubble', 'bubble-box', 'mood', 'portrait', 'choices', 'status', 'moves', 'level', 'mode', 'color', 'takeback', 'hint']) {
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
    const last = g.lastMove;
    const canMove = g.isPlayerTurn && !g.result.over && !this.thinking;
    this.board.set({
      fen: g.fen,
      turnColor: g.turn,
      check: g.inCheck ? g.turn : false,
      lastMove: last ? [last.from as Key, last.to as Key] : undefined,
      movable: { color: canMove ? g.playerColor : undefined, dests: canMove ? (g.dests as Map<Key, Key[]>) : new Map() },
    });
    this.renderMoves();
    this.el.takeback.hidden = !this.mode.takebacks;
    (this.el.takeback as HTMLButtonElement).disabled = this.thinking || !g.moves.some((m) => m.color === g.playerColor);
    (this.el.hint as HTMLButtonElement).disabled = !canMove;
    this.el.portrait.classList.toggle('busy', this.thinking);
  }

  private renderMoves(): void {
    // Games can start mid-game (from a position), possibly with Black to move.
    const [, turn, , , , full] = this.game.startFen.split(' ');
    const sans = this.game.moves.map((m) => m.san);
    if (turn === 'b') sans.unshift('…');
    const first = Number(full) || 1;
    const rows: string[] = [];
    for (let i = 0; i < sans.length; i += 2) {
      rows.push(
        `<li><span class="num">${first + i / 2}.</span><span>${sans[i]}</span><span>${sans[i + 1] ?? ''}</span></li>`,
      );
    }
    this.el.moves.innerHTML = rows.join('');
    this.el.moves.scrollTop = this.el.moves.scrollHeight;
  }

  /** The coach speaks: new text in the bubble, with arrows or circles on the board. */
  private say(r: Remark): void {
    this.el.bubble.textContent = r.text;
    this.el.mood.textContent = r.mood === 'neutral' ? '' : r.mood;
    this.el.portrait.dataset.mood = r.mood;
    this.el['bubble-box'].classList.remove('stale');
    this.board.setAutoShapes(
      (r.shapes ?? []).map((s): DrawShape => ({ orig: s.orig as Key, dest: s.dest as Key | undefined, brush: s.brush })),
    );
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
    if (!this.stale(id, ply) && remark) this.say(remark);
  }

  private async onPlayerMove(from: Square, to: Square): Promise<void> {
    const id = this.gameId;
    let promotion = '';
    if (this.game.isPromotion(from, to)) {
      promotion = await this.askPromotion(this.game.playerColor);
      if (id !== this.gameId) return;
    }
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
    if (this.thinking || !this.mode.takebacks || !this.game.takeback()) return;
    this.board.setAutoShapes([]);
    this.sync();
    this.say({ kind: 'phase', text: 'Sure, take it back. Try another move.', mood: 'neutral' });
    this.status('Your move.');
    const coach = await this.coach;
    void coach.prepare(this.game.fen);
  }

  private async hint(): Promise<void> {
    const id = this.gameId;
    const ply = this.game.moves.length;
    const coach = await this.coach;
    const remark = await coach.hint();
    if (!this.stale(id, ply)) this.say(remark);
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
