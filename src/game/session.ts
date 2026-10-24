import { PEG_R } from "../engine/constants";
import type { Engine } from "../engine/engine";
import type { Point } from "../util/point";

export type Phase = "idle" | "held" | "busy";

export interface Clock {
  now(): number;
}

export const MAX_SUBSTEPS = 60;
export const IDLE_SUBSTEPS = 10;
export const GRAB_RADIUS = PEG_R * 1.5;
const SETTLE_DRIFT = 0.15;
const SETTLE_FRAMES = 240;
const CLEAR_STREAK = 4;
const FADE_STEP = 0.05;

export class Session {
  readonly engine: Engine;
  phase: Phase = "idle";
  moves = 0;
  revision = 0;
  pointer: Point | null = null;
  won = false;
  readonly fades = new Map<number, number>();
  private heldFrom: number | null = null;
  private settleFrames = 0;

  constructor(engine: Engine) {
    this.engine = engine;
  }

  grab(p: Point): boolean {
    if (this.phase === "held" || this.won) return false;
    const E = this.engine, busy = E.busyRopes();
    let best: { rope: number; end: 0 | 1; hole: number } | null = null;
    let bd = GRAB_RADIUS * GRAB_RADIUS;
    for (const r of E.active()) {
      if (busy.has(r.id)) continue;
      for (const end of [0, 1] as const) {
        const h = r.ends[end];
        if (h === null) continue;
        const P = E.hole(h), d = (P.x - p.x) ** 2 + (P.y - p.y) ** 2;
        if (d < bd) {
          bd = d;
          best = { rope: r.id, end, hole: h };
        }
      }
    }
    if (!best) return false;
    E.grab(best.rope, best.end);
    this.heldFrom = best.hole;
    this.pointer = this.clamp(p);
    this.phase = "held";
    return true;
  }

  drag(p: Point): void {
    if (this.phase === "held") this.pointer = this.clamp(p);
  }

  targetHole(): number | null {
    return this.phase === "held" && this.pointer ? this.nearestFreeHole(this.pointer) : null;
  }

  release(): void {
    const p = this.pointer;
    if (this.phase !== "held" || !p) return;
    const hole = this.nearestFreeHole(p);
    if (hole === null) return;
    const P = this.engine.hole(hole);
    this.engine.release([{ x: p.x, y: p.y }, { x: P.x, y: P.y }], hole);
    if (hole !== this.heldFrom) this.moves++;
    this.revision++;
    this.heldFrom = null;
    this.pointer = null;
    this.settle();
  }

  animating(): boolean {
    if (this.phase !== "idle") return true;
    for (const a of this.fades.values()) if (a > 0) return true;
    return false;
  }

  step(clock: Clock, budgetMs: number): number {
    for (const [id, a] of this.fades) if (a > 0) this.fades.set(id, Math.max(0, a - FADE_STEP));
    if (this.phase === "idle") return 0;
    const E = this.engine, t0 = clock.now();
    let used = 0;
    const more = (max: number) => used < max && (used < 2 || clock.now() - t0 <= budgetMs);
    if (this.phase === "held") {
      const held = E.held, target = this.pointer;
      if (!held || !target) return 0;
      let reached = false;
      while (more(MAX_SUBSTEPS)) {
        const c = E.endPoint(held.rope, held.end);
        if (held.lifted && Math.hypot(target.x - c.x, target.y - c.y) < 1e-3) {
          reached = true;
          break;
        }
        E.substep(target);
        used++;
      }
      if (reached) {
        const max = used + (E.flying.length > 0 ? MAX_SUBSTEPS : IDLE_SUBSTEPS);
        while (more(max)) {
          E.substep(target);
          used++;
        }
      }
      return used;
    }
    const max = E.flying.length > 0 ? MAX_SUBSTEPS : IDLE_SUBSTEPS;
    while (more(max)) {
      E.substep(null);
      used++;
    }
    this.settleFrames++;
    if (!E.busy()) {
      const settled = E.drift < SETTLE_DRIFT || this.settleFrames > SETTLE_FRAMES;
      const cleared = E.clearFree(settled ? 1 : CLEAR_STREAK);
      if (cleared.length > 0) {
        for (const id of cleared) this.fades.set(id, 1);
        this.revision++;
        this.settle();
      } else if (settled) {
        this.phase = "idle";
      }
      if (E.active().length === 0) {
        this.phase = "idle";
        this.won = true;
      }
    }
    return used;
  }

  settle(): void {
    this.phase = "busy";
    this.settleFrames = 0;
    this.engine.resetDrift();
  }

  private clamp(p: Point): Point {
    const b = this.engine.board;
    return { x: Math.max(0, Math.min(b.width, p.x)), y: Math.max(0, Math.min(b.height, p.y)) };
  }

  private nearestFreeHole(p: Point): number | null {
    const E = this.engine, taken = E.occupied();
    for (const f of E.flying) taken.add(f.hole);
    let best: number | null = null, bd = Infinity;
    for (let i = 0; i < E.board.holes.length; i++) {
      if (taken.has(i)) continue;
      const h = E.board.holes[i]!, d = (h.x - p.x) ** 2 + (h.y - p.y) ** 2;
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    return best;
  }
}
