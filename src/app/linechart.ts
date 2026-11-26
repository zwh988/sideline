// The chart of Lines (task 1.9, redrawn in 1.12d): the tree of opened moves as a wordless flowchart.
// Columns are moves after the fork; rows are lanes of quality, the same everywhere, so a Line that
// sinks from the top row to the bottom one got worse. Quality has one colour in every place it is
// drawn (the lane band, the move's outline, the arrow on the board) and a second cue that is not a
// hue (the row, and the lane's badge symbol). The Line the cursor is on is drawn bold; every other Line
// is faded. The grey path is the game itself. A small triangle says who is better after a move.
// Drawing only: the state is a `LineTree`, the engine work is in ui.ts.
import { LANES, LANE_NAME, badgeOf, verdictOf, type Lane, type LineNode, type LineTree, type Option } from './linetree';

const NS = 'http://www.w3.org/2000/svg';

/** One colour per quality, shared by the chart and the arrows on the board. Never the only cue: rows, meter, thickness. */
export const LANE_COLOUR: Record<Lane, string> = { best: 'var(--q-best)', great: 'var(--q-great)', good: 'var(--q-good)', other: 'var(--q-other)' };
/** The badge of each lane: `!` and `?` are the board's own marks, the other two are quieter ticks. */
export const LANE_BADGE: Record<Lane, string> = { best: '!', great: '✓', good: '=', other: '?' };
/** Arrow width on the board (a stronger move is a thicker arrow). */
export const LANE_ARROW: Record<Lane, number> = { best: 15, great: 12, good: 9, other: 6 };
const GAME_COLOUR = 'var(--game-line)';

const MIN_PILL_W = 46;
/** The width of a move's pill: set by `drawChart` from the longest label, so "12…Nxd4+" fits inside it. */
let PILL_W = MIN_PILL_W;
const PILL_GAP = 12;
const LABEL_FONT = 11.5;
const PILL_H = 20;
const GUTTER = 28; // the lane badges
const FORK_X = GUTTER + 14;
const FIRST_X = GUTTER + 62;
const SLOT = 22; // vertical room for one move in a lane
const BASE_H: Record<Lane, number> = { best: 24, great: 24, good: 24, other: 28 };
const MIN_WIDTH = 300;

/** A pill wide enough for the longest label at the chart's font size (an estimate of the glyph width, plus room each side). */
export function pillWidth(labels: string[]): number {
  const longest = Math.max(0, ...labels.map((l) => l.length));
  return Math.max(MIN_PILL_W, Math.ceil(longest * LABEL_FONT * 0.55 + 10));
}

/** Column centre for a move `depth` moves after the fork. */
export function columnX(depth: number): number {
  return FIRST_X + (depth - 1) * (PILL_W + PILL_GAP);
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
  /** The last move before the fork ("4…d6"), or "Start" (spoken, not drawn). */
  forkLabel: string;
  /** The box the chart sits in: the lane colours run at least to its edge. */
  minWidth?: number;
  /** The engine is still ranking the options. */
  thinking: boolean;
  /** Which node asks for a pulse: the one being rated. */
  pending?: ReadonlySet<LineNode>;
}

export interface ChartHandlers {
  node(n: LineNode): void;
  ghost(o: Option): void;
}

/** The lane's badge as SVG markup (a coloured disc with its symbol, `d` px wide): quality without words. */
export function laneBadgeSvg(lane: Lane, d = 16): string {
  const glyph = LANE_BADGE[lane];
  return `<svg class="lane-badge" viewBox="0 0 20 20" width="${d}" height="${d}" aria-hidden="true"><circle cx="10" cy="10" r="9.5" fill="${LANE_COLOUR[lane]}"/><text x="10" y="10.5" text-anchor="middle" dominant-baseline="central" font-size="13" font-weight="800" font-family="system-ui,sans-serif" fill="var(--on-accent)">${glyph}</text></svg>`;
}

