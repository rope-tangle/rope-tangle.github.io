import { toSnapshot } from "../src/engine/snapshot";
import { easyBoard } from "../src/game/easy";
import { generateBoard } from "../src/generate/generate";
import { encodeSnapshot, storageKeys, type ReadyBoard } from "../src/game/records";
import { memoryStore, type KeyValueStore } from "../src/game/settings";
import { Stock } from "../src/game/stock";

const keys = storageKeys("/");
const ready = (ropes: number, seed = 1): ReadyBoard => ({ ropes, seed, generationMs: 5, tries: 1, bundled: false, snapshot: toSnapshot(generateBoard(seed, ropes).engine) });

describe("stock", () => {
  it("hands each stored board out once", () => {
    const store = memoryStore(), s = new Stock(store, keys);
    s.put(ready(4));
    expect(s.has(4)).toBe(true);
    expect(store.getItem(keys.ready(4))).not.toBeNull();
    expect(s.take(4)).toMatchObject({ ropes: 4, seed: 1 });
    expect(s.take(4)).toBeNull();
    expect(store.getItem(keys.ready(4))).toBeNull();
  });

  it("finds the boards a previous visit stored", () => {
    const store = memoryStore(), b = ready(5, 3);
    new Stock(store, keys).put(b);
    const again = new Stock(store, keys);
    expect(again.has(5)).toBe(true);
    expect(again.has(4)).toBe(false);
    expect(again.take(5)).toEqual(b);
  });

  it("drops a stored board it cannot read", () => {
    const store = memoryStore();
    store.setItem(keys.ready(6), JSON.stringify({ v: 1, ropes: 6, seed: 1, generationMs: 1, tries: 1, snapshot: encodeSnapshot(toSnapshot(easyBoard())) }));
    expect(new Stock(store, keys).has(6)).toBe(false);
    expect(store.getItem(keys.ready(6))).toBeNull();
  });

  it("keeps boards in memory when storage refuses them", () => {
    const refusing: KeyValueStore = {
      getItem: () => null,
      setItem: () => {
        throw new Error("quota");
      },
      removeItem: () => undefined,
    };
    const s = new Stock(refusing, keys);
    s.put(ready(4));
    expect(s.take(4)).toMatchObject({ ropes: 4 });
  });
});
