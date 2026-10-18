import { ROPE_COUNTS } from "../src/board";
import { decodeReady, storageKeys, type ReadyBoard } from "../src/game/records";
import { fillFromBundled } from "../src/game/bundled";
import { memoryStore } from "../src/game/settings";
import { Stock } from "../src/game/stock";

const files = import.meta.glob<unknown>("../src/game/bundled/ready-*.json", { eager: true, import: "default" });
const file = (n: number): unknown => files[`../src/game/bundled/ready-${n}.json`];
const board = (n: number): ReadyBoard => {
  const b = decodeReady(file(n), n);
  if (!b) throw new Error(`ready-${n}.json is unreadable`);
  return b;
};

describe("bundled boards", () => {
  it("has a readable board for every rope count", () => {
    for (const n of ROPE_COUNTS) expect(decodeReady(file(n), n), `ready-${n}.json`).toMatchObject({ ropes: n, bundled: true });
  });

  it("fills only the sizes the stock lacks", async () => {
    const stock = new Stock(memoryStore(), storageKeys("/")), asked: number[] = [];
    stock.put({ ...board(4), bundled: false });
    await Promise.all(fillFromBundled(stock, async (n) => {
      asked.push(n);
      return file(n);
    }).values());
    expect(asked).toEqual([5, 6, 7, 8, 9, 10]);
    expect(stock.take(4)).toMatchObject({ bundled: false });
    expect(stock.take(7)).toMatchObject({ bundled: true });
  });

  it("leaves the size to the generator when its file cannot be loaded or read", async () => {
    const stock = new Stock(memoryStore(), storageKeys("/"));
    const done = fillFromBundled(stock, async (n) => {
      if (n === 5) throw new Error("offline");
      return n === 6 ? { v: 1 } : file(n);
    });
    await Promise.all(done.values());
    expect(stock.has(5)).toBe(false);
    expect(stock.has(6)).toBe(false);
    expect(stock.has(7)).toBe(true);
  });

  it("does not overwrite a board stocked while its file was loading", async () => {
    const stock = new Stock(memoryStore(), storageKeys("/"));
    const done = fillFromBundled(stock, async (n) => file(n));
    stock.put({ ...board(8), seed: 42, bundled: false });
    await Promise.all(done.values());
    expect(stock.take(8)).toMatchObject({ seed: 42 });
  });
});
