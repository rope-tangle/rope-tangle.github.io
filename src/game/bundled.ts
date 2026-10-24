import { ROPE_COUNTS } from "../board";
import { decodeReady } from "./records";
import type { Stock } from "./stock";

export type BundledLoader = (ropes: number) => Promise<unknown>;

export const BUNDLED_WAIT_MS = 5_000;

const files = import.meta.glob<unknown>("./bundled/ready-*.json", { import: "default" });

export const bundledLoader: BundledLoader = (ropes) => {
  const load = files[`./bundled/ready-${ropes}.json`];
  return load ? load() : Promise.reject(new Error(`no bundled board for ${ropes} ropes`));
};

export function fillFromBundled(stock: Stock, load: BundledLoader, first: number, waitMs = BUNDLED_WAIT_MS): Map<number, Promise<void>> {
  const done = new Map<number, Promise<void>>();
  const fill = (n: number) =>
    Promise.race([
      load(n).then(
        (v) => {
          const b = decodeReady(v, n);
          if (b && wanted(n)) stock.put(b);
        },
        () => undefined,
      ),
      new Promise<void>((resolve) => setTimeout(resolve, waitMs)),
    ]);
  const wanted = (n: number) => !stock.has(n) && !stock.gotBundled(n);
  let lead = Promise.resolve();
  if (wanted(first)) {
    lead = fill(first);
    done.set(first, lead);
  }
  for (const n of ROPE_COUNTS) {
    if (n !== first && wanted(n)) done.set(n, lead.then(() => fill(n)));
  }
  return done;
}
