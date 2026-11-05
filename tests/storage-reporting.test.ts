import { otherChars, writeFailureReporter } from "../src/analytics/storage";
import type { Events } from "../src/analytics/umami";

type Sent = Events["storage-write-failed"];

const listing = (entries: Record<string, string>) => {
  const keys = Object.keys(entries);
  return { length: keys.length, key: (i: number) => keys[i] ?? null, getItem: (k: string) => entries[k] ?? null };
};

describe("storage write failure reporting", () => {
  it("counts the keys and values stored under other keys", () => {
    expect(otherChars(listing({ a: "123", bb: "4", game: "x".repeat(50) }), "game")).toBe(7);
    expect(otherChars(listing({}), "game")).toBe(0);
  });

  it("sends one event per kind of data per page load, without the key", () => {
    const sent: Sent[] = [];
    const report = writeFailureReporter((d) => sent.push(d), () => 10);
    report({ what: "game", key: "g", chars: 500, historyDropped: 3, saved: true });
    report({ what: "game", key: "g", chars: 400, historyDropped: 2, saved: true });
    report({ what: "stock", key: "r/4", chars: 90 });
    report({ what: "stock", key: "r/5", chars: 95 });
    report({ what: "settings", key: "s", chars: 30 });
    expect(sent).toEqual([
      { what: "game", chars: 500, historyDropped: 3, saved: true, otherChars: 10 },
      { what: "stock", chars: 90, otherChars: 10 },
      { what: "settings", chars: 30, otherChars: 10 },
    ]);
  });

  it("still reports a game that stops saving after an earlier save that dropped history", () => {
    const sent: Sent[] = [];
    const report = writeFailureReporter((d) => sent.push(d), () => 10);
    report({ what: "game", key: "g", chars: 500, historyDropped: 3, saved: true });
    report({ what: "game", key: "g", chars: 300, historyDropped: 0, saved: false });
    report({ what: "game", key: "g", chars: 300, historyDropped: 0, saved: false });
    expect(sent).toEqual([
      { what: "game", chars: 500, historyDropped: 3, saved: true, otherChars: 10 },
      { what: "game", chars: 300, historyDropped: 0, saved: false, otherChars: 10 },
    ]);
  });

  it("passes the written key to the size count", () => {
    const asked: string[] = [];
    writeFailureReporter(() => undefined, (k) => (asked.push(k), 0))({ what: "bundled", key: "b/4", chars: 4 });
    expect(asked).toEqual(["b/4"]);
  });

  it("still reports when the stored size can't be read", () => {
    const sent: Sent[] = [];
    const report = writeFailureReporter((d) => sent.push(d), () => {
      throw new Error("blocked");
    });
    report({ what: "settings", key: "s", chars: 30 });
    expect(sent).toEqual([{ what: "settings", chars: 30 }]);
  });
});
