import type { Board, Hole } from "../board";
import type { Point } from "../util/point";
import { Collider } from "./collider";
import {
  BLOCKER_H, CLEARANCE, D, DAMP, DMAX, H0, HOLD_GAIN, HOLD_RADIUS, HOLD_STEP_MAX, ITER, LAND_WAIT, LIFT, LIFT_STEP, MARGIN, OMEGA, POST_R, STEP, VCUT, VMAX, VREST, WARM_EVERY,
} from "./constants";
import { segCross } from "./geom3";
import type { Monitor } from "./monitor";
import { applyPosts, postCandidates } from "./posts";
import {
  pairKey, particle, type ERope, type FlyingEnd, type HeldEnd, type LandingEnd, type P3, type Particle, type PhysCrossing, type Signature,
} from "./types";

interface EndState {
  rope: number;
  end: 0 | 1;
  lifted: boolean;
}

export class Engine {
  readonly board: Board;
  ropes: ERope[] = [];
  held: HeldEnd | null = null;
  flying: FlyingEnd[] = [];
  landing: LandingEnd[] = [];
  contactD = D;
  resampleOn = true;
  tensionOn = true;
  monitor: Monitor | null = null;
  drift = Infinity;
  substeps = 0;
  minDist = Infinity;
  lastMinD = Infinity;
  maxSpeed = 0;
  lastHeld = -1;
  readonly freeIds = new Set<number>();
  private readonly col = new Collider();
  private readonly blockTop: P3 = { x: 0, y: 0, z: 0 };
  private winN = 0;

  constructor(board: Board) {
    this.board = board;
  }

  hole(i: number): Hole {
    const h = this.board.holes[i];
    if (!h) throw new Error(`no hole ${i}`);
    return h;
  }

  rope(id: number): ERope {
    const r = this.ropes[id];
    if (!r) throw new Error(`no rope ${id}`);
    return r;
  }

  addRope(points: readonly P3[], ends: [number, number]): ERope {
    if (points.length < 2) throw new Error("addRope: need at least two points");
    const r: ERope = {
      id: this.ropes.length,
      pts: points.map((q) => particle(q.x, q.y, q.z)),
      ends: [ends[0], ends[1]],
      cleared: false,
      s: new Float64Array(points.length),
      L: 0,
      h: H0,
      maxSeg: 0,
      zeroN: 0,
    };
    computeArc(r);
    this.ropes.push(r);
    return r;
  }

  addClearedRope(): ERope {
    const r: ERope = {
      id: this.ropes.length,
      pts: [],
      ends: [null, null],
      cleared: true,
      s: new Float64Array(0),
      L: 0,
      h: H0,
      maxSeg: 0,
      zeroN: 0,
    };
    this.ropes.push(r);
    return r;
  }

  straightRope(holeA: number, holeB: number): ERope {
    const A = this.hole(holeA), B = this.hole(holeB);
    const n = Math.max(2, Math.round(Math.hypot(B.x - A.x, B.y - A.y) / H0));
    const pts: P3[] = [];
    for (let i = 0; i <= n; i++) pts.push({ x: A.x + ((B.x - A.x) * i) / n, y: A.y + ((B.y - A.y) * i) / n, z: 0 });
    return this.addRope(pts, [holeA, holeB]);
  }

  active(): ERope[] {
    return this.ropes.filter((r) => !r.cleared);
  }

  endPoint(rope: number, end: 0 | 1): Particle {
    const p = this.rope(rope).pts;
    const q = end === 0 ? p[0] : p[p.length - 1];
    if (!q) throw new Error(`rope ${rope} has no points`);
    return q;
  }

  occupied(): Set<number> {
    const s = new Set<number>();
    for (const r of this.ropes) if (!r.cleared) for (const h of r.ends) if (h !== null) s.add(h);
    return s;
  }

  grab(rope: number, end: 0 | 1): void {
    const r = this.rope(rope), from = r.ends[end];
    if (from === null) throw new Error(`grab: rope ${rope} end ${end} is not in a hole`);
    this.held = { rope, end, from, lifted: false };
    r.ends[end] = null;
    this.lastHeld = rope;
  }

  attach(hole: number): void {
    const h = this.held;
    if (!h) throw new Error("attach: nothing held");
    this.land(h, hole);
    this.held = null;
  }

