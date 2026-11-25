// The chart of Lines (task 1.9): the tree of opened moves as a flowchart next to the board.
// Columns are moves after the fork; rows are lanes (Best / Great / Good / Other), the same
// everywhere, so a Line that sinks from Best to Other is a Line that got worse. Curves join a
// move to the one it follows; the colour says who proposed it (game, engine, you), the fill who
// moved, the small dot who is better after it. Dashed moves at the cursor are the options for
// the next move. Drawing only: the state is a `LineTree`, the engine work is in ui.ts.
import { LANES, LANE_NAME, badgeOf, verdictOf, type Author, type Lane, type LineNode, type LineTree, type Option } from './linetree';

const NS = 'http://www.w3.org/2000/svg';

export const AUTHOR_COLOUR: Record<Author, string> = { game: '#888780', engine: '#BA7517', you: '#7F77DD' };
export const AUTHOR_NAME: Record<Author, string> = { game: 'game', engine: 'engine', you: 'you' };

const PITCH = 62;
const PILL_W = 50;
const PILL_H = 20;
const FORK_X = 62;
const FIRST_X = 120;
const SLOT = 24; // vertical room for one move in a lane
const BASE_H: Record<Lane, number> = { best: 30, great: 30, good: 30, other: 54 };
const MIN_WIDTH = 360;

/** Column centre for a move `depth` moves after the fork. */
export function columnX(depth: number): number {
  return FIRST_X + (depth - 1) * PITCH;
}

function el<K extends keyof SVGElementTagNameMap>(parent: Element, tag: K, attrs: Record<string, string | number>, text?: string): SVGElementTagNameMap[K] {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, String(attrs[k]));
  if (text !== undefined) e.textContent = text;
  parent.appendChild(e);
  return e;
}

export interface ChartInput {
  tree: LineTree;
  /** Options for the next move at the cursor that are not opened yet. */
  ghosts: Option[];
  /** The last move before the fork ("4…d6"), or "Start". */
  forkLabel: string;
  /** The engine is still ranking the options. */
  thinking: boolean;
  /** Which node asks for a pulse: the one being rated. */
  pending?: ReadonlySet<LineNode>;
}

export interface ChartHandlers {
  node(n: LineNode): void;
  ghost(o: Option): void;
}

