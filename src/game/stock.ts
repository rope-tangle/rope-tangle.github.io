import { ROPE_COUNTS } from "../board";
import { decodeReady, encodeReady, readRecord, removeRecord, writeRecord, type OnWriteFailed, type ReadyBoard, type StorageKeys } from "./records";
import type { KeyValueStore } from "./settings";

export class Stock {
  private readonly boards = new Map<number, ReadyBoard>();
  private readonly bundled = new Set<number>();
  private readonly store: KeyValueStore;
  private readonly keys: StorageKeys;
  private readonly onWriteFailed: OnWriteFailed;

  constructor(store: KeyValueStore, keys: StorageKeys, onWriteFailed: OnWriteFailed = () => undefined) {
    this.store = store;
    this.keys = keys;
    this.onWriteFailed = onWriteFailed;
    for (const n of ROPE_COUNTS) {
      const b = readRecord(store, keys.ready(n), (v) => decodeReady(v, n));
      if (b) this.boards.set(n, b);
      if (readRecord(store, keys.bundled(n), (v) => (v === true ? true : null))) this.bundled.add(n);
    }
  }

  has(ropes: number): boolean {
    return this.boards.has(ropes);
  }

  gotBundled(ropes: number): boolean {
    return this.bundled.has(ropes);
  }

  take(ropes: number): ReadyBoard | null {
    const b = this.boards.get(ropes);
    if (!b) return null;
    this.boards.delete(ropes);
    removeRecord(this.store, this.keys.ready(ropes));
    if (b.bundled) {
      this.bundled.add(ropes);
      writeRecord(this.store, this.keys.bundled(ropes), true, "bundled", this.onWriteFailed);
    }
    return b;
  }

  put(b: ReadyBoard): void {
    this.boards.set(b.ropes, b);
    writeRecord(this.store, this.keys.ready(b.ropes), encodeReady(b), "stock", this.onWriteFailed);
  }
}
