// Builds the move tree of an opening course (task 6.1). Pure logic: the
// reply frequencies (Lichess explorer or Maia), the player's move popularity
// and the Stockfish evaluations come in through `TreeProviders`, so the rules
// are tested with scripted data and the build script
// (scripts/build-opening-trees.mjs) plugs in the real sources.
//
// One tree per course that grows with the coach (PLAN Phase 6): each node is
// tagged with the lowest tier whose rules include it, and learning with tier
// N covers every node with tier ≤ N. A node's tier is never below its
// parent's, so the trees nest.
import { Chess, type Color } from 'chess.js';
import { LEVELS } from '../app/levels';
import { cutLine, type Motif } from './lines';
import type { CourseDef } from './opening-courses';
import { openingIdeas, type IdeaTag } from './opening-ideas';

/** What decides the tree at one tier (one coach). */
export interface TierRule {
  tier: number;
  /** Lichess explorer rating group: games by players from this rating up to the next group. */
  band: number;
  /** Maia's rating for this tier (the fallback source, and the coach's strength). */
  maiaElo: number;
  /** A reply is common enough to teach when this share of players at the band play it. */
  minShare: number;
  /** ...and the line up to it is reached this often (product of the replies' shares since the course start). */
  minReach: number;
  /** The player's moves taught after the defining moves. */
  depth: number;
}

/**
 * First pass (PLAN 6.1): ≥10% replies at Pip down to ≥5% at the top tier,
 * about 3 player moves past the defining ones at Pip up to 8. Explorer bands:
 * Lichess's groups are 0 (under 1000), 1000, 1200, 1400, 1600, 1800, …; the
 * two lowest tiers share the under-1000 group.
 */
export const TIER_RULES: TierRule[] = [
  { tier: 1, band: 0, minShare: 0.1, minReach: 0.05, depth: 3 },
  { tier: 2, band: 0, minShare: 0.09, minReach: 0.04, depth: 4 },
  { tier: 3, band: 1000, minShare: 0.08, minReach: 0.03, depth: 5 },
  { tier: 4, band: 1200, minShare: 0.07, minReach: 0.02, depth: 6 },
  { tier: 5, band: 1600, minShare: 0.06, minReach: 0.015, depth: 7 },
  { tier: 6, band: 1800, minShare: 0.05, minReach: 0.01, depth: 8 },
].map((r) => ({ ...r, maiaElo: LEVELS[r.tier - 1].maiaElo }));

/** A reply played this often or more is taught when it is a trap (it loses ≥ TRAP_LOSS_CP). */
export const TRAP_SHARE = 0.03;
export const TRAP_LOSS_CP = 200;
/** The player's move: the most played among the moves this close to Stockfish's best. */
export const PLAYER_SLACK_CP = 30;
/** A system move (`CourseDef.prefer`) is kept if this close to the best. */
export const PREFER_SLACK_CP = 50;
/** No player move may lose this much: the strictest level's mistake threshold. */
export const MAX_PLAYER_LOSS_CP = Math.min(...LEVELS.map((l) => l.mistakeCp));
/** Replies kept per position at most (the most played). */
export const MAX_REPLIES = 6;
/** Plies of Stockfish's line stored after each reply (layer 2). */
export const LINE_PLIES = 8;
/** Cut limits for the taught consequence of a reply: the deepest level's. */
const TAUGHT_LIMITS = { maxPlies: LEVELS[LEVELS.length - 1].maxPlies, minGain: 1 };

export interface ReplyStats {
  source: 'explorer' | 'maia';
  /** Games behind the shares (explorer only). */
  games?: number;
  /** Share of players who play each move (UCI). */
  shares: Map<string, number>;
}

/** An engine evaluation, from the side to move: best score and the top lines (first move, score, line). */
export interface EngineEval {
  bestCp: number;
  mateIn?: number;
  lines: { uci: string; cp: number; pv: string[] }[];
}

export interface TreeProviders {
  /** How players at the rule's band answer in this position (`history`: UCI moves from the start). */
  replies(fen: string, history: string[], rule: TierRule): Promise<ReplyStats>;
  /** How popular each move is, to pick the player's move among near-equal ones. */
  popularity(fen: string, history: string[]): Promise<Map<string, number>>;
  /** Stockfish: the best score and top `multiPv` lines for the side to move. */
  evaluate(fen: string, multiPv: number): Promise<EngineEval>;
  /** The named opening of exactly this position, if any. */
  openingName?(fen: string): string | undefined;
}

