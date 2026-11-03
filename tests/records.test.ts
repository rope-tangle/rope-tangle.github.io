import type { Engine } from "../src/engine/engine";
import { settle } from "../src/engine/settle";
import { fromSnapshot, toSnapshot, type EngineSnapshot } from "../src/engine/snapshot";
import type { HistoryEntry } from "../src/game/history";
import { physicalLinking } from "../src/realize/compare";
import { generateBoard } from "../src/generate/generate";
import { GENERATOR_VERSION } from "../src/generate/version";
import {
  decodeGame, decodeReady, decodeSnapshot, encodeGame, encodeReady, encodeSnapshot, HISTORY_DECIMALS, readRecord, removeRecord, storageKeys, writeRecord,
  type GameJson, type ReadyBoard, type ReadyJson, type RopeJson, type SavedGame, type SnapshotJson,
} from "../src/game/records";
import { memoryStore, type KeyValueStore } from "../src/game/settings";

const board4 = (): ReadyBoard => ({ ropes: 4, seed: 7, generationMs: 120, tries: 1, bundled: false, snapshot: toSnapshot(generateBoard(7, 4).engine) });
const roundTrip = (v: unknown): unknown => JSON.parse(JSON.stringify(v));
const rope = (r: RopeJson | undefined) => {
  if (!r || "cleared" in r) throw new Error("expected a rope on the board");
  return r;
};

describe("storage keys", () => {
  it("keeps the live game and previews apart", () => {
    expect(storageKeys("/").game).toBe("rope-tangle/game");
    expect(storageKeys("/").ready(5)).toBe("rope-tangle/ready/5");
    expect(storageKeys("/dev/").game).toBe("rope-tangle/dev/game");
    expect(storageKeys("/dev/").ready(10)).toBe("rope-tangle/dev/ready/10");
    expect(storageKeys("/").bundled(5)).toBe("rope-tangle/bundled/5");
    expect(storageKeys("/dev/").bundled(5)).toBe("rope-tangle/dev/bundled/5");
  });
});

describe("ready records", () => {
  it("round-trip through JSON exactly", () => {
    const b = board4();
    expect(decodeReady(roundTrip(encodeReady(b)), 4)).toEqual(b);
  });

  it("keep whether the board was bundled", () => {
    const b = { ...board4(), bundled: true };
    expect(decodeReady(roundTrip(encodeReady(b)), 4)).toEqual(b);
  });

  it("keep cleared placeholders", () => {
    const E = generateBoard(7, 4).engine;
    E.ropes[2]!.cleared = true;
    const s = toSnapshot(E);
    expect(decodeSnapshot(roundTrip(encodeSnapshot(s)), 4)).toEqual(s);
  });

  const broken: [string, (r: ReadyJson) => unknown][] = [
    ["another version", (r) => ({ ...r, v: 2 })],
    ["another rope count", (r) => ({ ...r, ropes: 5 })],
    ["a seed that is not a number", (r) => ({ ...r, seed: "7" })],
    ["a missing snapshot", (r) => ({ ...r, snapshot: undefined })],
    ["a board from another generator", (r) => ({ ...r, generator: GENERATOR_VERSION + 1 })],
    ["a board from an unknown generator", (r) => ({ ...r, generator: undefined })],
  ];
  for (const [name, change] of broken) {
    it(`reject ${name}`, () => {
      expect(decodeReady(change(encodeReady(board4())), 4)).toBeNull();
    });
  }
});