  release(path: readonly Point[], hole: number): void {
    const h = this.held;
    if (!h) throw new Error("release: nothing held");
    if (path.length === 0) throw new Error("release: empty path");
    this.flying.push({ ...h, path: path.map((p) => ({ x: p.x, y: p.y })), hole, top: { x: 0, y: 0, z: 0 } });
    this.held = null;
  }

  busy(): boolean {
    return this.flying.length > 0 || this.landing.length > 0;
  }

  busyRopes(): Set<number> {
    const s = new Set<number>();
    for (const f of this.flying) s.add(f.rope);
    for (const l of this.landing) s.add(l.rope);
    return s;
  }

  attachMonitor(m: Monitor | null): void {
    this.monitor = m;
    if (m) m.observe(this.signature(), this.freeIds, this.lastHeld, this.substeps);
  }

  resetDrift(): void {
    this.drift = Infinity;
    this.winN = 0;
  }

  substep(target: Point | null): void {
    this.substeps++;
    const act = this.active();
    if (this.held) this.driveEnd(this.held, target);
    for (let i = this.flying.length - 1; i >= 0; i--) {
      const f = this.flying[i]!, T = f.path[0]!;
      this.driveEnd(f, T);
      const p = this.endPoint(f.rope, f.end);
      if (f.lifted && Math.hypot(T.x - p.x, T.y - p.y) < 1e-6) {
        f.path.shift();
        if (f.path.length === 0) {
          this.land(f, f.hole);
          this.flying.splice(i, 1);
        }
      }
    }
    for (let i = this.landing.length - 1; i >= 0; i--) {
      const l = this.landing[i]!, p = l.p;
      p.pz = p.z;
      if (l.wait < LAND_WAIT && !this.holeClear(l)) {
        l.wait++;
        continue;
      }
      p.z = Math.max(0, p.z - STEP);
      if (p.z === 0) this.landing.splice(i, 1);
    }
    integrate(act);
    this.collect(act);
    const d = this.contactD;
    this.col.broadphase((d + MARGIN) / 2 + 1, true);
    this.col.activePairs(d);
    const free = this.freeIds;
    free.clear();
    if (this.held) free.add(this.held.rope);
    for (const f of this.flying) free.add(f.rope);
    for (const l of this.landing) free.add(l.rope);
    const posts = postCandidates(this, act);
    let minD = Infinity;
    for (let it = 0; it < ITER; it++) {
      if (it === ITER >> 1) this.col.activePairs(d);
      if (this.tensionOn) for (const r of act) tension(r.pts, (it & 1) === 1);
      applyPosts(posts);
      minD = this.col.solve(false, d);
      if (it % WARM_EVERY === WARM_EVERY - 1) minD = Math.min(minD, this.col.solve(true, d));
    }
    if (minD < this.minDist) this.minDist = minD;
    this.lastMinD = minD;
    this.maxSpeed = capDisplacement(act);
    if (++this.winN >= 8) {
      this.winN = 0;
      this.drift = measureDrift(act);
    }
    if (this.monitor) this.monitor.observe(this.signature(), this.freeIds, this.lastHeld, this.substeps);
    if (this.resampleOn) {
      for (const r of act) if (r.h > 1.25 * H0 || r.h < 0.8 * H0 || r.maxSeg > 1.8 * H0) resample(r);
    }
  }

  signature(): Signature {
    const col = this.col;
    col.begin();
    for (const r of this.active()) col.addRope(r);
    col.broadphase(1, false);
    const sig: Signature = new Map();
    const segs = col.segs, cand = col.cand, cn = col.candN;
    for (let i = 0; i < cn; i += 2) {
      let sa = segs[cand[i]!]!, sb = segs[cand[i + 1]!]!;
      if (sa.rope === sb.rope) continue;
      if (sa.rope.id > sb.rope.id) [sa, sb] = [sb, sa];
      const hit = segCross(sa.a, sa.b, sb.a, sb.b);
      if (!hit) continue;
      const A = sa.rope, B = sb.rope, tA = hit[0], tB = hit[1];
      const za = sa.a.z + (sa.b.z - sa.a.z) * tA, zb = sb.a.z + (sb.b.z - sb.a.z) * tB;
      const turn = (sa.b.x - sa.a.x) * (sb.b.y - sb.a.y) - (sa.b.y - sa.a.y) * (sb.b.x - sb.a.x);
      const c: PhysCrossing = {
        a: A.id,
        b: B.id,
        over: za >= zb ? A.id : B.id,
        sign: (za >= zb) === turn > 0 ? 1 : -1,
        dz: za - zb,
        x: sa.a.x + (sa.b.x - sa.a.x) * tA,
        y: sa.a.y + (sa.b.y - sa.a.y) * tA,
        ua: A.s[sa.k]! + (A.s[sa.k + 1]! - A.s[sa.k]!) * tA,
        ub: B.s[sb.k]! + (B.s[sb.k + 1]! - B.s[sb.k]!) * tB,
      };
      const key = pairKey(A.id, B.id);
      let arr = sig.get(key);
      if (!arr) sig.set(key, (arr = []));
      arr.push(c);
    }
    for (const arr of sig.values()) arr.sort((p, q) => p.ua - q.ua);
    return sig;
  }