export interface TaughtSummary {
  plies: number;
  gain: number;
  mate: boolean;
  motif: Motif;
}

export interface CourseNode {
  id: number;
  /** -1 for the root (the start position). */
  parent: number;
  /** The position after the move. */
  fen: string;
  san: string;
  uci: string;
  who: 'start' | 'player' | 'opponent';
  /** The lowest tier (coach) whose course includes this node. */
  tier: number;
  /** One of the course's defining moves (shown, not quizzed). */
  defining?: true;
  /** Opponent replies: the share of players playing it, per tier (null where not counted). */
  share?: (number | null)[];
  /** Where each tier's share came from: e = Lichess explorer, m = Maia. */
  src?: ('e' | 'm' | null)[];
  tags: IdeaTag[];
  /** Stockfish's score after the move, from the player's side, in centipawns (mates ±100000). */
  eval: number;
  /** How much worse the move is than the mover's best, in centipawns. */
  loss: number;
  /** A reply that loses ≥ TRAP_LOSS_CP: the course teaches the punishment. */
  trap?: true;
  /** After an opponent reply: Stockfish's line for the player (SAN) and its taught part, if any. */
  line?: { pv: string[]; taught?: TaughtSummary };
  /** The Lichess opening name of the position, when it has one. */
  opening?: string;
  children: number[];
}

export interface CourseTree {
  version: 1;
  id: string;
  opening: string;
  side: Color;
  role: 'play' | 'meet';
  defining: string[];
  rules: TierRule[];
  nodes: CourseNode[];
}

const sideOf = (fen: string) => fen.split(' ')[1] as Color;

function sansOf(fen: string, ucis: string[]): string[] {
  const c = new Chess(fen);
  const out: string[] = [];
  for (const u of ucis) {
    try {
      out.push(c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] }).san);
    } catch {
      break;
    }
  }
  return out;
}

