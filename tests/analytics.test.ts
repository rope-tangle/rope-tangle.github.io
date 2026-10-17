import { DISTINCT_ID_KEY, resolveDistinctId } from "../src/analytics/distinct-id";
import { createErrorReporter, sanitizeReason, type UnhandledErrorData } from "../src/analytics/errors";
import { createTracker, track, trackerConfig } from "../src/analytics/umami";
import { memoryStore } from "../src/game/settings";

function page(href: string) {
  const urls: string[] = [];
  return {
    urls,
    host: {
      location: { href },
      history: {
        state: { backGuard: true },
        replaceState(data: unknown, _unused: string, url: string) {
          expect(data).toEqual({ backGuard: true });
          urls.push(url);
        },
      },
    },
  };
}

describe("distinct ID", () => {
  it("stores a valid id from the URL and removes it from the address", () => {
    const store = memoryStore(), p = page("https://x.test/?test=1&userid=rpas#a");
    expect(resolveDistinctId(p.host, store)).toBe("rpas");
    expect(store.getItem(DISTINCT_ID_KEY)).toBe("rpas");
    expect(p.urls).toEqual(["https://x.test/?test=1#a"]);
  });

  it("keeps using the stored id on later visits", () => {
    const store = memoryStore();
    store.setItem(DISTINCT_ID_KEY, "rpas");
    const p = page("https://x.test/");
    expect(resolveDistinctId(p.host, store)).toBe("rpas");
    expect(p.urls).toEqual([]);
  });

  it("forgets the id when the URL says off", () => {
    const store = memoryStore();
    store.setItem(DISTINCT_ID_KEY, "rpas");
    expect(resolveDistinctId(page("https://x.test/?userid=off").host, store)).toBeUndefined();
    expect(resolveDistinctId(page("https://x.test/").host, store)).toBeUndefined();
  });

  it("ignores invalid ids from the URL and from storage", () => {
    const store = memoryStore();
    store.setItem(DISTINCT_ID_KEY, "Not Valid");
    const p = page("https://x.test/?userid=%3Cscript%3E");
    expect(resolveDistinctId(p.host, store)).toBeUndefined();
    expect(p.urls).toEqual(["https://x.test/"]);
  });
});

describe("tracker config", () => {
  it("does nothing without a website ID", () => {
    expect(trackerConfig({ VITE_UMAMI_SCRIPT_URL: "/t.js" }, "rpas")).toBeNull();
  });

  it("does nothing without a script address, rather than sending the ID elsewhere", () => {
    expect(trackerConfig({ VITE_UMAMI_WEBSITE_ID: "w1" }, "rpas")).toBeNull();
  });

  it("loads the configured script with the device label", () => {
    expect(trackerConfig({ VITE_UMAMI_WEBSITE_ID: "w1", VITE_UMAMI_SCRIPT_URL: "https://h.test/relay.js" }, "rpas")).toEqual({
      src: "https://h.test/relay.js",
      websiteId: "w1",
      distinctId: "rpas",
    });
  });

  it("tags events with the build's deploy ID", () => {
    const env = { VITE_UMAMI_WEBSITE_ID: "w1", VITE_UMAMI_SCRIPT_URL: "/t.js", VITE_APP_VERSION: "PR #7 (run 23)" };
    expect(trackerConfig(env, undefined)).toMatchObject({ tag: "PR #7 (run 23)" });
  });
});

describe("track", () => {
  afterEach(() => vi.unstubAllGlobals());

  const recorder = () => {
    const sent: unknown[] = [];
    return { sent, umami: { track: (name: string, data?: Record<string, unknown>) => sent.push([name, data]) } };
  };

  it("hands events to the Umami tracker when it has loaded", () => {
    const r = recorder();
    vi.stubGlobal("window", { umami: r.umami });
    track("puzzle-completed", { ropes: 5, moves: 7, elapsedMs: 1000 });
    expect(r.sent).toEqual([["puzzle-completed", { ropes: 5, moves: 7, elapsedMs: 1000 }]]);
  });

  it("drops events quietly when no tracker is configured", () => {
    vi.stubGlobal("window", {});
    expect(() => track("back-guard-caught", {})).not.toThrow();
  });

  it("holds events sent while the tracker loads and sends them in order once it has", () => {
    const r = recorder();
    let umami: typeof r.umami | undefined;
    const t = createTracker(() => umami);
    t.wait();
    t.track("new-game-started", { ropes: 4, trigger: "first-load", generationMs: 900, tries: 1, waitMs: 950, prefetched: false });
    t.track("back-guard-caught", {});
    umami = r.umami;
    t.flush();
    t.track("puzzle-completed", { ropes: 4, moves: 3, elapsedMs: 5000 });
    expect(r.sent.map((e) => (Array.isArray(e) ? e[0] : e))).toEqual(["new-game-started", "back-guard-caught", "puzzle-completed"]);
  });

  it("holds at most 50 events while the tracker loads", () => {
    const r = recorder();
    let umami: typeof r.umami | undefined;
    const t = createTracker(() => umami);
    t.wait();
    for (let i = 0; i < 60; i++) t.track("back-guard-caught", {});
    umami = r.umami;
    t.flush();
    expect(r.sent).toHaveLength(50);
  });

  it("drops held events when the tracker fails to load", () => {
    const r = recorder();
    let umami: typeof r.umami | undefined;
    const t = createTracker(() => umami);
    t.wait();
    t.track("back-guard-caught", {});
    t.drop();
    umami = r.umami;
    t.flush();
    expect(r.sent).toEqual([]);
  });
});

describe("error reporting", () => {
  it("removes addresses from reasons and keeps them short", () => {
    expect(sanitizeReason(new Error("failed to load https://a.test/x.js?k=1 now"))).toBe("failed to load <url> now");
    expect(sanitizeReason("")).toBe("unknown");
    expect(sanitizeReason("x".repeat(300))).toHaveLength(200);
  });

  it("caps reports per reason and per session, with one notice when the cap is reached", () => {
    const sent: UnhandledErrorData[] = [];
    const report = createErrorReporter((d) => sent.push(d));
    for (let i = 0; i < 8; i++) report("error", new TypeError("same"));
    expect(sent.filter((d) => d.reason === "same")).toHaveLength(5);
    expect(sent[0]).toEqual({ source: "error", name: "TypeError", reason: "same" });
    for (let i = 0; i < 60; i++) report("rejection", `reason ${i}`);
    expect(sent.filter((d) => d.name !== "RateLimited")).toHaveLength(50);
    expect(sent.filter((d) => d.name === "RateLimited")).toHaveLength(1);
  });
});
