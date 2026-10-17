import type { Board } from "../board";
import { D, H0 } from "../engine/constants";
import { Engine } from "../engine/engine";
import type { Monitor } from "../engine/monitor";
import { settle } from "../engine/settle";
import type { P3 } from "../engine/types";
import type { Point } from "../util/point";
import { edges, passes, type Layout } from "./layout";

export const RAMP = 150;

export interface PlaceOptions {
  monitor: Monitor | null;
  onProgress?: () => void;
}

interface Anchor {
  s: number;
  z: number | null;
}

function pointSegDist(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
  return Math.hypot(p.x - a.x - dx * t, p.y - a.y - dy * t);
}

export function crossingRadii(L: Layout): Map<number, number> {
  const out = new Map<number, number>();
  const es = edges(L);
  for (const node of passes(L).keys()) {
    const P = L.nodes[node]!;
    let r = H0 / 2;
    for (const e of es) {
      const A = L.nodes[e.a]!, B = L.nodes[e.b]!;
      if (e.a === node || e.b === node) r = Math.min(r, Math.hypot(A.x - B.x, A.y - B.y) / 3);
      else r = Math.min(r, pointSegDist(P, A, B) / 2);
    }
    out.set(node, r);
  }
  return out;
}

export function chainPoints(L: Layout, rope: number, radii = crossingRadii(L)): P3[] {
  const r = L.ropes[rope];
  if (!r) throw new Error(`chainPoints: no rope ${rope}`);
  const last = r.nodes.length - 1, S = [0];
  for (let k = 1; k <= last; k++) {
    const P = L.nodes[r.nodes[k]!]!, Q = L.nodes[r.nodes[k - 1]!]!;
    S.push(S[k - 1]! + Math.hypot(P.x - Q.x, P.y - Q.y));
  }
  const anchors: Anchor[] = [];
  for (let k = 0; k <= last; k++) {
    const label = r.labels[k] ?? null;
    if (k === 0 || k === last) anchors.push({ s: S[k]!, z: 0 });
    else if (label === null) anchors.push({ s: S[k]!, z: null });
    else {
      const d = radii.get(r.nodes[k]!) ?? 0, z = label ? D / 2 : -D / 2;
      anchors.push({ s: S[k]! - d, z }, { s: S[k]! + d, z });
    }
  }
  const at = (s: number): Point => {
    let k = 0;
    while (k + 1 < last && S[k + 1]! < s) k++;
    const P = L.nodes[r.nodes[k]!]!, Q = L.nodes[r.nodes[k + 1]!]!, len = S[k + 1]! - S[k]!;
    const t = len > 0 ? (s - S[k]!) / len : 0;
    return { x: P.x + (Q.x - P.x) * t, y: P.y + (Q.y - P.y) * t };
  };
  const pts: P3[] = [], keys: { i: number; s: number; z: number }[] = [];
  anchors.forEach((A, q) => {
    if (A.z !== null) keys.push({ i: pts.length, s: A.s, z: A.z });
    pts.push({ ...at(A.s), z: 0 });
    const B = anchors[q + 1];
    if (!B) return;
    const gap = B.s - A.s, n = Math.ceil(gap / H0);
    for (let j = 1; j < n; j++) pts.push({ ...at(A.s + (gap * j) / n), z: 0 });
  });
  let cursor = 0;
  const arc: number[] = [0];
  for (let i = 1; i < pts.length; i++) arc.push(arc[i - 1]! + Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y));
  for (let i = 0; i < pts.length; i++) {
    while (cursor + 1 < keys.length && keys[cursor + 1]!.i <= i) cursor++;
    const A = keys[cursor]!, B = keys[cursor + 1] ?? A, span = arc[B.i]! - arc[A.i]!;
    pts[i]!.z = span > 0 ? A.z + ((B.z - A.z) * (arc[i]! - arc[A.i]!)) / span : A.z;
  }
  return pts;
}

export function placeAndInflate(L: Layout, board: Board, holes: number[], opts: PlaceOptions): Engine {
  const E = new Engine(board);
  E.contactD = 0;
  E.resampleOn = false;
  E.tensionOn = false;
  const radii = crossingRadii(L);
  L.ropes.forEach((_, i) => E.addRope(chainPoints(L, i, radii), [holes[i * 2]!, holes[i * 2 + 1]!]));
  E.attachMonitor(opts.monitor);
  for (let i = 1; i <= RAMP; i++) {
    E.contactD = (D * i) / RAMP;
    E.substep(null);
    opts.onProgress?.();
  }
  E.tensionOn = true;
  E.resampleOn = true;
  E.minDist = Infinity;
  settle(E, 800, 0.15, opts.onProgress);
  E.attachMonitor(null);
  return E;
}