export async function buildCourse(def: CourseDef, p: TreeProviders, rules: TierRule[] = TIER_RULES): Promise<CourseTree> {
  const n = rules.length;
  const maxDepth = Math.max(...rules.map((r) => r.depth));
  const nodes: CourseNode[] = [];
  const sans = new Map<number, string[]>();
  const ucis = new Map<number, string[]>();
  const captured = new Map<number, boolean>();
  const memo = new Map<string, Promise<EngineEval>>();

  /** Player to move: the top lines, to choose from; else just the best score. */
  const evalPos = (fen: string) => {
    const multi = sideOf(fen) === def.side ? 4 : 1;
    const key = `${multi} ${fen}`;
    if (!memo.has(key)) memo.set(key, p.evaluate(fen, multi));
    return memo.get(key)!;
  };
  const forPlayer = (fen: string, cp: number) => (sideOf(fen) === def.side ? cp : -cp) || 0;
  const over = (fen: string) => new Chess(fen).isGameOver();

  /** How much worse `uci` is than the best move at `fen`, for the side to move there. */
  async function lossOf(fen: string, uci: string, afterFen: string): Promise<number> {
    const e = await evalPos(fen);
    const line = e.lines.find((l) => l.uci === uci);
    const value = line ? line.cp : over(afterFen) && new Chess(afterFen).isCheckmate() ? 100000 : -(await evalPos(afterFen)).bestCp;
    return Math.max(0, e.bestCp - value);
  }

  async function add(parent: CourseNode, uci: string, fields: Partial<CourseNode> & { tier: number }): Promise<CourseNode> {
    const chess = new Chess(parent.fen);
    const m = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    const fen = chess.fen();
    const node: CourseNode = {
      id: nodes.length,
      parent: parent.id,
      fen,
      san: m.san,
      uci,
      who: sideOf(parent.fen) === def.side ? 'player' : 'opponent',
      tier: fields.tier,
      tags: openingIdeas(parent.fen, uci, parent.parent >= 0 ? { to: parent.uci.slice(2, 4) as never, captured: captured.get(parent.id)! } : undefined),
      eval: 0,
      loss: 0,
      children: [],
    };
    Object.assign(node, fields);
    nodes.push(node);
    parent.children.push(node.id);
    sans.set(node.id, [...sans.get(parent.id)!, m.san]);
    ucis.set(node.id, [...ucis.get(parent.id)!, uci]);
    captured.set(node.id, !!m.captured);
    const name = p.openingName?.(fen);
    if (name) node.opening = name;
    if (chess.isCheckmate()) node.eval = forPlayer(fen, -100000);
    else if (!chess.isGameOver()) node.eval = forPlayer(fen, (await evalPos(fen)).bestCp);
    node.loss = await lossOf(parent.fen, uci, fen);
    return node;
  }

  function checkPlayerMove(node: CourseNode) {
    if (node.who === 'player' && node.loss >= MAX_PLAYER_LOSS_CP) {
      throw new Error(`${def.id}: ${sans.get(node.id)!.join(' ')} loses ${node.loss} cp (limit ${MAX_PLAYER_LOSS_CP})`);
    }
  }

  async function consequence(node: CourseNode): Promise<CourseNode['line']> {
    if (over(node.fen)) return undefined;
    const e = await evalPos(node.fen);
    const pv = e.lines[0]?.pv ?? [];
    const cut = cutLine(node.fen, pv, { ...TAUGHT_LIMITS, evalCp: e.bestCp, mateIn: e.mateIn });
    const line: NonNullable<CourseNode['line']> = { pv: sansOf(node.fen, pv.slice(0, LINE_PLIES)) };
    if (cut.kind === 'line') line.taught = { plies: cut.line.moves.length, gain: cut.line.gain, mate: cut.line.mate, motif: cut.line.motif };
    return line;
  }

  /** The lowest tier (from `from` up) that teaches a k-th player move; undefined past the deepest. */
  const tierForDepth = (from: number, k: number) => rules.find((r) => r.tier >= from && r.depth >= k)?.tier;

  async function choosePlayerMove(node: CourseNode, afterTrap: boolean): Promise<string> {
    const fen = node.fen;
    const e = await evalPos(fen);
    const legal = new Chess(fen).moves({ verbose: true });
    const bySan = (san: string) => legal.find((m) => m.san === san);
    const uciOf = (m: { from: string; to: string; promotion?: string }) => m.from + m.to + (m.promotion ?? '');
    const forced = def.moves?.[sans.get(node.id)!.join(' ')];
    if (forced) {
      const m = bySan(forced);
      if (!m) throw new Error(`${def.id}: ${forced} is not legal after ${sans.get(node.id)!.join(' ')}`);
      return uciOf(m);
    }
    if (afterTrap || !e.lines.length) return e.lines[0]?.uci ?? uciOf(legal[0]);
    const best = e.bestCp;
    const sanOf = (uci: string) => legal.find((m) => uciOf(m) === uci)?.san;
    for (const san of def.prefer ?? []) {
      const l = e.lines.find((x) => sanOf(x.uci) === san && best - x.cp <= PREFER_SLACK_CP);
      if (l) return l.uci;
    }
    const near = e.lines.filter((l) => best - l.cp <= PLAYER_SLACK_CP);
    const pop = await p.popularity(fen, ucis.get(node.id)!);
    let pick = near[0];
    for (const l of near) if ((pop.get(l.uci) ?? 0) > (pop.get(pick.uci) ?? 0)) pick = l;
    return pick.uci;
  }

  /** `node`: the player is to move after it. `count`: player moves taught so far (after the defining ones). */
  async function expandPlayer(node: CourseNode, reach: number[], count: number, afterTrap: boolean): Promise<void> {
    if (over(node.fen)) return;
    const tier = tierForDepth(node.tier, count + 1);
    if (tier === undefined) return;
    const uci = await choosePlayerMove(node, afterTrap);
    const child = await add(node, uci, { tier });
    checkPlayerMove(child);
    if (afterTrap) return; // the punishment is the end of a trap's line
    await expandOpponent(child, reach, count + 1);
  }

  /** `node`: the opponent is to move after it. */
  async function expandOpponent(node: CourseNode, reach: number[], count: number): Promise<void> {
    if (over(node.fen) || count >= maxDepth) return;
    const history = ucis.get(node.id)!;
    const cands = new Map<string, { share: (number | null)[]; src: ('e' | 'm' | null)[] }>();
    for (let t = 0; t < n; t++) {
      const r = rules[t];
      if (r.depth < count + 1 || reach[t] < r.minReach) continue;
      const stats = await p.replies(node.fen, history, r);
      for (const [uci, share] of stats.shares) {
        if (share < TRAP_SHARE) continue;
        if (!cands.has(uci)) cands.set(uci, { share: Array(n).fill(null), src: Array(n).fill(null) });
        cands.get(uci)!.share[t] = Math.round(share * 1000) / 1000;
        cands.get(uci)!.src[t] = stats.source === 'explorer' ? 'e' : 'm';
      }
    }
    // Evaluate every candidate's position at once (the engine pool runs them in parallel).
    const after = new Map<string, string>();
    for (const uci of cands.keys()) {
      const c = new Chess(node.fen);
      c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
      after.set(uci, c.fen());
    }
    await Promise.all([evalPos(node.fen), ...[...after.values()].filter((f) => !over(f)).map(evalPos)]);

    const picked: { uci: string; tier: number; trap: boolean; loss: number; key: number }[] = [];
    for (const [uci, c] of cands) {
      const loss = await lossOf(node.fen, uci, after.get(uci)!);
      const trap = loss >= TRAP_LOSS_CP;
      const tiers: number[] = [];
      for (let t = 0; t < n; t++) {
        const s = c.share[t];
        if (s === null) continue;
        const common = s >= rules[t].minShare && reach[t] * s >= rules[t].minReach;
        if (common || trap) tiers.push(rules[t].tier);
      }
      if (!tiers.length) continue;
      const first = Math.min(...tiers);
      picked.push({ uci, tier: Math.max(node.tier, first), trap, loss, key: c.share[rules.findIndex((r) => r.tier === first)]! });
    }
    picked.sort((a, b) => a.tier - b.tier || b.key - a.key);
    for (const pk of picked.slice(0, MAX_REPLIES)) {
      const c = cands.get(pk.uci)!;
      const child = await add(node, pk.uci, { tier: pk.tier, share: c.share, src: c.src, ...(pk.trap ? { trap: true as const } : {}) });
      const line = await consequence(child);
      if (line) child.line = line;
      await expandPlayer(child, reach.map((x, t) => x * (c.share[t] ?? 0)), count, pk.trap);
    }
  }

  const start = new Chess();
  const root: CourseNode = { id: 0, parent: -1, fen: start.fen(), san: '', uci: '', who: 'start', tier: 1, tags: [], eval: 0, loss: 0, children: [] };
  root.eval = forPlayer(root.fen, (await evalPos(root.fen)).bestCp);
  nodes.push(root);
  sans.set(0, []);
  ucis.set(0, []);
  captured.set(0, false);

  let node = root;
  for (const san of def.defining) {
    const m = new Chess(node.fen).move(san);
    node = await add(node, m.from + m.to + (m.promotion ?? ''), { tier: 1, defining: true });
    checkPlayerMove(node);
  }
  const reach = Array(n).fill(1);
  if (sideOf(node.fen) === def.side) await expandPlayer(node, reach, 0, false);
  else await expandOpponent(node, reach, 0);

  return { version: 1, id: def.id, opening: def.opening, side: def.side, role: def.role, defining: def.defining, rules, nodes };
}

/** The nodes of the course with this coach tier (every node with tier ≤ it). */
export const nodesForTier = (tree: CourseTree, tier: number): CourseNode[] => tree.nodes.filter((x) => x.tier <= tier);

/** The most common line at a tier: from the root, the reply most played at its band each time, traps last. */
export function mainLine(tree: CourseTree, tier = tree.rules.length): CourseNode[] {
  const out: CourseNode[] = [];
  let node = tree.nodes[0];
  for (;;) {
    const kids = node.children.map((id) => tree.nodes[id]).filter((c) => c.tier <= tier);
    const share = (c: CourseNode) => c.share?.[tier - 1] ?? -1;
    const plain = kids.filter((c) => !c.trap);
    const next = (plain.length ? plain : kids).reduce<CourseNode | undefined>((a, c) => (!a || share(c) > share(a) ? c : a), undefined);
    if (!next) return out;
    out.push(next);
    node = next;
  }
}
