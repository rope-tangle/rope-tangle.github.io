import { toSnapshot, type EngineSnapshot } from "../engine/snapshot";
import { RealizeFailed } from "../realize/errors";
import { generateBoard } from "./generate";

export interface GenerateRequest {
  id: number;
  seed: number;
  ropes: number;
}

export type GenerateFailureKind = "no-board" | "error";

export type GenerateResponse =
  | { id: number; ok: true; seed: number; snapshot: EngineSnapshot; dumps: string[]; tries: number; ms: number }
  | { id: number; ok: false; error: string; kind: GenerateFailureKind };

export type GenerateProgress = { id: number; progress: true };

export type GeneratorMessage = GenerateResponse | GenerateProgress;

export function isGenerateRequest(v: unknown): v is GenerateRequest {
  return (
    typeof v === "object" && v !== null && "id" in v && "seed" in v && "ropes" in v &&
    typeof v.id === "number" && typeof v.seed === "number" && typeof v.ropes === "number"
  );
}

export function handleRequest(req: GenerateRequest, onProgress?: () => void): GenerateResponse {
  try {
    const t0 = performance.now(), g = generateBoard(req.seed, req.ropes, onProgress ? { onProgress } : {});
    return { id: req.id, ok: true, seed: g.seed, snapshot: toSnapshot(g.engine), dumps: g.dumps, tries: g.tries, ms: performance.now() - t0 };
  } catch (e) {
    return { id: req.id, ok: false, error: e instanceof Error ? e.message : String(e), kind: e instanceof RealizeFailed ? "no-board" : "error" };
  }
}
