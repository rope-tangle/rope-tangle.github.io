import { ROPE_COUNTS } from "../board";
import type { Engine } from "../engine/engine";
import { fromSnapshot } from "../engine/snapshot";
import type { GenerateFailureKind, GenerateRequest, GeneratorMessage } from "../generate/protocol";
import { storageKeys } from "./records";
import { memoryStore } from "./settings";
import { Stock } from "./stock";

export interface LoadedBoard {
  engine: Engine;
  seed: number;
  ropes: number;
  tries: number;
  generationMs: number;
  prefetched: boolean;
}

export function fillOrder(current: number, sizes: readonly number[]): number[] {
  return [...sizes].sort((a, b) => Math.abs(a - current) - Math.abs(b - current) || a - b);
}

export function randomSeed(): number {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return (a[0]! % 2_000_000_000) + 1;
}

export const GENERATOR_TIMEOUT_MS = 30_000;

export interface GeneratorWorker {
  addEventListener(type: "message", listener: (e: MessageEvent<GeneratorMessage>) => void): void;
  addEventListener(type: "error", listener: () => void): void;
  postMessage(req: GenerateRequest, options: { transfer: [] }): void;
  terminate(): void;
}

export interface BoardSourceOptions {
  spawn?: () => GeneratorWorker;
  onTimeout?: (ropes: number, background: boolean) => void;
  isHidden?: () => boolean;
  onPrefetchFailed?: (ropes: number, kind: BoardFailure["kind"]) => void;
  stock?: Stock;
  onDumps?: (dumps: string[]) => void;
}

export class BoardFailure extends Error {
  readonly kind: GenerateFailureKind | "timeout" | "crashed" | "superseded";

  constructor(kind: BoardFailure["kind"], message: string) {
    super(message);
    this.kind = kind;
  }
}

interface Pending {
  ropes: number;
  timer: ReturnType<typeof setTimeout>;
  resolve: (b: LoadedBoard) => void;
  reject: (e: BoardFailure) => void;
}

interface Job {
  id: number;
  ropes: number;
  promise: Promise<LoadedBoard>;
  background: boolean;
  claimed: boolean;
}

const spawnGenerator = (): GeneratorWorker => new Worker(new URL("../generate/worker.ts", import.meta.url), { type: "module" });

export class BoardSource {
  private worker: GeneratorWorker | null = null;
  private readonly pending = new Map<number, Pending>();
  private job: Job | null = null;
  private filling = false;
  private current = 5;
  private readonly failed = new Set<number>();
  private nextId = 1;
  private readonly stock: Stock;
  private readonly onDumps: (dumps: string[]) => void;
  private readonly spawnWorker: () => GeneratorWorker;
  private readonly onTimeout: (ropes: number, background: boolean) => void;
  private readonly isHidden: () => boolean;
  private readonly onPrefetchFailed: (ropes: number, kind: BoardFailure["kind"]) => void;

  constructor(options: BoardSourceOptions = {}) {
    this.spawnWorker = options.spawn ?? spawnGenerator;
    this.onTimeout = options.onTimeout ?? (() => undefined);
    this.isHidden = options.isHidden ?? (() => false);
    this.onPrefetchFailed = options.onPrefetchFailed ?? (() => undefined);
    this.stock = options.stock ?? new Stock(memoryStore(), storageKeys("/"));
    this.onDumps = options.onDumps ?? (() => undefined);
  }

  resume(): void {
    for (const [id, p] of this.pending) {
      clearTimeout(p.timer);
      p.timer = this.watch(id, p.ropes);
    }
  }

  next(ropes: number): Promise<LoadedBoard> {
    this.current = ropes;
    this.failed.clear();
    const ready = this.stock.take(ropes);
    if (ready) {
      if (this.job && this.pending.has(this.job.id)) this.job.claimed = false;
      this.pump();
      return Promise.resolve({ engine: fromSnapshot(ready.snapshot), seed: ready.seed, ropes, tries: ready.tries, generationMs: ready.generationMs, prefetched: true });
    }
    return this.obtain(ropes).catch((e: unknown) => {
      if (e instanceof BoardFailure && e.kind === "timeout" && this.current === ropes) return this.obtain(ropes);
      throw e;
    });
  }