describe("snapshot decoding", () => {
  const json = () => encodeSnapshot(board4().snapshot);

  it("rejects a board of the wrong size", () => {
    const s = json();
    s.cols += 1;
    expect(decodeSnapshot(s, 4)).toBeNull();
  });
  it("rejects the wrong number of ropes", () => {
    const s = json();
    s.ropes.pop();
    expect(decodeSnapshot(s, 4)).toBeNull();
  });
  it("rejects a point list whose length is not a multiple of 6", () => {
    const s = json();
    rope(s.ropes[0]).pts.pop();
    expect(decodeSnapshot(s, 4)).toBeNull();
  });
  it("rejects numbers that are not finite", () => {
    const s = json();
    rope(s.ropes[0]).pts[3] = Number.NaN;
    expect(decodeSnapshot(s, 4)).toBeNull();
    rope(s.ropes[0]).pts[3] = Number.POSITIVE_INFINITY;
    expect(decodeSnapshot(s, 4)).toBeNull();
  });
  it("rejects points far off the board", () => {
    for (const [i, value] of [[0, 1e6], [1, -1e6], [2, 1e4], [4, 1e12], [5, -1e4]] as const) {
      const s = json();
      rope(s.ropes[0]).pts[i] = value;
      expect(decodeSnapshot(s, 4), `pts[${i}] = ${value}`).toBeNull();
    }
  });
  it("accepts a board however many points its ropes have", () => {
    const s = json(), r = rope(s.ropes[0]), first = r.pts.slice(0, 12);
    r.pts = Array.from({ length: 5_000 * 6 }, (_, i) => first[i % 12]!);
    expect(decodeSnapshot(s, 4)).not.toBeNull();
  });
  it("accepts every point of a generated board", () => {
    const s = board4().snapshot;
    expect(decodeSnapshot(encodeSnapshot(s), 4)).toEqual(s);
  });
  it("rejects an end in a hole the board does not have", () => {
    const s = json();
    rope(s.ropes[0]).ends[1] = 99;
    expect(decodeSnapshot(s, 4)).toBeNull();
  });
  it("rejects two ends in one hole", () => {
    const s = json();
    rope(s.ropes[1]).ends[0] = rope(s.ropes[0]).ends[0];
    expect(decodeSnapshot(s, 4)).toBeNull();
  });
  it("rejects a rope count with no board", () => {
    expect(decodeSnapshot(json(), 11)).toBeNull();
  });
});

describe("record storage", () => {
  it("deletes a key that holds something unreadable", () => {
    const store = memoryStore();
    store.setItem("k", "{not json");
    expect(readRecord(store, "k", (v) => decodeReady(v, 4))).toBeNull();
    expect(store.getItem("k")).toBeNull();
    store.setItem("k", JSON.stringify({ v: 1 }));
    expect(readRecord(store, "k", (v) => decodeReady(v, 4))).toBeNull();
    expect(store.getItem("k")).toBeNull();
  });

  it("says why it deleted a record", () => {
    const store = memoryStore(), reasons: string[] = [];
    const read = () => readRecord(store, "k", (v) => decodeReady(v, 4), (reason) => reasons.push(reason));
    store.setItem("k", "{not json");
    read();
    store.setItem("k", JSON.stringify({ ...encodeReady(board4()), v: 2 }));
    read();
    store.setItem("k", JSON.stringify({ ...encodeReady(board4()), ropes: 5 }));
    read();
    read();
    expect(reasons).toEqual(["unreadable", "version", "invalid"]);
  });

  it("reads back what it wrote", () => {
    const store = memoryStore(), b = board4();
    expect(writeRecord(store, "k", encodeReady(b))).toBe(true);
    expect(readRecord(store, "k", (v) => decodeReady(v, 4))).toEqual(b);
  });

  it("survives a store that refuses everything", () => {
    const refusing: KeyValueStore = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("quota");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    expect(writeRecord(refusing, "k", encodeReady(board4()))).toBe(false);
    expect(readRecord(refusing, "k", (v) => decodeReady(v, 4))).toBeNull();
    expect(() => removeRecord(refusing, "k")).not.toThrow();
  });
});

