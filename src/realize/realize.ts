import type { Board } from "../board";
import type { Diagram } from "../diagram";
import type { Engine } from "../engine/engine";
import { Monitor } from "../engine/monitor";
import { mulberry32 } from "../util/rng";
import { compare, type Agreement } from "./compare";
import { assignHoles, buildLayout, pegs } from "./fit";
import type { Layout } from "./layout";
import { placeAndInflate } from "./place";
import { relax, RELAX_ITERATIONS } from "./relax";

export interface RealizeOptions {
  relaxIterations?: number;
  monitor?: boolean;
  onProgress?: () => void;
}

export interface Realized {
  engine: Engine;
  holes: number[];
  layout: Layout;
  agreement: Agreement;
  inflationFlags: number;
  passThroughs: number;
}

export function fitSeed(seed: number): number {
  return (seed ^ 0x5bd1e995) >>> 0;
}

export function realize(d: Diagram, board: Board, seed: number, opts: RealizeOptions = {}): Realized {
  const holes = assignHoles(d, board, mulberry32(fitSeed(seed)));
  const layout = buildLayout(d, board, holes);
  relax(layout, opts.relaxIterations ?? RELAX_ITERATIONS, pegs(board, holes), opts.onProgress);
  const monitor = opts.monitor ? new Monitor() : null;
  const engine = placeAndInflate(layout, board, holes, { monitor, onProgress: opts.onProgress });
  return { engine, holes, layout, agreement: compare(d, engine), inflationFlags: monitor?.count ?? 0, passThroughs: monitor?.kinds.link ?? 0 };
}
