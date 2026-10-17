import { toSnapshot } from "../src/engine/snapshot";
import { easyBoard } from "../src/game/easy";
import { BoardFailure, BoardSource, GENERATOR_TIMEOUT_MS, type GeneratorWorker } from "../src/game/board-source";
import type { GenerateRequest, GeneratorMessage } from "../src/generate/protocol";

interface Behavior {
  ms?: number;
  progressEvery?: number;
  silent?: boolean;
  fail?: { error: string; kind: "no-board" | "error" };
  failCount?: number;
  crash?: boolean;
}

class FakeWorker implements GeneratorWorker {
  readonly requests: GenerateRequest[] = [];
  terminated = false;
  private readonly queue: GenerateRequest[] = [];
  private busy = false;
  private failed = 0;
  private onMessage: ((e: MessageEvent<GeneratorMessage>) => void) | null = null;
  private onError: (() => void) | null = null;
  private readonly behavior: Behavior;

  constructor(behavior: Behavior) {
    this.behavior = behavior;
  }

  addEventListener(type: "message" | "error", listener: (e: MessageEvent<GeneratorMessage>) => void): void {
    if (type === "message") this.onMessage = listener;
    else this.onError = () => listener(new MessageEvent("error"));
  }

  postMessage(req: GenerateRequest): void {
    this.requests.push(req);
    this.queue.push(req);
    this.work();
  }

  terminate(): void {
    this.terminated = true;
  }

  private emit(data: GeneratorMessage): void {
    if (!this.terminated) this.onMessage?.(new MessageEvent("message", { data }));
  }

  private work(): void {
    const req = this.queue[0];
    if (this.busy || !req) return;
    this.busy = true;
    const { ms = 10, progressEvery, silent, crash, failCount = Infinity } = this.behavior;
    const fail = this.behavior.fail && this.failed < failCount ? this.behavior.fail : undefined;
    if (fail) this.failed++;
    if (silent) return;
    if (crash) {
      setTimeout(() => this.onError?.(), ms);
      return;
    }
    if (progressEvery) for (let t = progressEvery; t < ms; t += progressEvery) setTimeout(() => this.emit({ id: req.id, progress: true }), t);
    setTimeout(() => {
      this.emit(
        fail
          ? { id: req.id, ok: false, ...fail }
          : { id: req.id, ok: true, seed: req.ropes * 100, snapshot: toSnapshot(easyBoard()), dumps: [], tries: 1, ms },
      );
      this.queue.shift();
      this.busy = false;
      this.work();
    }, ms);
  }
}

function source(...behaviors: Behavior[]) {
  const workers: FakeWorker[] = [], timeouts: number[] = [], background: boolean[] = [];
  const s = new BoardSource({
    spawn: () => {
      const w = new FakeWorker(behaviors[Math.min(workers.length, behaviors.length - 1)] ?? {});
      workers.push(w);
      return w;
    },
    onTimeout: (ropes, unseen) => {
      timeouts.push(ropes);
      background.push(unseen);
    },
  });
  return { s, workers, timeouts, background };
}

const failure = (kind: BoardFailure["kind"]) => expect.objectContaining({ kind });

