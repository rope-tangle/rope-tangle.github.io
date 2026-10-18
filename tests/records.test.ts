import { toSnapshot } from "../src/engine/snapshot";
import { generateBoard } from "../src/generate/generate";
import { GENERATOR_VERSION } from "../src/generate/version";
import {
  decodeReady, decodeSnapshot, encodeReady, encodeSnapshot, readRecord, removeRecord, storageKeys, writeRecord, type ReadyBoard, type ReadyJson,
  type RopeJson,
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
