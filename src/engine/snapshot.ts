import { PITCH, rimBoard } from "../board";
import { Engine } from "./engine";
import type { P3 } from "./types";

export type RopeSnapshot = { pts: Float64Array<ArrayBuffer>; ends: [number, number] } | { cleared: true };

export interface EngineSnapshot {
  cols: number;
  rows: number;
  ropes: RopeSnapshot[];
}

export function toSnapshot(E: Engine): EngineSnapshot {
  return {
    cols: Math.round(E.board.width / PITCH) + 1,
    rows: Math.round(E.board.height / PITCH) + 1,
    ropes: E.ropes.map((r): RopeSnapshot => {
      if (r.cleared) return { cleared: true };
      const [a, b] = r.ends;
      if (a === null || b === null) throw new Error(`toSnapshot: rope ${r.id} has an end out of its hole`);
      const pts = new Float64Array(r.pts.length * 6);
      r.pts.forEach((p, i) => pts.set([p.x, p.y, p.z, p.px, p.py, p.pz], i * 6));
      return { pts, ends: [a, b] };
    }),
  };
}

export function fromSnapshot(s: EngineSnapshot): Engine {
  const E = new Engine(rimBoard(s.cols, s.rows));
  for (const r of s.ropes) {
    if ("cleared" in r) {
      E.addClearedRope();
      continue;
    }
    const pts: P3[] = [];
    for (let i = 0; i < r.pts.length; i += 6) pts.push({ x: r.pts[i]!, y: r.pts[i + 1]!, z: r.pts[i + 2]! });
    const rope = E.addRope(pts, r.ends);
    rope.pts.forEach((p, i) => {
      p.px = r.pts[i * 6 + 3]!;
      p.py = r.pts[i * 6 + 4]!;
      p.pz = r.pts[i * 6 + 5]!;
    });
  }
  return E;
}

export function snapshotTransfer(s: EngineSnapshot): ArrayBuffer[] {
  return s.ropes.flatMap((r) => ("cleared" in r ? [] : [r.pts.buffer]));
}
