import type { OnWriteFailed } from "../game/records";
import type { Events } from "./umami";

export interface StorageListing {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
}

export function otherChars(storage: StorageListing, except: string): number {
  let n = 0;
  for (let i = 0; i < storage.length; i++) {
    const k = storage.key(i);
    if (k !== null && k !== except) n += k.length + (storage.getItem(k)?.length ?? 0);
  }
  return n;
}

export function writeFailureReporter(send: (data: Events["storage-write-failed"]) => void, others: (key: string) => number): OnWriteFailed {
  const reported = new Set<string>();
  return ({ key, ...data }) => {
    const kind = `${data.what}/${data.saved}`;
    if (reported.has(kind)) return;
    reported.add(kind);
    let n: number | undefined;
    try {
      n = others(key);
    } catch {
      n = undefined;
    }
    send(n === undefined ? data : { ...data, otherChars: n });
  };
}
