// The "Import games" dialog: a pasted PGN, a .pgn file, or the player's own
// latest games from Chess.com or Lichess (only when they press the button; the
// username goes to that service and nowhere else). Imported games are saved in
// the same store as live games, after the coach has looked for moments in them.
//
// Analysing a whole game takes a while (about a second per move of the player on
// a desktop, more on a phone), so it never runs on the page's thread: the engine
// is a worker of its own (a second Stockfish, so a game in progress keeps its
// instant hints), games are analysed one at a time and one move at a time, the
// dialog shows progress, and Cancel (or closing the dialog) stops at the next
// move. Every game that finished before that is kept.
import type { Analyst } from '../coach/analyst';
import { loadOpeningBook } from '../coach/openings';
import { REVIEW_VERSION, reviewGame } from '../coach/review';
import { guessColor, importedId, parseGame, parsePgn, toSavedGame, describeGame, type ParsedGame } from './pgnimport';
import { levelInfo } from './levels';
import { cleanUsername, fetchChessCom, fetchLichess, SourceError, type Fetch, type FetchedGame } from './sources';
import type { Color } from './game';
import type { GameStore, ImportedInfo } from './store';

export interface ImportDeps {
  store: GameStore;
  /** The level the player has selected, kept on the saved game (Review itself is the same at every level). */
  level: () => number;
  /** A fresh engine for the analysis; the dialog terminates it when it is done. */
  createAnalyst: () => Promise<Analyst>;
  /** Games were saved (the Game review list is out of date). */
  onChange: () => void;
  fetcher?: Fetch;
}

interface Candidate {
  parsed: ParsedGame;
  source: ImportedInfo['source'];
  url?: string;
  color?: Color;
  checked: boolean;
}

const NAMES_KEY = 'sideline.import.names';
const SERVICES = { 'chess.com': 'Chess.com', lichess: 'Lichess' } as const;
/** Games fetched from a service. None start ticked: the player picks (analysis takes a while). */
const FETCH_COUNT = 20;

