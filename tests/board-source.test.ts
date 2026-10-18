import { toSnapshot } from "../src/engine/snapshot";
import { easyBoard } from "../src/game/easy";
import { BoardFailure, BoardSource, fillOrder, GENERATOR_TIMEOUT_MS, type GeneratorWorker } from "../src/game/board-source";
import { storageKeys } from "../src/game/records";
import { memoryStore } from "../src/game/settings";
import { Stock } from "../src/game/stock";
import type { GenerateRequest, GeneratorMessage } from "../src/generate/protocol";

interface Behavior {
  ms?: number;
  progressEvery?: number;
  silent?: boolean;
  fail?: { error: string; kind: "no-board" | "error" };
  failCount?: number;
  crash?: boolean;
  dumps?: string[];
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
          : { id: req.id, ok: true, seed: req.ropes * 100, snapshot: toSnapshot(easyBoard()), dumps: this.behavior.dumps ?? [], tries: 1, ms },
      );
      this.queue.shift();
      this.busy = false;
      this.work();
    }, ms);
  }
}

function source(...behaviors: Behavior[]) {
  const workers: FakeWorker[] = [], timeouts: number[] = [], background: boolean[] = [];
  const stock = new Stock(memoryStore(), storageKeys("/"));
  const s = new BoardSource({
    stock,
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
  return { s, workers, timeouts, background, stock };
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
    s.fill();
    const boards = [7, 8, 9, 10].map((n) => s.next(n));
    for (const b of boards.slice(0, 3)) b.catch(() => undefined);
    await vi.advanceTimersByTimeAsync(12_020);
    await expect(boards[3]).resolves.toMatchObject({ ropes: 10, seed: 1000 });
    for (const b of boards.slice(0, 3)) await expect(b).rejects.toEqual(failure("superseded"));
    expect(workers.map((w) => w.requests[0]!.ropes)).toEqual([5, 7, 8, 9, 10]);
    expect(workers.slice(0, 4).every((w) => w.terminated)).toBe(true);
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
    s.fill();
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
    s.fill();
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

  it("asks again for a board whose background try failed instead of reusing the failure", async () => {
    const { s, workers } = source({ ms: 100, fail: { error: "no agreeing board in 10 tries from seed 7", kind: "no-board" }, failCount: 1 }, { ms: 100 });
    s.fill();
    await vi.advanceTimersByTimeAsync(120);
    const board = s.next(5);
    await vi.advanceTimersByTimeAsync(220);
    await expect(board).resolves.toMatchObject({ ropes: 5, prefetched: false });
    expect(workers.flatMap((w) => w.requests).map((r) => r.ropes).slice(0, 3)).toEqual([5, 4, 5]);
  });

  it("reports background boards that crashed or failed and moves on to the next size", async () => {
    const reports = (behavior: Behavior) => {
      const failed: [number, string][] = [];
      new BoardSource({ spawn: () => new FakeWorker(behavior), onPrefetchFailed: (ropes, kind) => failed.push([ropes, kind]) }).fill();
      return failed;
    };
    const crashed = reports({ crash: true });
    const refused = reports({ fail: { error: "no agreeing board in 10 tries from seed 7", kind: "no-board" } });
    const silent = reports({ silent: true });
    await vi.advanceTimersByTimeAsync(GENERATOR_TIMEOUT_MS + 20);
    expect(crashed).toEqual([5, 4, 6, 7, 8, 9, 10].map((n) => [n, "crashed"]));
    expect(refused).toEqual([5, 4, 6, 7, 8, 9, 10].map((n) => [n, "no-board"]));
    expect(silent).toEqual([]);
  });

  it("fails as a crash when the generator cannot even start", async () => {
    const s = new BoardSource({
      spawn: () => {
        throw new Error("no workers here");
      },
    });
    await expect(s.next(4)).rejects.toEqual(failure("crashed"));
  });

  it("does not start filling while the player's board is being made", async () => {
    const { s, workers } = source({ ms: 5_000 });
    const board = s.next(8);
    s.fill();
    await vi.advanceTimersByTimeAsync(4_000);
    expect(workers[0]!.requests.map((r) => r.ropes)).toEqual([8]);
    await vi.advanceTimersByTimeAsync(1_020);
    await expect(board).resolves.toMatchObject({ ropes: 8, prefetched: false, bundled: false });
    expect(workers).toHaveLength(1);
    expect(workers[0]!.requests.map((r) => r.ropes)).toEqual([8, 8]);
  });

  const stocked = (ropes: number) => ({ ropes, seed: ropes, generationMs: 1, tries: 1, bundled: ropes === 4, snapshot: toSnapshot(easyBoard()) });

  it("orders filling by distance from the current size, smaller first", () => {
    expect(fillOrder(8, [4, 5, 6, 7, 8, 9, 10])).toEqual([8, 7, 9, 6, 10, 5, 4]);
    expect(fillOrder(4, [10, 5])).toEqual([5, 10]);
  });

  it("hands out a stocked board at once and refills that size first", async () => {
    const { s, workers, stock } = source({ ms: 1_000 });
    for (const n of [4, 5, 6]) stock.put(stocked(n));
    await expect(s.next(5)).resolves.toMatchObject({ ropes: 5, seed: 5, prefetched: true, bundled: false });
    s.fill();
    await vi.advanceTimersByTimeAsync(1_020);
    expect(workers[0]!.requests.map((r) => r.ropes)).toEqual([5, 7]);
    expect(stock.has(5)).toBe(true);
  });

  it("says whether a stocked board was a bundled one", async () => {
    const { s, stock } = source({});
    stock.put(stocked(4));
    await expect(s.next(4)).resolves.toMatchObject({ ropes: 4, prefetched: true, bundled: true });
  });

  it("stocks a board the player stopped waiting for", async () => {
    const { s, workers, stock } = source({ ms: 1_000 });
    stock.put(stocked(5));
    s.next(8).catch(() => undefined);
    await expect(s.next(5)).resolves.toMatchObject({ ropes: 5, prefetched: true });
    s.fill();
    await vi.advanceTimersByTimeAsync(1_020);
    expect(stock.has(8)).toBe(true);
    expect(workers[0]!.requests.map((r) => r.ropes)).toEqual([8, 5]);
  });

  it("does not retry a board the player left before it timed out", async () => {
    const { s, workers, stock, background } = source({ silent: true }, { ms: 100 });
    stock.put(stocked(5));
    const left = s.next(8);
    left.catch(() => undefined);
    await expect(s.next(5)).resolves.toMatchObject({ ropes: 5 });
    await vi.advanceTimersByTimeAsync(GENERATOR_TIMEOUT_MS + 200);
    await expect(left).rejects.toEqual(failure("timeout"));
    expect(workers.flatMap((w) => w.requests).map((r) => r.ropes)).toEqual([8]);
    expect(background).toEqual([true]);
  });

  it("moves on to the next size after a background board times out", async () => {
    const { s, workers, stock } = source({ silent: true }, { ms: 100 });
    s.fill();
    await vi.advanceTimersByTimeAsync(GENERATOR_TIMEOUT_MS + 8 * 120);
    expect(workers.flatMap((w) => w.requests).map((r) => r.ropes)).toEqual([5, 4, 6, 7, 8, 9, 10]);
    expect(stock.has(5)).toBe(false);
  });

  it("fills a background size again after another size superseded it", async () => {
    const { s, stock } = source({ ms: 1_000 });
    s.fill();
    const board = s.next(7);
    await vi.advanceTimersByTimeAsync(8 * 1_020);
    await expect(board).resolves.toMatchObject({ ropes: 7 });
    expect(stock.has(5)).toBe(true);
  });

  it("refills the size it is told is current first", async () => {
    const { s, workers } = source({ ms: 100 });
    s.fill(10);
    await vi.advanceTimersByTimeAsync(3 * 120);
    expect(workers[0]!.requests.map((r) => r.ropes).slice(0, 3)).toEqual([10, 9, 8]);
  });

  it("fills every missing size once and then rests", async () => {
  const { s, workers, stock } = source({ ms: 100 });
  s.fill();
  await vi.advanceTimersByTimeAsync(7 * 120);
  expect(workers[0]!.requests.map((r) => r.ropes)).toEqual([5, 4, 6, 7, 8, 9, 10]);
  for (const n of [4, 5, 6, 7, 8, 9, 10]) expect(stock.has(n)).toBe(true);
  await vi.advanceTimersByTimeAsync(1_000);
  expect(workers[0]!.requests).toHaveLength(7);
});

  it("gives a background board someone is waiting for to them and not to the stock", async () => {
    const { s, stock } = source({ ms: 1_000 });
    s.fill();
    const board = s.next(5);
    await vi.advanceTimersByTimeAsync(1_020);
    await expect(board).resolves.toMatchObject({ ropes: 5, prefetched: true });
    expect(stock.has(5)).toBe(false);
  });

  it("moves on after a failed background board and tries it again once a game starts", async () => {
    const { s, workers, stock } = source({ ms: 100, fail: { error: "no agreeing board in 10 tries from seed 7", kind: "no-board" }, failCount: 1 });
    s.fill();
    await vi.advanceTimersByTimeAsync(7 * 120);
    expect(workers[0]!.requests.map((r) => r.ropes)).toEqual([5, 4, 6, 7, 8, 9, 10]);
    expect(stock.has(5)).toBe(false);
    await expect(s.next(4)).resolves.toMatchObject({ ropes: 4, prefetched: true });
    await vi.advanceTimersByTimeAsync(2 * 120);
    expect(workers[0]!.requests.map((r) => r.ropes).slice(7)).toEqual([4, 5]);
    expect(stock.has(5)).toBe(true);
  });

  it("does not report a board the player was waiting for", async () => {
    const failed: number[] = [];
    const s = new BoardSource({ spawn: () => new FakeWorker({ crash: true }), onPrefetchFailed: (ropes) => failed.push(ropes) });
    s.next(6).catch(() => undefined);
    await vi.advanceTimersByTimeAsync(20);
    expect(failed).toEqual([]);
  });

  it("reports the failed tries of every board it makes", async () => {
    const dumps: string[][] = [];
    const s = new BoardSource({ spawn: () => new FakeWorker({ ms: 10, dumps: ["d1"] }), onDumps: (d) => dumps.push(d) });
    s.fill();
    await vi.advanceTimersByTimeAsync(20);
    expect(dumps[0]).toEqual(["d1"]);
  });
});
