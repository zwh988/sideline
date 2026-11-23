// Move navigation and the coach's remark log. Pure state, no DOM, so it can
// be unit-tested. "Ply" = number of moves played from the start position:
// ply 0 is the start position, ply N the position after the Nth move.
import type { Remark } from '../coach/coach';

export class Navigation {
  private livePly = 0;
  private viewedPly: number | null = null;
  private newMoveFlag = false;

  /** Number of moves in the live game. */
  get live(): number {
    return this.livePly;
  }

  /** True while looking at an earlier position. */
  get viewing(): boolean {
    return this.viewedPly !== null;
  }

  /** The position being shown. */
  get ply(): number {
    return this.viewedPly ?? this.livePly;
  }

  /** A move was played in the live game while the player was looking back. */
  get hasNewMove(): boolean {
    return this.newMoveFlag;
  }

  get canBack(): boolean {
    return this.ply > 0;
  }

  get canForward(): boolean {
    return this.viewing;
  }

  reset(livePly = 0): void {
    this.livePly = livePly;
    this.viewedPly = null;
    this.newMoveFlag = false;
  }

  /** The live game now has `n` moves (a move was played, or a takeback). */
  setLive(n: number): void {
    const prev = this.livePly;
    this.livePly = Math.max(0, n);
    if (this.viewedPly === null) return;
    if (this.livePly > prev) this.newMoveFlag = true;
    else if (this.livePly < prev) this.newMoveFlag = false;
    // The viewed position vanished (or is now the live one): back to live.
    if (this.viewedPly >= this.livePly) this.goLive();
  }

  /** Shows the position after `ply` moves, clamped to 0..live. Reaching live is live. */
  goTo(ply: number): void {
    const p = Math.min(Math.max(Math.trunc(ply), 0), this.livePly);
    if (p === this.livePly) this.goLive();
    else this.viewedPly = p;
  }

  start(): void {
    this.goTo(0);
  }

  back(): void {
    this.goTo(this.ply - 1);
  }

  forward(): void {
    if (this.viewing) this.goTo(this.ply + 1);
  }

  goLive(): void {
    this.viewedPly = null;
    this.newMoveFlag = false;
  }
}

/** "12.Nxe5", "12…Nc6", or "Start position" for ply 0. `startFen` gives the numbering. */
export function plyLabel(startFen: string, ply: number, san: string | undefined): string {
  if (ply <= 0 || !san) return 'Start position';
  const [, turn, , , , fullmove] = startFen.split(' ');
  const idx = ply - 1 + (turn === 'b' ? 1 : 0);
  const number = (Number(fullmove) || 1) + Math.floor(idx / 2);
  return `${number}${idx % 2 === 0 ? '.' : '…'}${san}`;
}

export interface LoggedRemark {
  /** Position the remark was said at (moves played). */
  ply: number;
  remark: Remark;
}

/** Everything the coach said this game, each remark kept with its ply. */
export class RemarkLog {
  private entries: LoggedRemark[] = [];

  get all(): readonly LoggedRemark[] {
    return this.entries;
  }

  clear(): void {
    this.entries = [];
  }

  add(ply: number, remark: Remark): void {
    const last = this.entries.at(-1);
    // A new hint step replaces the previous one at the same position.
    if (remark.kind === 'hint' && last?.remark.kind === 'hint' && last.ply === ply) this.entries.pop();
    this.entries.push({ ply, remark });
  }

  /** After a takeback: forget what was said about positions that no longer exist. */
  truncate(ply: number): void {
    this.entries = this.entries.filter((e) => e.ply <= ply);
  }

  /** What was said at exactly this position. */
  at(ply: number): LoggedRemark[] {
    return this.entries.filter((e) => e.ply === ply);
  }

  /**
   * What the bubble shows in the live game: the remark on the player's last
   * move and the coach's reply to it (the live ply and the one before),
   * oldest first. If neither has anything, the latest remark.
   */
  recent(livePly: number): LoggedRemark[] {
    const turn = this.entries.filter((e) => e.ply >= livePly - 1 && e.ply <= livePly);
    if (turn.length) return turn;
    const last = this.entries.at(-1);
    return last ? [last] : [];
  }
}