describe("saved games", () => {
  const game10 = () => generateBoard(5, 10).engine;
  const entry = (snapshot: EngineSnapshot, moves: number): HistoryEntry => ({ snapshot, moves });
  const saved = (E: Engine, extra: Partial<SavedGame> = {}): SavedGame => {
    const s = toSnapshot(E);
    return { ropes: E.ropes.length, seed: 5, moves: 3, playedMs: 1000, snapshot: s, start: s, undo: [entry(s, 1), entry(s, 2)], redo: [entry(s, 4)], undos: 2, redos: 1, startOvers: 1, replay: true, ...extra };
  };
  const decimals = (n: number) => (String(n).split(".")[1] ?? "").length;

  it("round-trip a game with its history", () => {
    const g = saved(generateBoard(1, 4).engine);
    const back = decodeGame(JSON.parse(encodeGame(g)))!;
    expect(back).toMatchObject({ ropes: 4, seed: 5, moves: 3, playedMs: 1000, undos: 2, redos: 1, startOvers: 1, replay: true });
    expect(back.undo.map((e) => e.moves)).toEqual([1, 2]);
    expect(back.redo.map((e) => e.moves)).toEqual([4]);
    expect(back.start).not.toBeNull();
    expect(back.snapshot).toEqual(g.snapshot);
  });

  it("keep version 1 with history added, so older builds still load the game", () => {
    const json: GameJson = JSON.parse(encodeGame(saved(generateBoard(1, 4).engine)));
    expect(json.v).toBe(1);
    expect(json.undo).toHaveLength(2);
  });

  it("load a saved game written before undo history existed", () => {
    const s = toSnapshot(generateBoard(1, 4).engine);
    const v1 = roundTrip({ v: 1, ropes: 4, seed: 5, moves: 3, playedMs: 1000, snapshot: encodeSnapshot(s) });
    expect(decodeGame(v1)).toEqual({ ropes: 4, seed: 5, moves: 3, playedMs: 1000, snapshot: s, start: null, undo: [], redo: [], undos: 0, redos: 0, startOvers: 0, replay: false });
  });

  it("round history coordinates but not the current state", () => {
    const g = saved(generateBoard(1, 4).engine), json: GameJson = JSON.parse(encodeGame(g));
    const pts = (j: SnapshotJson) => j.ropes.flatMap((r) => ("pts" in r ? r.pts : []));
    expect(pts(json.start!).every((c) => decimals(c) <= HISTORY_DECIMALS)).toBe(true);
    expect(pts(json.undo[0]!.snapshot).every((c) => decimals(c) <= HISTORY_DECIMALS)).toBe(true);
    expect(pts(json.snapshot)).toEqual(pts(encodeSnapshot(g.snapshot)));
  });

  it("keep the game when one history entry is unreadable", () => {
    const json: GameJson = JSON.parse(encodeGame(saved(generateBoard(1, 4).engine)));
    const broken = { ...json, start: { cols: 1 }, undo: [{ moves: 1, snapshot: { cols: 1 } }, ...json.undo.slice(1)] };
    const back = decodeGame(roundTrip(broken))!;
    expect(back.undo.map((e) => e.moves)).toEqual([2]);
    expect(back.start).toBeNull();
  });

  it("restore a rounded 10-rope board to the same tangle", () => {
    const E = game10();
    const F = fromSnapshot(decodeSnapshot(roundTrip(encodeSnapshot(toSnapshot(E), HISTORY_DECIMALS)), 10)!);
    settle(E);
    settle(F);
    const a = E.signature(), b = F.signature();
    for (let i = 0; i < 10; i++) for (let j = i + 1; j < 10; j++) expect(physicalLinking(b, i, j)).toBe(physicalLinking(a, i, j));
    let max = 0;
    E.ropes.forEach((r, i) => r.pts.forEach((p, k) => {
      const q = F.ropes[i]!.pts[k]!;
      max = Math.max(max, Math.hypot(p.x - q.x, p.y - q.y));
    }));
    expect(max).toBeLessThan(0.5);
  }, 30_000);

  it("fit ten undo and ten redo states of a 10-rope board under the cap", () => {
    const E = game10(), s = toSnapshot(E);
    const g = saved(E, { undo: Array.from({ length: 10 }, (_, i) => entry(s, i)), redo: Array.from({ length: 10 }, (_, i) => entry(s, 20 - i)) });
    expect(encodeGame(g).length).toBeLessThan(1_000_000);
  }, 30_000);
});