function loadNames(): Record<string, string> {
  try {
    const v = JSON.parse(localStorage.getItem(NAMES_KEY) ?? '{}');
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

function saveName(service: string, name: string): void {
  try {
    localStorage.setItem(NAMES_KEY, JSON.stringify({ ...loadNames(), [service]: name }));
  } catch {
    /* not critical */
  }
}

export class ImportDialog {
  private dialog: HTMLDialogElement;
  private q: <T extends HTMLElement>(sel: string) => T;
  private candidates: Candidate[] = [];
  private abort?: AbortController;
  private busy = false;

  constructor(
    root: HTMLElement,
    private deps: ImportDeps,
  ) {
    this.dialog = document.createElement('dialog');
    this.dialog.className = 'history import';
    this.dialog.setAttribute('aria-label', 'Import games');
    this.dialog.innerHTML = `
      <div class="history-head"><h2>Import games</h2><button data-id="close" class="ghost">Close</button></div>
      <p data-id="note" class="history-note" aria-live="polite">Games are saved on this device only.</p>
      <section data-id="inputs">
        <h3>Paste a PGN or open a file</h3>
        <textarea data-id="paste" rows="5" placeholder="Paste one or more games here (PGN)" spellcheck="false"></textarea>
        <div class="import-row">
          <button data-id="read" class="primary">Read games</button>
          <button data-id="choose">Open a .pgn file</button>
          <input data-id="file" type="file" accept=".pgn,.txt,text/plain,application/x-chess-pgn" hidden>
        </div>
        <h3>Or get your latest games</h3>
        <div class="import-row">
          <select data-id="service" aria-label="Service">
            <option value="chess.com">Chess.com</option>
            <option value="lichess">Lichess</option>
          </select>
          <input data-id="user" type="text" placeholder="Your username" autocomplete="off" autocapitalize="none" spellcheck="false" aria-label="Your username">
          <button data-id="fetch">Get my games</button>
        </div>
        <p class="import-fine">Only when you press the button: your username is sent to that service to get your public games, and nowhere else.</p>
      </section>
      <section data-id="picker" hidden>
        <h3 data-id="picker-title">Games</h3>
        <div class="import-row">
          <button data-id="analyse" class="primary">Analyse and save</button>
          <button data-id="all" class="ghost">Tick all</button>
          <button data-id="back" class="ghost">Back</button>
        </div>
        <ol data-id="list" class="history-list import-list"></ol>
      </section>
      <section data-id="progress" hidden>
        <p data-id="progress-text" aria-live="polite"></p>
        <progress data-id="bar" max="1" value="0"></progress>
        <div class="import-row"><button data-id="cancel" class="ghost">Cancel</button></div>
      </section>`;
    root.append(this.dialog);
    this.q = <T extends HTMLElement>(sel: string) => this.dialog.querySelector<T>(`[data-id="${sel}"]`)!;

    this.q('close').addEventListener('click', () => this.dialog.close());
    // Closing (button, Esc) while analysing is a cancel.
    this.dialog.addEventListener('close', () => this.abort?.abort());
    this.q('read').addEventListener('click', () => this.readText(this.q<HTMLTextAreaElement>('paste').value));
    this.q('choose').addEventListener('click', () => this.q('file').click());
    this.q('file').addEventListener('change', () => void this.readFile());
    this.q('fetch').addEventListener('click', () => void this.fetchGames());
    this.q('service').addEventListener('change', () => this.fillName());
    this.q('back').addEventListener('click', () => this.showInputs());
    this.q('analyse').addEventListener('click', () => void this.analyse());
    this.q('all').addEventListener('click', () => this.tickAll());
    this.q('cancel').addEventListener('click', () => this.abort?.abort());
    this.q('list').addEventListener('change', (e) => this.onRowChange(e));
    this.fillName();
  }

  open(): void {
    if (!this.busy) this.showInputs();
    this.dialog.showModal();
  }

  private note(text: string): void {
    this.q('note').textContent = text;
  }

  private show(which: 'inputs' | 'picker' | 'progress'): void {
    for (const id of ['inputs', 'picker', 'progress']) this.q(id).hidden = id !== which;
  }

  private showInputs(): void {
    this.candidates = [];
    this.show('inputs');
    this.note('Games are saved on this device only.');
  }

  private fillName(): void {
    this.q<HTMLInputElement>('user').value = loadNames()[this.q<HTMLSelectElement>('service').value] ?? '';
  }

  // --- Getting games in --------------------------------------------------

  private async readFile(): Promise<void> {
    const input = this.q<HTMLInputElement>('file');
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (file.size > 20_000_000) return this.note('That file is too big (over 20 MB).');
    try {
      this.readText(await file.text());
    } catch {
      this.note('That file could not be read.');
    }
  }

  private readText(text: string): void {
    if (!text.trim()) return this.note('Paste a game first.');
    const { games, errors } = parsePgn(text);
    if (!games.length) return this.note(errors[0] ?? 'No games found in that text.');
    const names = Object.values(loadNames()).filter(Boolean);
    this.setCandidates(
      games.map((parsed) => ({ parsed, source: 'pgn' as const, color: guessColor(parsed, names), checked: false })),
      errors.length ? `${errors.length} game${errors.length === 1 ? '' : 's'} could not be read: ${errors[0]}` : undefined,
    );
  }

  private async fetchGames(): Promise<void> {
    const service = this.q<HTMLSelectElement>('service').value as keyof typeof SERVICES;
    const user = cleanUsername(this.q<HTMLInputElement>('user').value);
    if (!user) return this.note('Type your username on that service.');
    const button = this.q<HTMLButtonElement>('fetch');
    button.disabled = true;
    this.note(`Asking ${SERVICES[service]} for ${user}'s latest games…`);
    try {
      const f = this.deps.fetcher;
      const fetched: FetchedGame[] = service === 'lichess' ? await fetchLichess(user, FETCH_COUNT, f) : await fetchChessCom(user, FETCH_COUNT, f);
      saveName(service, user);
      const candidates: Candidate[] = [];
      for (const g of fetched) {
        try {
          const parsed = parseGame(g.pgn);
          candidates.push({ parsed, source: service, url: g.url, color: guessColor(parsed, [user]), checked: false });
        } catch {
          /* a game that can't be read is left out */
        }
      }
      if (!candidates.length) return this.note(`${SERVICES[service]} has no standard games for ${user}.`);
      this.setCandidates(candidates, undefined);
    } catch (e) {
      this.note(e instanceof SourceError ? e.message : 'Something went wrong getting the games.');
    } finally {
      button.disabled = false;
    }
  }

  // --- Choosing -----------------------------------------------------------

  private setCandidates(list: Candidate[], warning: string | undefined): void {
    this.candidates = list;
    this.renderList();
    this.show('picker');
    this.q('picker-title').textContent = `${list.length} game${list.length === 1 ? '' : 's'} found`;
    this.note(warning ?? 'Tick the games to analyse and say which side you played.');
  }

  private saved(c: Candidate): boolean {
    return !!c.color && this.deps.store.ids().includes(importedId(c.parsed, c.color));
  }

  private renderList(): void {
    const list = this.q('list');
    list.replaceChildren();
    this.candidates.forEach((c, i) => {
      const li = document.createElement('li');
      li.dataset.index = String(i);
      const label = document.createElement('label');
      label.className = 'import-pick';
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.dataset.role = 'tick';
      const text = document.createElement('span');
      label.append(box, text);
      const side = document.createElement('select');
      side.dataset.role = 'side';
      side.setAttribute('aria-label', 'Which side you played');
      for (const [v, t] of [['', 'Which side were you?'], ['white', 'I was White'], ['black', 'I was Black']]) {
        const o = document.createElement('option');
        o.value = v;
        o.textContent = t;
        side.append(o);
      }
      side.value = c.color ?? '';
      li.append(label, side);
      list.append(li);
      this.refreshRow(i);
    });
    this.refreshCount();
  }

  private refreshRow(i: number): void {
    const c = this.candidates[i];
    const li = this.q('list').children[i] as HTMLElement;
    const box = li.querySelector<HTMLInputElement>('[data-role="tick"]')!;
    const done = this.saved(c);
    if (done) c.checked = false;
    box.checked = c.checked;
    box.disabled = done || !c.color;
    li.querySelector('span')!.textContent = `${describeGame(c.parsed, c.color)}${done ? ' · already saved' : ''}`;
  }

  private onRowChange(e: Event): void {
    const el = e.target as HTMLElement;
    const li = el.closest<HTMLElement>('li');
    if (!li) return;
    const i = Number(li.dataset.index);
    const c = this.candidates[i];
    if (el.dataset.role === 'side') {
      c.color = (el as HTMLSelectElement).value === '' ? undefined : ((el as HTMLSelectElement).value as Color);
      c.checked = !!c.color;
    } else if (el.dataset.role === 'tick') {
      c.checked = (el as HTMLInputElement).checked;
    }
    this.refreshRow(i);
    this.refreshCount();
  }

  /** Ticks every game that can be ticked (its side known, not saved yet), or unticks them all when they already are. */
  private tickAll(): void {
    const open = this.candidates.filter((c) => c.color && !this.saved(c));
    const all = open.length > 0 && open.every((c) => c.checked);
    for (const c of open) c.checked = !all;
    this.candidates.forEach((_, i) => this.refreshRow(i));
    this.refreshCount();
  }

  private chosen(): (Candidate & { color: Color })[] {
    return this.candidates.filter((c): c is Candidate & { color: Color } => c.checked && !!c.color && !this.saved(c));
  }

  private refreshCount(): void {
    const n = this.chosen().length;
    const plies = this.chosen().reduce((sum, c) => sum + Math.ceil(c.parsed.moves.length / 2), 0);
    const b = this.q<HTMLButtonElement>('analyse');
    b.disabled = n === 0;
    b.textContent = n ? `Analyse ${n} game${n === 1 ? '' : 's'} (${plies} of your moves)` : 'Tick games to analyse';
    const open = this.candidates.filter((c) => c.color && !this.saved(c));
    this.q('all').textContent = open.length && open.every((c) => c.checked) ? 'Untick all' : 'Tick all';
  }

  // --- Analysing ---------------------------------------------------------

  private async analyse(): Promise<void> {
    const chosen = this.chosen();
    if (!chosen.length || this.busy) return;
    this.busy = true;
    const level = levelInfo(this.deps.level());
    const abort = (this.abort = new AbortController());
    const text = this.q('progress-text');
    const bar = this.q<HTMLProgressElement>('bar');
    this.show('progress');
    text.textContent = 'Starting the engine…';
    bar.removeAttribute('value'); // indeterminate until the first move
    let analyst: Analyst | undefined;
    let games = 0;
    let moments = 0;
    let full = false;
    let failed = false;
    try {
      analyst = await this.deps.createAnalyst();
      const book = await loadOpeningBook();
      for (const [k, c] of chosen.entries()) {
        if (abort.signal.aborted) break;
        const game = toSavedGame(c.parsed, c.color, level.level, c.source, c.url);
        const label = `Game ${k + 1} of ${chosen.length}`;
        text.textContent = `${label} · starting…`;
        const result = await reviewGame(analyst, { ...game, opponent: game.imported ? (game.playerColor === 'white' ? game.imported.black : game.imported.white) : undefined }, {
          book,
          signal: abort.signal,
          onProgress: (done, total) => {
            text.textContent = `${label} · move ${Math.ceil(done / 2)} of ${Math.ceil(total / 2)}`;
            bar.max = chosen.length * 1000;
            bar.value = k * 1000 + Math.round((done / total) * 1000);
          },
        });
        if (!result) break; // cancelled in the middle of this game: it is not kept half-done
        game.remarks = result.remarks;
        game.moments = result.moments;
        game.curve = result.curve;
        game.reviewVersion = REVIEW_VERSION;
        game.opening = book.openingOf(game.startFen, game.moves);
        if (!this.deps.store.save(game)) {
          full = true;
          break;
        }
        games++;
        moments += game.moments.length;
      }
    } catch (e) {
      console.error(e);
      failed = true;
    } finally {
      analyst?.terminate();
      this.abort = undefined;
      this.busy = false;
    }
    if (games) this.deps.onChange();
    const saved = `${games} game${games === 1 ? '' : 's'} saved with ${moments} moment${moments === 1 ? '' : 's'}`;
    this.showInputs();
    this.note(
      failed
        ? `The engine stopped working. ${saved}.`
        : full
          ? `Storage on this device is full. ${saved}. Delete or back up some games first.`
        : abort.signal.aborted
          ? games
            ? `Cancelled. ${saved}.`
            : 'Cancelled. Nothing was saved.'
          : `${saved}. You'll find ${games === 1 ? 'it' : 'them'} in Game review.`,
    );
  }
}