  crossingCounts(): Map<number, number> {
    const out = new Map<number, number>();
    for (const arr of this.signature().values()) {
      for (const c of arr) {
        out.set(c.a, (out.get(c.a) ?? 0) + 1);
        out.set(c.b, (out.get(c.b) ?? 0) + 1);
      }
    }
    return out;
  }

  clearFree(minStreak: number): number[] {
    const counts = this.crossingCounts();
    const cleared: number[] = [];
    for (const r of this.active()) {
      if (r.ends[0] === null || r.ends[1] === null || (counts.get(r.id) ?? 0) > 0) {
        r.zeroN = 0;
        continue;
      }
      r.zeroN++;
      if (r.zeroN >= minStreak) {
        r.cleared = true;
        cleared.push(r.id);
      }
    }
    return cleared;
  }

  private land(h: EndState, hole: number): void {
    const r = this.rope(h.rope), p = this.endPoint(h.rope, h.end), P = this.hole(hole);
    r.ends[h.end] = hole;
    p.x = p.px = P.x;
    p.y = p.py = P.y;
    this.landing.push({ p, hole, rope: r.id, wait: 0, top: { x: p.x, y: p.y, z: p.z + BLOCKER_H } });
  }

  private driveEnd(h: EndState, target: Point | null): void {
    const p = this.endPoint(h.rope, h.end);
    p.px = p.x;
    p.py = p.y;
    p.pz = p.z;
    const zt = this.holdHeight(p, h.rope);
    p.z = p.z < zt ? Math.min(zt, p.z + LIFT_STEP) : Math.max(zt, p.z - STEP);
    if (!h.lifted && p.z >= LIFT - 1e-9) h.lifted = true;
    if (h.lifted && target) {
      const dx = target.x - p.x, dy = target.y - p.y, d = Math.hypot(dx, dy);
      if (d > 1e-9) {
        const fast = p.z >= zt - 1e-9 ? Math.min(HOLD_STEP_MAX, d * HOLD_GAIN) : 0;
        const s = Math.min(d, Math.max(STEP, fast));
        p.x += (dx / d) * s;
        p.y += (dy / d) * s;
      }
    }
  }

  private holdHeight(p: P3, rope: number): number {
    const r2 = (HOLD_RADIUS + HOLD_STEP_MAX) ** 2;
    let m = 0;
    for (const r of this.ropes) {
      if (r.cleared || r.id === rope) continue;
      for (const q of r.pts) {
        if (q.z <= m) continue;
        const dx = q.x - p.x, dy = q.y - p.y;
        if (dx * dx + dy * dy < r2) m = q.z;
      }
    }
    return Math.max(LIFT, m + CLEARANCE);
  }

  private holeClear(l: LandingEnd): boolean {
    const P = this.hole(l.hole), R2 = (POST_R - 2) * (POST_R - 2);
    for (const r of this.ropes) {
      if (r.cleared || r.id === l.rope) continue;
      for (const q of r.pts) {
        const dx = q.x - P.x, dy = q.y - P.y;
        if (dx * dx + dy * dy < R2 && q.z < l.p.z) return false;
      }
    }
    return true;
  }

  private collect(act: readonly ERope[]): void {
    const col = this.col;
    col.begin();
    for (const r of act) col.addRope(r);
    if (this.held) {
      const e = this.endPoint(this.held.rope, this.held.end), top = this.blockTop;
      top.x = e.x;
      top.y = e.y;
      top.z = e.z + BLOCKER_H;
      col.addBlocker(this.rope(this.held.rope), e, top);
    }
    for (const f of this.flying) {
      const e = this.endPoint(f.rope, f.end);
      f.top.x = e.x;
      f.top.y = e.y;
      f.top.z = e.z + BLOCKER_H;
      col.addBlocker(this.rope(f.rope), e, f.top);
    }
    for (const l of this.landing) {
      l.top.z = l.p.z + BLOCKER_H;
      col.addBlocker(this.rope(l.rope), l.p, l.top);
    }
  }
}

