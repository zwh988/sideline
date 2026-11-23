// The game screen: board, coach bubble, move list and controls.
// MVP slice 1: play a full game against the coach at your level.
// The coach's comments are fixed sentences for now; rule-based triggers,
// hints and thinking aloud come in the next slices.
import { Chessground } from '@lichess-org/chessground';
import type { Api } from '@lichess-org/chessground/api';
import type { Key } from '@lichess-org/chessground/types';
import type { Square } from 'chess.js';
import { Game, type Color } from './game';
import { LEVELS, levelInfo } from './levels';
import { createOpponent, type Opponent } from './opponent';
import type { Theme } from './theme';

type Mood = 'neutral' | 'thinking' | 'pleased' | 'concerned' | 'surprised';
type ColorChoice = Color | 'random';

interface Settings {
  level: number;
  color: ColorChoice;
}

const SETTINGS_KEY = 'sideline.settings';
const COACH_NAME = 'Coach';
const MIN_THINK_MS = 600; // the coach shouldn't reply instantly

function loadSettings(): Settings {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? 'null');
    if (saved && typeof saved.level === 'number') return saved;
  } catch {
    /* storage unavailable: use defaults */
  }
  return { level: 2, color: 'white' };
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
  /** Bumped on every new game, so a reply computed for an old game is dropped. */
  private gameId = 0;
  private thinking = false;
  private el: Record<string, HTMLElement> = {};

  constructor(
    private root: HTMLElement,
    private theme: Theme,
    private themeBase: string,
  ) {
    this.render();
    this.opponent = createOpponent(levelInfo(this.settings.level).maiaElo, (loaded, total) => {
      if (this.game.moves.length === 0 && total) this.say(`Getting ready… ${Math.round((loaded / total) * 100)}%`, 'thinking');
    });
    this.newGame();
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
            <div class="portrait" aria-hidden="true">
              <span class="initial">${COACH_NAME[0]}</span>
            </div>
            <div class="bubble">
              <div class="coach-name">${COACH_NAME} <span id="mood" class="mood"></span></div>
              <p id="bubble"></p>
            </div>
          </div>
          <div class="actions">
            <button id="takeback">Take back</button>
            <button id="flip">Flip board</button>
          </div>
          <ol id="moves" class="moves"></ol>
          <p class="credits">${this.theme.credits ?? ''}</p>
        </aside>
      </main>`;

    for (const id of ['board', 'promotion', 'bubble', 'mood', 'moves', 'level', 'color', 'takeback']) {
      this.el[id] = this.root.querySelector(`#${id}`)!;
    }
    const level = this.el.level as HTMLSelectElement;
    const color = this.el.color as HTMLSelectElement;
    level.value = String(this.settings.level);
    color.value = this.settings.color;

    level.addEventListener('change', () => this.updateSettings({ level: Number(level.value) }));
    color.addEventListener('change', () => this.updateSettings({ color: color.value as ColorChoice }));
    this.root.querySelector('#new-game')!.addEventListener('click', () => this.newGame());
    this.root.querySelector('#flip')!.addEventListener('click', () => this.board.toggleOrientation());
    this.el.takeback.addEventListener('click', () => this.takeback());

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
    if (change.level !== undefined) this.say('New level set. It applies from your next game.', 'neutral');
  }

  private async newGame(): Promise<void> {
    const id = ++this.gameId;
    this.thinking = false;
    const color: Color =
      this.settings.color === 'random' ? (Math.random() < 0.5 ? 'white' : 'black') : this.settings.color;
    this.game = new Game(color);
    this.board.set({ orientation: color, lastMove: undefined });
    this.sync();

    const opponent = await this.opponent;
    if (id !== this.gameId) return;
    opponent.elo = levelInfo(this.settings.level).maiaElo;

    if (color === 'white') {
      this.say(`Let's play! You're White, so you go first.`, 'neutral');
    } else {
      this.say(`Let's play! You're Black, so I'll start.`, 'neutral');
      await this.opponentMove(id);
    }
  }

  /** Pushes the game state to the board and side panel. */
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
    (this.el.takeback as HTMLButtonElement).disabled =
      this.thinking || !g.moves.some((m) => m.color === g.playerColor);
  }

  private renderMoves(): void {
    const moves = this.game.moves;
    const rows: string[] = [];
    for (let i = 0; i < moves.length; i += 2) {
      rows.push(
        `<li><span class="num">${i / 2 + 1}.</span><span>${moves[i].san}</span><span>${moves[i + 1]?.san ?? ''}</span></li>`,
      );
    }
    this.el.moves.innerHTML = rows.join('');
    this.el.moves.scrollTop = this.el.moves.scrollHeight;
  }

  private say(text: string, mood: Mood): void {
    this.el.bubble.textContent = text;
    this.el.mood.textContent = mood === 'neutral' ? '' : mood;
    this.root.querySelector('.portrait')!.setAttribute('data-mood', mood);
  }

  private async onPlayerMove(from: Square, to: Square): Promise<void> {
    const id = this.gameId;
    let promotion = '';
    if (this.game.isPromotion(from, to)) {
      promotion = await this.askPromotion(this.game.playerColor);
      if (id !== this.gameId) return;
    }
    this.game.play(from + to + promotion);
    this.sync();
    if (this.checkGameOver()) return;
    await this.opponentMove(id);
  }

  private async opponentMove(id: number): Promise<void> {
    this.thinking = true;
    this.sync();
    this.say('Hmm, let me think…', 'thinking');

    const opponent = await this.opponent;
    const [uci] = await Promise.all([opponent.chooseMove(this.game), sleep(MIN_THINK_MS)]);
    if (id !== this.gameId) return; // a new game started meanwhile

    const move = this.game.play(uci);
    this.thinking = false;
    this.sync();
    if (this.checkGameOver()) return;
    if (this.game.inCheck) this.say(`${move.san}. Check! Your king is under attack.`, 'surprised');
    else this.say(`I played ${move.san}. Your move.`, 'neutral');
  }

  private checkGameOver(): boolean {
    const r = this.game.result;
    if (!r.over) return false;
    if (r.winner === this.game.playerColor) this.say(`Checkmate. You win, well played!`, 'pleased');
    else if (r.winner) this.say(`Checkmate, I win this one. Want to try again?`, 'concerned');
    else this.say(`It's a draw by ${r.reason}.`, 'neutral');
    this.sync();
    return true;
  }

  private takeback(): void {
    if (this.thinking || !this.game.takeback()) return;
    this.sync();
    this.say('Sure, take it back. Try another move.', 'neutral');
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
