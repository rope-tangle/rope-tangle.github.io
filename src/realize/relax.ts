import { D, POST_R } from "../engine/constants";
import type { Point } from "../util/point";
import { edgePairOk, edgeRopes, edges, passes, PEG_CLEAR, pointSegDist, rotationOk, type Edge, type Layout, type Peg } from "./layout";

export const RELAX_ITERATIONS = 60;
const PULL = 0.5;
const PUSH = 0.5;
const ROOM = 0.45;
const BOX_PAD = 1e-3;

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

function boxOf(L: Layout, e: Edge): Box {
  const a = L.nodes[e.a]!, b = L.nodes[e.b]!;
  return {
    x0: Math.min(a.x, b.x) - BOX_PAD,
    y0: Math.min(a.y, b.y) - BOX_PAD,
    x1: Math.max(a.x, b.x) + BOX_PAD,
    y1: Math.max(a.y, b.y) + BOX_PAD,
  };
}

function disjoint(p: Box, q: Box): boolean {
  return p.x1 < q.x0 || q.x1 < p.x0 || p.y1 < q.y0 || q.y1 < p.y0;
}

interface Graph {
  es: Edge[];
  incident: number[][];
  nbrs: number[][];
  passes: Map<number, [number, number][]>;
  edgePegs: Peg[][];
  nodePegs: Peg[][];
  boxes: Box[];
}

function side(a: Point, b: Point, p: Point): number {
  return (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
}

function inTriangle(p: Point, a: Point, b: Point, c: Point): boolean {
  const d1 = side(a, b, p), d2 = side(b, c, p), d3 = side(c, a, p);
  const neg = d1 < 0 || d2 < 0 || d3 < 0, pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
}

function graphOf(L: Layout, pegs: readonly Peg[]): Graph {
  const es = edges(L), ropes = edgeRopes(L);
  const incident: number[][] = L.nodes.map(() => []);
  const nbrs: number[][] = L.nodes.map(() => []);
  es.forEach((e, i) => {
    incident[e.a]!.push(i);
    incident[e.b]!.push(i);
    nbrs[e.a]!.push(e.b);
    nbrs[e.b]!.push(e.a);
  });
  const edgePegs = es.map((_, i) => pegs.filter((p) => p.rope !== ropes[i]));
  const nodePegs = L.nodes.map((_, n) => pegs.filter((p) => incident[n]!.every((i) => ropes[i] !== p.rope)));
  return { es, incident, nbrs, passes: passes(L), edgePegs, nodePegs, boxes: es.map((e) => boxOf(L, e)) };
}

function pegDistances(L: Layout, g: Graph, n: number): number[] {
  const out: number[] = [];
  for (const i of g.incident[n]!) {
    const e = g.es[i]!;
    for (const p of g.edgePegs[i]!) out.push(pointSegDist(p, L.nodes[e.a]!, L.nodes[e.b]!));
  }
  return out;
}

function clearance(L: Layout, g: Graph, n: number): number {
  const p = L.nodes[n]!, inc = g.incident[n]!;
  let best = Infinity;
  for (let i = 0; i < g.es.length; i++) {
    if (inc.includes(i)) continue;
    const b = g.boxes[i]!;
    const dx = Math.max(b.x0 - p.x, 0, p.x - b.x1), dy = Math.max(b.y0 - p.y, 0, p.y - b.y1);
    if (dx * dx + dy * dy >= best * best) continue;
    const e = g.es[i]!;
    best = Math.min(best, pointSegDist(p, L.nodes[e.a]!, L.nodes[e.b]!));
  }
  return best;
}

function refreshBoxes(L: Layout, g: Graph, n: number): void {
  for (const i of g.incident[n]!) g.boxes[i] = boxOf(L, g.es[i]!);
}

function tryMove(L: Layout, g: Graph, n: number, x: number, y: number): boolean {
  const node = L.nodes[n]!, from = { x: node.x, y: node.y }, to = { x, y };
  for (const m of g.nbrs[n]!) {
    const M = L.nodes[m]!;
    const flat = side(from, to, M) === 0;
    const x0 = Math.min(from.x, to.x, M.x), x1 = Math.max(from.x, to.x, M.x);
    const y0 = Math.min(from.y, to.y, M.y), y1 = Math.max(from.y, to.y, M.y);
    for (let q = 0; q < L.nodes.length; q++) {
      if (q === n || q === m) continue;
      const Q = L.nodes[q]!;
      if (!flat && (Q.x < x0 || Q.x > x1 || Q.y < y0 || Q.y > y1)) continue;
      if (inTriangle(Q, from, to, M)) return false;
    }
  }
  const before = pegDistances(L, g, n);
  node.x = x;
  node.y = y;
  refreshBoxes(L, g, n);
  let ok = pegDistances(L, g, n).every((d, i) => d >= POST_R || d >= before[i]!);
  for (const i of g.incident[n]!) {
    if (!ok) break;
    const bi = g.boxes[i]!;
    for (let j = 0; j < g.es.length && ok; j++) {
      if (j === i || disjoint(bi, g.boxes[j]!)) continue;
      if (!edgePairOk(L, g.es[i]!, g.es[j]!)) ok = false;
    }
  }
  if (ok) {
    for (const m of [n, ...g.nbrs[n]!]) {
      const list = g.passes.get(m);
      if (list && !rotationOk(L, m, list)) {
        ok = false;
        break;
      }
    }
  }
  if (!ok) {
    node.x = from.x;
    node.y = from.y;
    refreshBoxes(L, g, n);
  }
  return ok;
}

export function relax(L: Layout, iterations: number = RELAX_ITERATIONS, pegs: readonly Peg[] = [], onStep: () => void = () => undefined): void {
  const g = graphOf(L, pegs);
  for (let it = 0; it < iterations; it++) {
    onStep();
    let moved = 0;
    for (let n = 0; n < L.nodes.length; n++) {
      const node = L.nodes[n]!;
      if (node.fixed) continue;
      const nb = g.nbrs[n]!;
      let bx = 0, by = 0;
      for (const m of nb) {
        bx += L.nodes[m]!.x;
        by += L.nodes[m]!.y;
      }
      let sx = PULL * (bx / nb.length - node.x), sy = PULL * (by / nb.length - node.y);
      for (let q = 0; q < L.nodes.length; q++) {
        if (q === n) continue;
        const Q = L.nodes[q]!, dx = node.x - Q.x, dy = node.y - Q.y, dist = Math.hypot(dx, dy);
        if (dist > 1e-12 && dist < D) {
          sx += (PUSH * dx * (D - dist)) / dist;
          sy += (PUSH * dy * (D - dist)) / dist;
        }
      }
      for (const p of g.nodePegs[n]!) {
        const dx = node.x - p.x, dy = node.y - p.y, dist = Math.hypot(dx, dy);
        if (dist > 1e-12 && dist < PEG_CLEAR) {
          sx += (PUSH * dx * (PEG_CLEAR - dist)) / dist;
          sy += (PUSH * dy * (PEG_CLEAR - dist)) / dist;
        }
      }
      const len = Math.hypot(sx, sy);
      if (len < 1e-4) continue;
      const room = ROOM * clearance(L, g, n);
      if (len > room) {
        sx *= room / len;
        sy *= room / len;
      }
      if (tryMove(L, g, n, node.x + sx, node.y + sy) || tryMove(L, g, n, node.x + sx / 2, node.y + sy / 2)) moved++;
    }
    if (moved === 0) break;
  }
}
