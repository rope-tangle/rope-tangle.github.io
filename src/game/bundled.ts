import { ROPE_COUNTS } from "../board";
import { decodeReady } from "./records";
import type { Stock } from "./stock";

export type BundledLoader = (ropes: number) => Promise<unknown>;

const files = import.meta.glob<unknown>("./bundled/ready-*.json", { import: "default" });

export const bundledLoader: BundledLoader = (ropes) => {
  const load = files[`./bundled/ready-${ropes}.json`];
  return load ? load() : Promise.reject(new Error(`no bundled board for ${ropes} ropes`));
};

export function fillFromBundled(stock: Stock, load: BundledLoader): Map<number, Promise<void>> {
  const done = new Map<number, Promise<void>>();
  for (const n of ROPE_COUNTS) {
    if (stock.has(n)) continue;
    done.set(n, load(n).then(
      (v) => {
        const b = decodeReady(v, n);
        if (b && !stock.has(n)) stock.put(b);
      },
      () => undefined,
    ));
  }
  return done;
}