/** Redraws the whole chart into `svg` (it is small: a handful of moves). Returns the cursor's position, for scrolling. */
export function drawChart(svg: SVGSVGElement, input: ChartInput, on: ChartHandlers): { x: number; y: number } {
  const { tree, ghosts } = input;
  const cursor = tree.cursor;
  svg.replaceChildren();
  const nodes = tree.all();
  PILL_W = pillWidth([...nodes.map((n) => n.label), ...ghosts.map((g) => g.san)]);
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
  let top = 4;
  for (const lane of LANES) {
    const most = Math.max(1, ...[...groups.entries()].filter(([k]) => k.startsWith(lane + '|')).map(([, v]) => v.length));
    laneH[lane] = Math.max(BASE_H[lane], most * SLOT + 6);
    laneTop[lane] = top;
    top += laneH[lane];
  }
  const height = top + 4;
  const place = new Map<object, { x: number; y: number }>();
  for (const g of groups.values()) {
    g.sort((a, b) => a.loss - b.loss).forEach((it, i) => place.set(it.key, { x: columnX(it.depth), y: laneTop[it.lane] + 3 + SLOT / 2 + i * SLOT }));
  }
  const maxDepth = Math.max(cursor.depth + (ghosts.length ? 1 : 0), ...nodes.map((n) => n.depth), 1);
  const width = Math.max(MIN_WIDTH, input.minWidth ?? 0, columnX(maxDepth) + PILL_W / 2 + 12);
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('width', String(width));
  svg.setAttribute('height', String(height));

  // Lane bands, tinted with the lane's colour, and each lane's badge in the gutter: no words.
  LANES.forEach((lane, i) => {
    el(svg, 'rect', { x: 0, y: laneTop[lane], width, height: laneH[lane], fill: LANE_COLOUR[lane], opacity: i % 2 ? 0.09 : 0.15 });
    el(svg, 'rect', { x: 0, y: laneTop[lane], width: 3, height: laneH[lane], fill: LANE_COLOUR[lane] });
    const m = el(svg, 'g', { transform: `translate(7 ${laneTop[lane] + laneH[lane] / 2 - 8})` });
    m.innerHTML = laneBadgeSvg(lane, 16);
  });

  const pos = (n: LineNode) => place.get(n)!;
  const forkY = laneTop.good + laneH.good / 2;
  const from = (parent: LineNode) => (parent.depth === 0 ? { x: FORK_X + 7, y: forkY } : { x: columnX(parent.depth) + PILL_W / 2, y: pos(parent).y });
  const curve = (a: { x: number; y: number }, b: { x: number; y: number }, attrs: Record<string, string | number>) => {
    const mx = (a.x + b.x) / 2;
    el(svg, 'path', { d: `M${a.x} ${a.y} C${mx} ${a.y} ${mx} ${b.y} ${b.x} ${b.y}`, fill: 'none', 'stroke-linecap': 'round', ...attrs });
  };

  // Curves first, so the moves sit on top. The Line the cursor is on is bold; the others are faded.
  const faded = (n: LineNode) => !tree.onCursorPath(n);
  const colourOf = (n: LineNode) => (n.author === 'game' ? GAME_COLOUR : LANE_COLOUR[n.rating?.lane ?? 'other']);
  for (const n of [...nodes].sort((a, b) => Number(faded(b)) - Number(faded(a)))) {
    curve(from(n.parent!), { x: pos(n).x - PILL_W / 2, y: pos(n).y }, {
      stroke: colourOf(n),
      'stroke-width': faded(n) ? 2 : 10,
      opacity: faded(n) ? 0.3 : 1,
    });
  }
  const ghostPos = ghosts.map((g) => ({ g, ...place.get(g)! }));
  for (const { g, x, y } of ghostPos) {
    curve(from(cursor), { x: x - PILL_W / 2, y }, { stroke: LANE_COLOUR[g.lane], 'stroke-width': 2, 'stroke-dasharray': '3 4', opacity: 0.8 });
  }

  const pill = (x: number, y: number, label: string, o: { black: boolean; stroke: string; selected?: boolean; faded?: boolean; ghost?: boolean; pending?: boolean; better?: 'you' | 'them' | 'level'; badge?: string; common?: boolean; aria: string; click: () => void }) => {
    const g = el(svg, 'g', { class: 'chart-node', transform: `translate(${x} ${y})`, role: 'button', tabindex: 0, 'aria-label': o.aria, opacity: o.pending ? 0.5 : o.faded ? 0.45 : 1 });
    if (o.selected) {
      el(g, 'rect', { x: -PILL_W / 2 - 4, y: -PILL_H / 2 - 4, width: PILL_W + 8, height: PILL_H + 8, rx: (PILL_H + 8) / 2, fill: 'none', stroke: 'var(--text)', 'stroke-width': 2 });
    }
    el(g, 'rect', {
      x: -PILL_W / 2,
      y: -PILL_H / 2,
      width: PILL_W,
      height: PILL_H,
      rx: PILL_H / 2,
      fill: o.ghost ? 'var(--bg)' : o.black ? 'var(--ink-black)' : 'var(--panel)',
      stroke: o.stroke,
      'stroke-width': o.selected ? 3.5 : 2.5,
      'stroke-dasharray': o.ghost ? '3 3' : 'none',
    });
    el(g, 'text', { x: 0, y: 1, 'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-size': LABEL_FONT, 'font-weight': o.selected ? 600 : 500, fill: o.ghost ? 'var(--muted)' : o.black ? 'var(--on-accent)' : 'var(--text)' }, label);
    if (o.badge) {
      el(g, 'circle', { cx: -PILL_W / 2 + 2, cy: -PILL_H / 2, r: 8, fill: o.badge === '!' ? 'var(--mark-good)' : o.badge === '?' ? 'var(--mark-bad)' : 'var(--mark-blunder)', stroke: 'var(--panel)', 'stroke-width': 1.5 });
      el(g, 'text', { x: -PILL_W / 2 + 2, y: -PILL_H / 2 + 1, 'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-size': o.badge.length > 1 ? 9 : 11, 'font-weight': 800, fill: 'var(--on-accent)' }, o.badge);
    }
    if (o.better) {
      // Who is better after the move, by shape (not hue): a triangle up for you, down for them, a bar for level.
      const bx = PILL_W / 2 - 3;
      const by = -PILL_H / 2;
      const d = o.better === 'you' ? `M${bx - 4.5} ${by + 3.5} L${bx + 4.5} ${by + 3.5} L${bx} ${by - 4}Z` : o.better === 'them' ? `M${bx - 4.5} ${by - 3.5} L${bx + 4.5} ${by - 3.5} L${bx} ${by + 4}Z` : `M${bx - 4.5} ${by - 1.2} h9 v2.4 h-9Z`;
      el(g, 'path', { d, fill: 'var(--text)', stroke: 'var(--panel)', 'stroke-width': 1.2, 'stroke-linejoin': 'round' });
    }
    if (o.common) {
      const c = el(g, 'circle', { cx: PILL_W / 2 - 4, cy: PILL_H / 2, r: 3.5, fill: 'var(--panel)', stroke: 'var(--text)', 'stroke-width': 1.5 });
      el(c, 'title', {}, 'Players at your level often choose this');
    }
    g.addEventListener('click', o.click);
    g.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Enter' || (e as KeyboardEvent).key === ' ') {
        e.preventDefault();
        o.click();
      }
    });
    return g;
  };

  // The fork: where the Lines part. A small dot, no label (the label is for screen readers).
  const forkG = el(svg, 'g', { class: 'chart-node chart-fork', transform: `translate(${FORK_X} ${forkY})`, role: 'button', tabindex: 0, 'aria-label': `Back to the fork, after ${input.forkLabel}` });
  el(forkG, 'circle', { r: cursor === tree.root ? 8 : 6, fill: 'var(--panel)', stroke: cursor === tree.root ? 'var(--text)' : GAME_COLOUR, 'stroke-width': cursor === tree.root ? 3.5 : 2.5 });
  forkG.addEventListener('click', () => on.node(tree.root));
  forkG.addEventListener('keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Enter' || (e as KeyboardEvent).key === ' ') {
      e.preventDefault();
      on.node(tree.root);
    }
  });

  for (const n of nodes) {
    const v = n.rating ? verdictOf(n.rating.evalCp).side : undefined;
    const lane = n.rating ? LANE_NAME[n.rating.lane] : 'not rated yet';
    pill(pos(n).x, pos(n).y, n.label, {
      black: n.color === 'b',
      stroke: colourOf(n),
      selected: n === cursor,
      faded: faded(n),
      pending: !n.rating || input.pending?.has(n),
      better: v,
      badge: badgeOf(n.rating),
      common: n.rating?.common,
      aria: `${n.label}, ${lane}${n.author === 'game' ? ', played in the game' : ''}${n.rating?.common ? ', common at your level' : ''}`,
      click: () => on.node(n),
    });
  }
  for (const { g, x, y } of ghostPos) {
    pill(x, y, g.san, {
      black: false,
      stroke: LANE_COLOUR[g.lane],
      ghost: true,
      badge: badgeOf(g),
      common: g.common,
      aria: `Option: ${g.san}, ${LANE_NAME[g.lane]}${g.common ? ', common at your level' : ''}`,
      click: () => on.ghost(g),
    });
  }
  if (input.thinking && !ghosts.length) {
    // The engine is ranking the next moves: three pulsing dots where they will appear.
    const dots = el(svg, 'g', { class: 'chart-thinking', transform: `translate(${columnX(cursor.depth + 1) - 10} ${forkY})` });
    for (let i = 0; i < 3; i++) el(dots, 'circle', { cx: i * 10, cy: 0, r: 2.5, fill: 'var(--muted)', style: `animation-delay:${i * 0.2}s` });
  }
  return cursor === tree.root ? { x: FORK_X, y: forkY } : place.get(cursor)!;
}