/** Redraws the whole chart into `svg` (it is small: a handful of moves). Returns the cursor's position, for scrolling. */
export function drawChart(svg: SVGSVGElement, input: ChartInput, on: ChartHandlers): { x: number; y: number } {
  const { tree, ghosts } = input;
  const cursor = tree.cursor;
  svg.replaceChildren();
  const nodes = tree.all();
  // Moves that share a column and a lane stack: a lane grows to fit the busiest column.
  type Item = { key: object; lane: Lane; depth: number; loss: number };
  const items: Item[] = [
    ...nodes.map((n) => ({ key: n, lane: n.rating?.lane ?? ('other' as Lane), depth: n.depth, loss: n.rating?.lossCp ?? 1e9 })),
    ...ghosts.map((g) => ({ key: g, lane: g.lane, depth: cursor.depth + 1, loss: g.lossCp })),
  ];
  const groups = new Map<string, Item[]>();
  for (const it of items) groups.set(`${it.lane}|${it.depth}`, [...(groups.get(`${it.lane}|${it.depth}`) ?? []), it]);
  const laneH = {} as Record<Lane, number>;
  const laneTop = {} as Record<Lane, number>;
  let top = 8;
  for (const lane of LANES) {
    const most = Math.max(1, ...[...groups.entries()].filter(([k]) => k.startsWith(lane + '|')).map(([, v]) => v.length));
    laneH[lane] = Math.max(BASE_H[lane], most * SLOT + 6);
    laneTop[lane] = top;
    top += laneH[lane];
  }
  const height = top + 8;
  const place = new Map<object, { x: number; y: number }>();
  for (const g of groups.values()) {
    g.sort((a, b) => a.loss - b.loss).forEach((it, i) => place.set(it.key, { x: columnX(it.depth), y: laneTop[it.lane] + 3 + SLOT / 2 + i * SLOT }));
  }
  const maxDepth = Math.max(cursor.depth + (ghosts.length ? 1 : 0), ...nodes.map((n) => n.depth), 1);
  const width = Math.max(MIN_WIDTH, columnX(maxDepth) + PILL_W / 2 + 12);
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('width', String(width));
  svg.setAttribute('height', String(height));

  // Lane bands and names.
  LANES.forEach((lane, i) => {
    el(svg, 'rect', { x: 0, y: laneTop[lane] - 4, width, height: laneH[lane], rx: 6, fill: '#888780', opacity: i % 2 ? 0.06 : 0.12 });
    el(svg, 'text', { x: 6, y: laneTop[lane] + 11, 'font-size': 11, fill: 'var(--muted)' }, LANE_NAME[lane]);
  });

  const pos = (n: LineNode) => place.get(n)!;
  const forkY = laneTop.good + laneH.good / 2 - 4;
  const from = (parent: LineNode) => (parent.depth === 0 ? { x: FORK_X + 24, y: forkY } : { x: columnX(parent.depth) + PILL_W / 2, y: pos(parent).y });
  const curve = (a: { x: number; y: number }, b: { x: number; y: number }, attrs: Record<string, string | number>) => {
    const mx = (a.x + b.x) / 2;
    el(svg, 'path', { d: `M${a.x} ${a.y} C${mx} ${a.y} ${mx} ${b.y} ${b.x} ${b.y}`, fill: 'none', 'stroke-linecap': 'round', ...attrs });
  };

  // Curves first, so the moves sit on top of them.
  for (const n of nodes) {
    const onPath = tree.onCursorPath(n);
    curve(from(n.parent!), { x: pos(n).x - PILL_W / 2, y: pos(n).y }, {
      stroke: AUTHOR_COLOUR[n.author],
      'stroke-width': onPath ? 4 : 2.5,
      opacity: onPath ? 1 : 0.55,
    });
  }
  const ghostPos = ghosts.map((g) => ({ g, ...place.get(g)! }));
  for (const { g, x, y } of ghostPos) {
    curve(from(cursor), { x: x - PILL_W / 2, y }, { stroke: AUTHOR_COLOUR[g.lane === 'other' ? 'you' : 'engine'], 'stroke-width': 1.5, 'stroke-dasharray': '4 3', opacity: 0.8 });
  }

  const pill = (x: number, y: number, label: string, o: { black: boolean; stroke: string; selected?: boolean; ghost?: boolean; pending?: boolean; dot?: string; badge?: string; common?: boolean; aria: string; click: () => void }) => {
    const g = el(svg, 'g', { class: 'chart-node', transform: `translate(${x} ${y})`, role: 'button', tabindex: 0, 'aria-label': o.aria, opacity: o.pending ? 0.55 : 1 });
    el(g, 'rect', {
      x: -PILL_W / 2,
      y: -PILL_H / 2,
      width: PILL_W,
      height: PILL_H,
      rx: PILL_H / 2,
      fill: o.ghost ? 'var(--bg)' : o.black ? '#2C2C2A' : 'var(--panel)',
      stroke: o.stroke,
      'stroke-width': o.selected ? 4 : 2,
      'stroke-dasharray': o.ghost ? '3 3' : 'none',
    });
    el(g, 'text', { x: 0, y: 1, 'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-size': 11, 'font-weight': o.selected ? 500 : 400, fill: o.ghost ? 'var(--muted)' : o.black ? '#fff' : 'var(--text)' }, label);
    if (o.badge) {
      el(g, 'circle', { cx: -PILL_W / 2 + 3, cy: -PILL_H / 2 + 1, r: 8, fill: o.badge === '!' ? '#1D9E75' : o.badge === '?' ? '#D85A30' : '#E24B4A', stroke: 'var(--panel)', 'stroke-width': 1 });
      el(g, 'text', { x: -PILL_W / 2 + 3, y: -PILL_H / 2 + 2, 'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-size': 11, 'font-weight': 700, fill: '#fff' }, o.badge);
    }
    if (o.common) {
      const c = el(g, 'circle', { cx: PILL_W / 2 - 4, cy: PILL_H / 2 - 1, r: 3.5, fill: '#378ADD', stroke: 'var(--panel)', 'stroke-width': 1 });
      el(c, 'title', {}, 'Players at your level often choose this');
    }
    if (o.dot) el(g, 'circle', { cx: PILL_W / 2 - 4, cy: -PILL_H / 2 + 1, r: 4, fill: o.dot, stroke: 'var(--panel)', 'stroke-width': 1 });
    g.addEventListener('click', o.click);
    g.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Enter' || (e as KeyboardEvent).key === ' ') {
        e.preventDefault();
        o.click();
      }
    });
    return g;
  };

  // The fork: the last move everyone shares.
  const fork = pill(FORK_X, forkY, input.forkLabel, {
    black: tree.root.color === 'b',
    stroke: AUTHOR_COLOUR.game,
    selected: cursor === tree.root,
    aria: `Back to the fork, after ${input.forkLabel}`,
    click: () => on.node(tree.root),
  });
  fork.setAttribute('class', 'chart-node chart-fork');

  for (const n of nodes) {
    const v = n.rating ? verdictOf(n.rating.evalCp).side : undefined;
    const lane = n.rating ? LANE_NAME[n.rating.lane] : 'not rated yet';
    pill(pos(n).x, pos(n).y, n.label, {
      black: n.color === 'b',
      stroke: AUTHOR_COLOUR[n.author],
      selected: n === cursor,
      pending: !n.rating || input.pending?.has(n),
      dot: v ? (v === 'you' ? '#1D9E75' : v === 'them' ? '#E24B4A' : '#888780') : undefined,
      badge: badgeOf(n.rating),
      common: n.rating?.common,
      aria: `${n.label}, ${lane}, ${AUTHOR_NAME[n.author]} line${n.rating?.common ? ', common at your level' : ''}`,
      click: () => on.node(n),
    });
  }
  for (const { g, x, y } of ghostPos) {
    pill(x, y, g.san, {
      black: false,
      stroke: AUTHOR_COLOUR[g.lane === 'other' ? 'you' : 'engine'],
      ghost: true,
      badge: badgeOf(g),
      common: g.common,
      aria: `Option: ${g.san}, ${LANE_NAME[g.lane]}${g.common ? ', common at your level' : ''}`,
      click: () => on.ghost(g),
    });
  }
  if (input.thinking && !ghosts.length) {
    el(svg, 'text', { x: columnX(cursor.depth + 1) - PILL_W / 2, y: laneTop.good + 18, 'font-size': 11, fill: 'var(--muted)' }, 'Thinking…');
  }
  const at = cursor === tree.root ? { x: FORK_X, y: forkY } : place.get(cursor)!;
  return at;
}