  fill(): void {
    this.filling = true;
    this.pump();
  }

  private obtain(ropes: number): Promise<LoadedBoard> {
    const j = this.job;
    if (j && j.ropes === ropes && this.pending.has(j.id)) {
      const prefetched = j.background && !j.claimed;
      j.claimed = true;
      return j.promise.then((b) => ({ ...b, prefetched }));
    }
    return this.start(ropes, false).promise;
  }

  private pump(): void {
    if (!this.filling || (this.job && this.pending.has(this.job.id))) return;
    const missing = ROPE_COUNTS.filter((n) => !this.stock.has(n) && !this.failed.has(n));
    const n = fillOrder(this.current, missing)[0];
    if (n !== undefined) this.start(n, true);
  }

  private start(ropes: number, background: boolean): Job {
    if (this.worker && this.pending.size > 0) this.stop("superseded", "A newer board was requested");
    const id = this.nextId++;
    const promise = new Promise<LoadedBoard>((resolve, reject) => {
      try {
        const worker = (this.worker ??= this.spawn());
        this.pending.set(id, { ropes, timer: this.watch(id, ropes), resolve, reject });
        worker.postMessage({ id, seed: randomSeed(), ropes }, { transfer: [] });
      } catch (e) {
        this.pending.delete(id);
        reject(new BoardFailure("crashed", e instanceof Error ? e.message : String(e)));
      }
    });
    const job: Job = { id, ropes, promise, background, claimed: !background };
    this.job = job;
    promise
      .then(
        () => undefined,
        (e: unknown) => {
          if (!job.claimed && !(e instanceof BoardFailure && e.kind === "superseded")) this.failed.add(ropes);
        },
      )
      .finally(() => {
        if (this.job === job) this.job = null;
        queueMicrotask(() => this.pump());
      });
    return job;
  }

  private watch(id: number, ropes: number): ReturnType<typeof setTimeout> {
    return setTimeout(() => {
      const p = this.pending.get(id);
      if (!p) return;
      if (this.isHidden()) {
        p.timer = this.watch(id, ropes);
        return;
      }
      const j = this.job;
      this.onTimeout(ropes, j !== null && j.id === id && !j.claimed);
      this.stop("timeout", "The board generator didn't answer");
    }, GENERATOR_TIMEOUT_MS);
  }

  private spawn(): GeneratorWorker {
    const w = this.spawnWorker();
    w.addEventListener("message", (e) => {
      const m = e.data, p = this.pending.get(m.id);
      if (!p || this.worker !== w) return;
      clearTimeout(p.timer);
      if ("progress" in m) {
        p.timer = this.watch(m.id, p.ropes);
        return;
      }
      this.pending.delete(m.id);
      const j = this.job, unclaimed = j !== null && j.id === m.id && !j.claimed;
      if (m.ok) {
        this.onDumps(m.dumps);
        if (unclaimed) this.stock.put({ ropes: p.ropes, seed: m.seed, generationMs: m.ms, tries: m.tries, snapshot: m.snapshot });
        p.resolve({ engine: fromSnapshot(m.snapshot), seed: m.seed, ropes: p.ropes, tries: m.tries, generationMs: m.ms, prefetched: false });
      } else {
        if (unclaimed) this.onPrefetchFailed(p.ropes, m.kind);
        p.reject(new BoardFailure(m.kind, m.error));
      }
    });
    w.addEventListener("error", () => {
      if (this.worker === w) this.stop("crashed", "The board generator stopped");
    });
    return w;
  }

  private stop(kind: BoardFailure["kind"], message: string): void {
    const j = this.job;
    if (kind === "crashed" && j && !j.claimed && this.pending.has(j.id)) this.onPrefetchFailed(j.ropes, kind);
    this.worker?.terminate();
    this.worker = null;
    this.job = null;
    const pending = [...this.pending.values()];
    this.pending.clear();
    for (const p of pending) {
      clearTimeout(p.timer);
      p.reject(new BoardFailure(kind, message));
    }
  }
}
