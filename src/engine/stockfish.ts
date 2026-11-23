// Thin wrapper around the Stockfish WebAssembly worker, speaking UCI.
// One search at a time; callers await each analyse() before the next.

export type Score = { kind: 'cp'; value: number } | { kind: 'mate'; value: number };

export interface Line {
  multipv: number;
  depth: number;
  score: Score; // from the side to move's point of view
  pv: string[]; // UCI moves, e.g. "e2e4"
}

export interface Analysis {
  bestMove: string;
  lines: Line[]; // sorted by multipv (1 = best)
  depth: number;
  nodes: number;
  timeMs: number; // wall-clock time measured in the page
}

export interface AnalyseOptions {
  depth?: number;
  movetimeMs?: number;
  multiPv?: number;
}

const ENGINE_URL = `${import.meta.env.BASE_URL}engine/stockfish-19-lite-single.js`;

export class Stockfish {
  private worker: Worker;
  private listeners = new Set<(line: string) => void>();
  /** UCI option names the engine reported, e.g. "UCI_Elo", "Skill Level". */
  options: string[] = [];
  name = '';

  private constructor() {
    this.worker = new Worker(ENGINE_URL);
    this.worker.onmessage = (e: MessageEvent<string>) => {
      for (const l of this.listeners) l(String(e.data));
    };
  }

  /** Starts the worker and waits until the engine is ready. */
  static async create(): Promise<Stockfish> {
    const sf = new Stockfish();
    await sf.waitFor('uci', (line) => {
      if (line.startsWith('id name ')) sf.name = line.slice(8);
      const opt = line.match(/^option name (.+?) type /);
      if (opt) sf.options.push(opt[1]);
      return line === 'uciok';
    });
    await sf.ready();
    return sf;
  }

  setOption(name: string, value: string | number): void {
    this.send(`setoption name ${name} value ${value}`);
  }

  async ready(): Promise<void> {
    await this.waitFor('isready', (line) => line === 'readyok');
  }

  async newGame(): Promise<void> {
    this.send('ucinewgame');
    await this.ready();
  }

  async analyse(fen: string, opts: AnalyseOptions = {}): Promise<Analysis> {
    const multiPv = opts.multiPv ?? 1;
    this.setOption('MultiPV', multiPv);
    await this.ready();
    this.send(`position fen ${fen}`);

    const lines = new Map<number, Line>();
    let depth = 0;
    let nodes = 0;
    let bestMove = '';
    const limit = opts.movetimeMs ? `movetime ${opts.movetimeMs}` : `depth ${opts.depth ?? 12}`;
    const start = performance.now();

    await this.waitFor(`go ${limit}`, (line) => {
      if (line.startsWith('info ') && line.includes(' pv ')) {
        const parsed = parseInfo(line);
        // Skip partial lines (upperbound/lowerbound) from aspiration windows.
        if (parsed && !line.includes('bound')) {
          lines.set(parsed.multipv, parsed);
          depth = Math.max(depth, parsed.depth);
          nodes = parsed.nodes;
        }
      } else if (line.startsWith('bestmove')) {
        bestMove = line.split(' ')[1];
        return true;
      }
      return false;
    });

    // Keep only lines from the final completed depth, so all lines are comparable.
    const finalLines = [...lines.values()]
      .filter((l) => l.depth >= depth - 1)
      .sort((a, b) => a.multipv - b.multipv);
    return { bestMove, lines: finalLines, depth, nodes, timeMs: performance.now() - start };
  }

  terminate(): void {
    this.worker.terminate();
  }

  private send(cmd: string): void {
    this.worker.postMessage(cmd);
  }

  /** Sends a command and resolves when `done` returns true for an output line. */
  private waitFor(cmd: string, done: (line: string) => boolean): Promise<void> {
    return new Promise((resolve) => {
      const listener = (line: string) => {
        if (done(line)) {
          this.listeners.delete(listener);
          resolve();
        }
      };
      this.listeners.add(listener);
      this.send(cmd);
    });
  }
}

function parseInfo(line: string): (Line & { nodes: number }) | null {
  const t = line.split(' ');
  const num = (key: string) => {
    const i = t.indexOf(key);
    return i >= 0 ? Number(t[i + 1]) : undefined;
  };
  const scoreIdx = t.indexOf('score');
  const pvIdx = t.indexOf('pv');
  const depth = num('depth');
  if (scoreIdx < 0 || pvIdx < 0 || depth === undefined) return null;
  const kind = t[scoreIdx + 1] as 'cp' | 'mate';
  return {
    multipv: num('multipv') ?? 1,
    depth,
    nodes: num('nodes') ?? 0,
    score: { kind, value: Number(t[scoreIdx + 2]) },
    pv: t.slice(pvIdx + 1),
  };
}