describe("board source", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("restarts a generator that falls silent and asks the new one", async () => {
    const { s, workers, timeouts } = source({ silent: true }, {});
    const board = s.next(4);
    await vi.advanceTimersByTimeAsync(GENERATOR_TIMEOUT_MS + 20);
    await expect(board).resolves.toMatchObject({ seed: 400, ropes: 4 });
    expect(workers).toHaveLength(2);
    expect(workers[0]!.terminated).toBe(true);
    expect(timeouts).toEqual([4]);
  });

  it("fails as a timeout after a second generator also falls silent", async () => {
    const { s, timeouts } = source({ silent: true });
    const board = s.next(5);
    const outcome = expect(board).rejects.toEqual(failure("timeout"));
    await vi.advanceTimersByTimeAsync(2 * GENERATOR_TIMEOUT_MS + 20);
    await outcome;
    expect(timeouts).toEqual([5, 5]);
  });

  it("waits for a slow generator as long as it reports progress", async () => {
    const { s, workers, timeouts } = source({ ms: 100_000, progressEvery: 1_000 });
    const board = s.next(10);
    await vi.advanceTimersByTimeAsync(100_020);
    await expect(board).resolves.toMatchObject({ ropes: 10 });
    expect(workers[0]!.terminated).toBe(false);
    expect(timeouts).toEqual([]);
  });

  it("drops unfinished work for another rope count instead of queueing behind it", async () => {
    const { s, workers, timeouts } = source({ ms: 12_000, progressEvery: 1_000 });
    s.prefetch(5);
    const boards = [7, 8, 9, 10].map((n) => s.next(n));
    for (const b of boards.slice(0, 3)) b.catch(() => undefined);
    await vi.advanceTimersByTimeAsync(12_020);
    await expect(boards[3]).resolves.toMatchObject({ ropes: 10, seed: 1000 });
    for (const b of boards.slice(0, 3)) await expect(b).rejects.toEqual(failure("superseded"));
    expect(workers.map((w) => w.requests.length)).toEqual([1, 1, 1, 1, 1]);
    expect(timeouts).toEqual([]);
  });

  it("shares a board that is still being made for the same rope count", async () => {
    const { s, workers } = source({ ms: 5_000 });
    const first = s.next(6), second = s.next(6);
    await vi.advanceTimersByTimeAsync(5_020);
    expect((await second).engine).toBe((await first).engine);
    expect(workers[0]!.requests).toHaveLength(1);
  });

  it("does not retry a generator that answers with a failure", async () => {
    const { s, workers } = source({ fail: { error: "no agreeing board in 10 tries from seed 7", kind: "no-board" } });
    const board = s.next(4);
    const outcome = expect(board).rejects.toEqual(failure("no-board"));
    await vi.advanceTimersByTimeAsync(20);
    await outcome;
    expect(workers.flatMap((w) => w.requests)).toHaveLength(1);
  });

  it("does not retry a generator that crashed", async () => {
    const { s, workers } = source({ crash: true });
    const board = s.next(4);
    const outcome = expect(board).rejects.toEqual(failure("crashed"));
    await vi.advanceTimersByTimeAsync(20);
    await outcome;
    expect(workers.flatMap((w) => w.requests)).toHaveLength(1);
  });

  it("fails again when asked again after the generator crashed", async () => {
    const { s, workers } = source({ crash: true });
    const first = expect(s.next(4)).rejects.toEqual(failure("crashed"));
    await vi.advanceTimersByTimeAsync(20);
    await first;
    const second = expect(s.next(4)).rejects.toEqual(failure("crashed"));
    await vi.advanceTimersByTimeAsync(20);
    await second;
    expect(workers).toHaveLength(2);
  });

  it("says whether a stalled board was one nobody was waiting for", async () => {
    const { s, background } = source({ silent: true });
    s.prefetch(5);
    await vi.advanceTimersByTimeAsync(GENERATOR_TIMEOUT_MS + 20);
    const board = s.next(4);
    board.catch(() => undefined);
    await vi.advanceTimersByTimeAsync(GENERATOR_TIMEOUT_MS + 20);
    expect(background).toEqual([true, false]);
  });

  it("does not count time while the page is hidden and gives a resumed page a fresh 30 seconds", async () => {
    let hidden = true;
    const workers: FakeWorker[] = [], timeouts: number[] = [];
    const s = new BoardSource({
      spawn: () => {
        const w = new FakeWorker({ silent: true });
        workers.push(w);
        return w;
      },
      onTimeout: (ropes) => timeouts.push(ropes),
      isHidden: () => hidden,
    });
    s.prefetch(5);
    await vi.advanceTimersByTimeAsync(5 * GENERATOR_TIMEOUT_MS);
    expect(timeouts).toEqual([]);
    hidden = false;
    s.resume();
    await vi.advanceTimersByTimeAsync(GENERATOR_TIMEOUT_MS - 1_000);
    expect(timeouts).toEqual([]);
    expect(workers[0]!.terminated).toBe(false);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(timeouts).toEqual([5]);
  });

  it("asks again for a board whose prefetch failed instead of reusing the failure", async () => {
    const { s, workers } = source({ fail: { error: "no agreeing board in 10 tries from seed 7", kind: "no-board" }, failCount: 1 });
    s.prefetch(4);
    await vi.advanceTimersByTimeAsync(20);
    const board = s.next(4);
    await vi.advanceTimersByTimeAsync(20);
    await expect(board).resolves.toMatchObject({ ropes: 4, prefetched: false });
    expect(workers.flatMap((w) => w.requests)).toHaveLength(2);
  });

  it("reports prefetches that crashed or failed while nobody was waiting for them", async () => {
    const failed: [number, string][] = [];
    const make = (behavior: Behavior) =>
      new BoardSource({ spawn: () => new FakeWorker(behavior), onPrefetchFailed: (ropes, kind) => failed.push([ropes, kind]) });
    make({ crash: true }).prefetch(4);
    make({ fail: { error: "no agreeing board in 10 tries from seed 7", kind: "no-board" } }).prefetch(5);
    const waited = make({ crash: true });
    waited.prefetch(6);
    waited.next(6).catch(() => undefined);
    const silent = make({ silent: true });
    silent.prefetch(7);
    await vi.advanceTimersByTimeAsync(GENERATOR_TIMEOUT_MS + 20);
    expect(failed).toEqual([
      [4, "crashed"],
      [5, "no-board"],
    ]);
  });

  it("fails as a crash when the generator cannot even start", async () => {
    const s = new BoardSource({
      spawn: () => {
        throw new Error("no workers here");
      },
    });
    await expect(s.next(4)).rejects.toEqual(failure("crashed"));
  });

  it("says whether a board was prefetched", async () => {
    const { s } = source({ ms: 1_000 });
    s.prefetch(4);
    await vi.advanceTimersByTimeAsync(1_020);
    await expect(s.next(4)).resolves.toMatchObject({ prefetched: true });
    const fresh = s.next(4);
    await vi.advanceTimersByTimeAsync(1_020);
    await expect(fresh).resolves.toMatchObject({ prefetched: false });
  });

  it("leaves the player's board alone when asked to prefetch while it is being made", async () => {
    const { s, workers } = source({ ms: 5_000 });
    const board = s.next(8);
    s.prefetch(8);
    await vi.advanceTimersByTimeAsync(5_020);
    await expect(board).resolves.toMatchObject({ ropes: 8 });
    expect(workers).toHaveLength(1);
    expect(workers[0]!.requests).toHaveLength(1);
  });
});