export function computeArc(r: ERope): void {
  const p = r.pts, s = new Float64Array(p.length);
  let mx = 0;
  for (let i = 1; i < p.length; i++) {
    const a = p[i - 1]!, b = p[i]!;
    const l = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    if (l > mx) mx = l;
    s[i] = s[i - 1]! + l;
  }
  r.s = s;
  r.L = s[p.length - 1]!;
  r.h = r.L / (p.length - 1);
  r.maxSeg = mx;
}

function resample(r: ERope): void {
  const p = r.pts, n = p.length - 1, s = r.s, L = r.L;
  const m = Math.max(2, Math.round(L / H0));
  const out: Particle[] = [p[0]!];
  let k = 0;
  for (let j = 1; j < m; j++) {
    const u = (L * j) / m;
    while (k < n - 1 && s[k + 1]! < u) k++;
    const seg = s[k + 1]! - s[k]!, t = seg > 1e-12 ? (u - s[k]!) / seg : 0, a = p[k]!, b = p[k + 1]!;
    out.push({
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
      z: a.z + (b.z - a.z) * t,
      px: a.px + (b.px - a.px) * t,
      py: a.py + (b.py - a.py) * t,
      pz: a.pz + (b.pz - a.pz) * t,
      rx: Number.NaN,
      ry: Number.NaN,
      rz: Number.NaN,
    });
  }
  out.push(p[n]!);
  r.pts = out;
  computeArc(r);
}

function integrate(act: readonly ERope[]): void {
  for (const r of act) {
    const p = r.pts, n = p.length;
    for (let i = 1; i < n - 1; i++) {
      const q = p[i]!;
      let vx = (q.x - q.px) * DAMP, vy = (q.y - q.py) * DAMP, vz = (q.z - q.pz) * DAMP;
      const v = Math.hypot(vx, vy, vz);
      if (v > VMAX) {
        const k = VMAX / v;
        vx *= k;
        vy *= k;
        vz *= k;
      } else if (v < VREST) {
        const k = v < VCUT ? 0 : (v - VCUT) / (VREST - VCUT);
        vx *= k;
        vy *= k;
        vz *= k;
      }
      q.px = q.x;
      q.py = q.y;
      q.pz = q.z;
      q.x += vx;
      q.y += vy;
      q.z += vz;
    }
  }
}

function tension(p: Particle[], backward: boolean): void {
  const n = p.length;
  if (backward) for (let i = n - 2; i >= 1; i--) pull(p, i);
  else for (let i = 1; i < n - 1; i++) pull(p, i);
}

function pull(p: Particle[], i: number): void {
  const q = p[i]!, a = p[i - 1]!, b = p[i + 1]!;
  q.x += OMEGA * ((a.x + b.x) * 0.5 - q.x);
  q.y += OMEGA * ((a.y + b.y) * 0.5 - q.y);
  q.z += OMEGA * ((a.z + b.z) * 0.5 - q.z);
}

function capDisplacement(act: readonly ERope[]): number {
  let maxv = 0;
  for (const r of act) {
    const p = r.pts, n = p.length;
    for (let i = 1; i < n - 1; i++) {
      const q = p[i]!;
      const dx = q.x - q.px, dy = q.y - q.py, dz = q.z - q.pz, d = Math.hypot(dx, dy, dz);
      if (d > DMAX) {
        const k = DMAX / d;
        q.x = q.px + dx * k;
        q.y = q.py + dy * k;
        q.z = q.pz + dz * k;
      }
      if (d > maxv) maxv = d;
    }
    computeArc(r);
  }
  return maxv;
}

function measureDrift(act: readonly ERope[]): number {
  let dr = 0;
  for (const r of act) {
    const p = r.pts;
    for (let i = 1; i < p.length - 1; i++) {
      const q = p[i]!;
      const d = Number.isNaN(q.rx) ? 1 : Math.hypot(q.x - q.rx, q.y - q.ry, q.z - q.rz);
      if (d > dr) dr = d;
      q.rx = q.x;
      q.ry = q.y;
      q.rz = q.z;
    }
  }
  return dr;
}
