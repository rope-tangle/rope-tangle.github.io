import type { Engine } from "../engine/engine";
import { fromSnapshot } from "../engine/snapshot";
import type { GenerateFailureKind, GenerateRequest, GeneratorMessage } from "../generate/protocol";

export interface LoadedBoard {
  engine: Engine;
  seed: number;
  ropes: number;
  dumps: string[];
  tries: number;
  generationMs: number;
  prefetched: boolean;
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

interface Slot {
  id: number;
  ropes: number;
  promise: Promise<LoadedBoard>;
  prefetch: boolean;
  taken: boolean;
}

const spawnGenerator = (): GeneratorWorker => new Worker(new URL("../generate/worker.ts", import.meta.url), { type: "module" });

export class BoardSource {
  private worker: GeneratorWorker | null = null;
  private readonly pending = new Map<number, Pending>();
  private slot: Slot | null = null;
  private nextId = 1;
  private readonly spawnWorker: () => GeneratorWorker;
  private readonly onTimeout: (ropes: number, background: boolean) => void;
  private readonly isHidden: () => boolean;
  private readonly onPrefetchFailed: (ropes: number, kind: BoardFailure["kind"]) => void;

  constructor(options: BoardSourceOptions = {}) {
    this.spawnWorker = options.spawn ?? spawnGenerator;
    this.onTimeout = options.onTimeout ?? (() => undefined);
    this.isHidden = options.isHidden ?? (() => false);
    this.onPrefetchFailed = options.onPrefetchFailed ?? (() => undefined);
  }

  resume(): void {
    for (const [id, p] of this.pending) {
      clearTimeout(p.timer);
      p.timer = this.watch(id, p.ropes);
    }
  }

  next(ropes: number): Promise<LoadedBoard> {
    return this.obtain(ropes).catch((e: unknown) => {
      if (e instanceof BoardFailure && e.kind === "timeout") return this.obtain(ropes);
      throw e;
    });
  }

  prefetch(ropes: number): void {
    const s = this.slot;
    if (s && s.ropes === ropes && !s.taken) return;
    if (s && s.taken && this.pending.has(s.id)) return;
    this.start(ropes, true).catch(() => undefined);
  }

  private obtain(ropes: number): Promise<LoadedBoard> {
    const s = this.slot;
    if (s && s.ropes === ropes && (!s.taken || this.pending.has(s.id))) {
      const prefetched = s.prefetch && !s.taken;
      s.taken = true;
      return s.promise.then((b) => ({ ...b, prefetched }));
    }
    const promise = this.start(ropes, false);
    this.slot!.taken = true;
    return promise;
  }

  private start(ropes: number, prefetch: boolean): Promise<LoadedBoard> {
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
    this.slot = { id, ropes, promise, prefetch, taken: false };
    return promise;
  }

  private watch(id: number, ropes: number): ReturnType<typeof setTimeout> {
    return setTimeout(() => {
      const p = this.pending.get(id);
      if (!p) return;
      if (this.isHidden()) {
        p.timer = this.watch(id, ropes);
        return;
      }
      const s = this.slot;
      this.onTimeout(ropes, s !== null && s.id === id && s.prefetch && !s.taken);
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
      if (m.ok) {
        p.resolve({ engine: fromSnapshot(m.snapshot), seed: m.seed, ropes: p.ropes, dumps: m.dumps, tries: m.tries, generationMs: m.ms, prefetched: false });
      } else {
        if (this.slot?.id === m.id && !this.slot.taken) {
          this.slot = null;
          this.onPrefetchFailed(p.ropes, m.kind);
        }
        p.reject(new BoardFailure(m.kind, m.error));
      }
    });
    w.addEventListener("error", () => {
      if (this.worker === w) this.stop("crashed", "The board generator stopped");
    });
    return w;
  }

  private stop(kind: BoardFailure["kind"], message: string): void {
    const s = this.slot;
    if (kind === "crashed" && s && !s.taken && this.pending.has(s.id)) this.onPrefetchFailed(s.ropes, kind);
    this.worker?.terminate();
    this.worker = null;
    this.slot = null;
    const pending = [...this.pending.values()];
    this.pending.clear();
    for (const p of pending) {
      clearTimeout(p.timer);
      p.reject(new BoardFailure(kind, message));
    }
  }
}
