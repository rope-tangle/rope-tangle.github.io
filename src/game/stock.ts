import { ROPE_COUNTS } from "../board";
import { decodeReady, encodeReady, readRecord, removeRecord, writeRecord, type ReadyBoard, type StorageKeys } from "./records";
import type { KeyValueStore } from "./settings";

export class Stock {
  private readonly boards = new Map<number, ReadyBoard>();
  private readonly store: KeyValueStore;
  private readonly keys: StorageKeys;

  constructor(store: KeyValueStore, keys: StorageKeys) {
    this.store = store;
    this.keys = keys;
    for (const n of ROPE_COUNTS) {
      const b = readRecord(store, keys.ready(n), (v) => decodeReady(v, n));
      if (b) this.boards.set(n, b);
    }
  }

  has(ropes: number): boolean {
    return this.boards.has(ropes);
  }

  take(ropes: number): ReadyBoard | null {
    const b = this.boards.get(ropes);
    if (!b) return null;
    this.boards.delete(ropes);
    removeRecord(this.store, this.keys.ready(ropes));
    return b;
  }

  put(b: ReadyBoard): void {
    this.boards.set(b.ropes, b);
    writeRecord(this.store, this.keys.ready(b.ropes), encodeReady(b));
  }
}
