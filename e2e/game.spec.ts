import { expect, test, type Page } from "@playwright/test";

declare global {
  interface Window {
    sentEvents?: [string, unknown][];
  }
}

interface P {
  x: number;
  y: number;
}

const state = (page: Page) => page.evaluate(() => window.ropeTangleTest!.state());
const at = (page: Page, x: number, y: number) => page.evaluate(([bx, by]) => window.ropeTangleTest!.boardToClient(bx!, by!), [x, y]);
const holeAt = (page: Page, x: number, y: number) => page.evaluate(([bx, by]) => window.ropeTangleTest!.holeAt(bx!, by!), [x, y]);

async function drag(page: Page, from: P, to: P): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.mouse.up();
}

async function loaded(page: Page): Promise<void> {
  await expect.poll(async () => (await state(page)).loading, { timeout: 60_000 }).toBe(false);
}

async function idle(page: Page): Promise<void> {
  await expect.poll(async () => (await state(page)).phase, { timeout: 30_000 }).toBe("idle");
}

test.describe("easy board", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("?test=1&board=easy");
    await loaded(page);
  });

  test("drags an end into another hole and counts the move", async ({ page }) => {
    await drag(page, await at(page, 192, 256), await at(page, 128, 256));
    await idle(page);
    const s = await state(page);
    expect(s.moves).toBe(1);
    expect(s.ends[0]![1]).toBe(await holeAt(page, 128, 256));
  });

  test("drops an end released between holes into the nearest free hole", async ({ page }) => {
    await drag(page, await at(page, 192, 256), await at(page, 150, 250));
    await idle(page);
    expect((await state(page)).ends[0]![1]).toBe(await holeAt(page, 128, 256));
  });

  test("releases an end let go over the top bar", async ({ page }) => {
    const from = await at(page, 192, 256);
    await drag(page, from, { x: from.x, y: 10 });
    await idle(page);
    const s = await state(page);
    expect(s.held).toBeNull();
    expect(s.ends[0]![1]).not.toBeNull();
  });

  test("grabs another rope while the first end is still flying", async ({ page }) => {
    const from = await at(page, 192, 256), to = await at(page, 128, 256);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y);
    await page.mouse.up();
    const other = await at(page, 192, 0);
    await page.mouse.move(other.x, other.y);
    await page.mouse.down();
    expect((await state(page)).held).toBe(1);
    await page.mouse.up();
    await idle(page);
  });

  test("solves the board and shows the win overlay", async ({ page }) => {
    await drag(page, await at(page, 192, 256), await at(page, 64, 0));
    await expect(page.locator("#overlay")).toContainText("Solved · 1 move", { timeout: 30_000 });
  });

  test("stops drawing while nothing moves and resumes on a drag", async ({ page }) => {
    await idle(page);
    await page.waitForTimeout(300);
    const before = await page.evaluate(() => window.ropeTangleTest!.frameStats().draws);
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => window.ropeTangleTest!.frameStats().draws)).toBe(before);
    await drag(page, await at(page, 192, 256), await at(page, 128, 256));
    expect(await page.evaluate(() => window.ropeTangleTest!.frameStats().draws)).toBeGreaterThan(before);
  });

  test("shows the deploy ID in the bottom-right corner without blocking drags", async ({ page }) => {
    const label = page.locator("#deploy-id");
    await expect(label).toHaveText("e2e-build");
    const box = (await label.boundingBox())!, view = page.viewportSize()!;
    expect(box.x + box.width).toBeGreaterThan(view.width - 20);
    expect(box.y + box.height).toBeGreaterThan(view.height - 20);
    expect(await label.evaluate((el) => getComputedStyle(el).pointerEvents)).toBe("none");
  });

  test("keeps dragging accurate after a resize", async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 420 });
    await expect.poll(() => page.evaluate(() => document.querySelector("canvas")!.style.width)).toBe("800px");
    await drag(page, await at(page, 192, 256), await at(page, 128, 256));
    await idle(page);
    expect((await state(page)).ends[0]![1]).toBe(await holeAt(page, 128, 256));
  });
});

test.describe("touch", () => {
  test.use({ hasTouch: true });

  test("ignores a second finger while dragging", async ({ page }) => {
    await page.goto("?test=1&board=easy");
    await loaded(page);
    const cdp = await page.context().newCDPSession(page);
    const a = await at(page, 192, 256), mid = await at(page, 100, 120), b = await at(page, 40, 10), c = await at(page, 64, 0);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: a.x, y: a.y, id: 1 }] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: mid.x, y: mid.y, id: 1 }] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: mid.x, y: mid.y, id: 1 }, { x: b.x, y: b.y, id: 2 }] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: mid.x, y: mid.y, id: 1 }, { x: c.x, y: c.y, id: 2 }] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await idle(page);
    const s = await state(page);
    expect(s.won).toBe(false);
    expect(s.ends[0]![1]).toBe(await holeAt(page, 192, 128));
  });
});

test.describe("bundled boards", () => {
  test.use({ serviceWorkers: "block" });

  test("leaves the stock alone when a replaced board's file arrives late", async ({ page }) => {
    await page.route("**/assets/ready-10-*.js", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 3_000));
      await route.continue();
    });
    await page.goto("?test=1&ropes=5");
    await loaded(page);
    const late = page.waitForResponse(/\/assets\/ready-10-/);
    await page.selectOption("#ropes", "10");
    await page.selectOption("#ropes", "5");
    await loaded(page);
    await late;
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => localStorage.getItem("rope-tangle/ready/10") !== null)).toBe(true);
    expect((await state(page)).active).toBe(5);
  });
});

test.describe("saved games", () => {
  test.use({ serviceWorkers: "block" });

  const HOLES_ON_4_ROPE_BOARD = 14;

  async function moveOneEnd(page: Page): Promise<void> {
    const s = await state(page);
    const taken = new Set(s.ends.flat());
    const free = [...Array(HOLES_ON_4_ROPE_BOARD).keys()].find((i) => !taken.has(i))!;
    const from = await page.evaluate((i) => window.ropeTangleTest!.holeToClient(i), s.ends[0]![1]!);
    const to = await page.evaluate((i) => window.ropeTangleTest!.holeToClient(i), free);
    await drag(page, from, to);
    await idle(page);
  }

  test("resumes the game after a reload", async ({ page }) => {
    await page.addInitScript(() => {
      const events: [string, unknown][] = [];
      window.sentEvents = events;
      window.umami = { track: (name, data) => events.push([name, data]) };
    });
    await page.goto("?test=1&ropes=4");
    await loaded(page);
    await moveOneEnd(page);
    const before = await state(page);
    expect(before.moves).toBe(1);
    await page.reload();
    await loaded(page);
    const after = await state(page);
    expect(after.moves).toBe(1);
    expect(after.active).toBe(before.active);
    const remaining = (ends: (number | null)[][], like: (number | null)[][]) => ends.filter((_, i) => like[i]![0] !== null);
    expect(remaining(after.ends, after.ends)).toEqual(remaining(before.ends, after.ends));
    const events = await page.evaluate(() => window.sentEvents ?? []);
    expect(events.filter(([n]) => n === "game-resumed")).toEqual([["game-resumed", { ropes: 4, moves: 1, ropesLeft: before.active, elapsedMs: expect.any(Number) }]]);
    expect(events.map(([n]) => n)).not.toContain("new-game-started");
    const resumedMs = await page.evaluate(() => {
      const d = window.sentEvents?.find(([n]) => n === "game-resumed")?.[1];
      return typeof d === "object" && d !== null && "elapsedMs" in d && typeof d.elapsedMs === "number" ? d.elapsedMs : -1;
    });
    expect(resumedMs).toBeGreaterThan(0);
    await page.locator("#new").click();
    await loaded(page);
    const replaced = await page.evaluate(() => (window.sentEvents ?? []).filter(([n]) => n === "new-game-started").map(([, d]) => d));
    expect(replaced).toMatchObject([{ trigger: "new", replacedSolved: false, replacedMoves: 1 }]);
    expect(replaced[0]).toHaveProperty("replacedElapsedMs");
    const replacedMs = await page.evaluate(() => {
      const d = (window.sentEvents ?? []).find(([n]) => n === "new-game-started")?.[1];
      return typeof d === "object" && d !== null && "replacedElapsedMs" in d && typeof d.replacedElapsedMs === "number" ? d.replacedElapsedMs : -1;
    });
    expect(replacedMs).toBeGreaterThanOrEqual(resumedMs);
  });

  test("keeps the game through repeated reloads", async ({ page }) => {
    await page.goto("?test=1&ropes=4");
    await loaded(page);
    await moveOneEnd(page);
    for (let i = 0; i < 2; i++) {
      await page.reload();
      await loaded(page);
      expect((await state(page)).moves).toBe(1);
    }
  });

  test("reports a saved game it could not resume and starts a new board", async ({ page }) => {
    await page.addInitScript(() => {
      const events: [string, unknown][] = [];
      window.sentEvents = events;
      window.umami = { track: (name, data) => events.push([name, data]) };
      localStorage.setItem("rope-tangle/game", "{not json");
    });
    await page.goto("?test=1&ropes=4");
    await loaded(page);
    const events = await page.evaluate(() => window.sentEvents ?? []);
    expect(events.filter(([n]) => n === "saved-game-discarded")).toEqual([["saved-game-discarded", { reason: "unreadable" }]]);
    expect(events.filter(([n]) => n === "new-game-started")).toMatchObject([["new-game-started", { trigger: "first-load" }]]);
  });

  test("waits for bundled boards before generating after a resume", async ({ page }) => {
    await page.goto("?test=1&ropes=4");
    await loaded(page);
    await moveOneEnd(page);
    await page.addInitScript(() => {
      for (const k of Object.keys(localStorage)) if (/^rope-tangle\/(ready|bundled)\//.test(k)) localStorage.removeItem(k);
    });
    await page.route("**/assets/ready-*.js", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1_500));
      await route.continue();
    });
    const workerAt: number[] = [], chunksAt: number[] = [];
    page.on("request", (r) => {
      if (r.url().includes("/assets/worker-")) workerAt.push(Date.now());
    });
    page.on("response", (r) => {
      if (r.url().includes("/assets/ready-")) chunksAt.push(Date.now());
    });
    await page.reload();
    await loaded(page);
    expect((await state(page)).moves).toBe(1);
    await expect.poll(() => chunksAt.length, { timeout: 15_000 }).toBe(7);
    expect(workerAt.filter((t) => t < Math.max(...chunksAt))).toEqual([]);
  });

  test("never saves the easy test board", async ({ page }) => {
    await page.goto("?test=1&board=easy");
    await loaded(page);
    expect(await page.evaluate(() => localStorage.getItem("rope-tangle/game"))).toBeNull();
  });
});

test.describe("failures", () => {
  test("offers another try when the board generator cannot start", async ({ page }) => {
    await page.route("**/assets/ready-*.js", (route) => route.abort());
    await page.route("**/assets/worker-*.js", (route) => route.abort());
    await page.goto("?test=1");
    await expect(page.locator("#overlay button")).toHaveText("Try again", { timeout: 15_000 });
  });
});

test.describe("offline", () => {
  test("caches the board generator even when it finishes loading late", async ({ page }) => {
    await page.route("**/assets/worker-*.js", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 3_000));
      await route.continue();
    });
    await page.goto("?test=1");
    await loaded(page);
    await expect
      .poll(
        () =>
          page.evaluate(async () => {
            const urls: string[] = [];
            for (const k of await caches.keys()) for (const r of await (await caches.open(k)).keys()) urls.push(r.url);
            return urls.some((u) => u.includes("/assets/worker-"));
          }),
        { timeout: 15_000 },
      )
      .toBe(true);
  });

  test("plays offline after one visit", async ({ page, context }) => {
    await page.goto("?test=1");
    await loaded(page);
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
    await expect
      .poll(
        () =>
          page.evaluate(async () => {
            const urls: string[] = [];
            for (const k of await caches.keys()) for (const r of await (await caches.open(k)).keys()) urls.push(r.url);
            return urls.some((u) => u.includes("/assets/worker-")) && urls.some((u) => u.includes("/assets/main-"));
          }),
        { timeout: 15_000 },
      )
      .toBe(true);
    await context.setOffline(true);
    await page.reload();
    await loaded(page);
    expect((await state(page)).active).toBeGreaterThan(0);
  });
});

test.describe("generated boards", () => {
  test("shows the board for the last rope count chosen", async ({ page }) => {
    await page.goto("?test=1&ropes=5");
    await loaded(page);
    await page.selectOption("#ropes", "4");
    await page.selectOption("#ropes", "7");
    await loaded(page);
    await expect.poll(async () => (await state(page)).active, { timeout: 60_000 }).toBe(7);
  });

  test("keeps frames flowing under a slowed-down CPU", async ({ page }) => {
    await page.goto("?test=1&ropes=8");
    await loaded(page);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    const hole = (await state(page)).ends[0]![0]!;
    const from = await page.evaluate((i) => window.ropeTangleTest!.holeToClient(i), hole);
    await page.evaluate(() => window.ropeTangleTest!.resetFrameStats());
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + 120, from.y + 200, { steps: 40 });
    await page.mouse.up();
    const stats = await page.evaluate(() => window.ropeTangleTest!.frameStats());
    expect(stats.frames).toBeGreaterThan(10);
    expect(stats.meanTickMs).toBeLessThan(30);
  });
});

async function touch(page: Page, p: P, end: "touchEnd" | "touchCancel"): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: p.x, y: p.y, id: 1 }] });
  await cdp.send("Input.dispatchTouchEvent", { type: end, touchPoints: [] });
}

test.describe("back guard with a mouse", () => {
  test("ignores back requests after mouse clicks", async ({ page }) => {
    await page.goto("?test=1&board=easy");
    await loaded(page);
    const p = await at(page, 96, 128);
    await page.mouse.click(p.x, p.y);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    expect(await page.locator("#toast").isHidden()).toBe(true);
  });
});

test.describe("back guard", () => {
  test.use({ hasTouch: true });

  test("catches one back request per completed touch on the board", async ({ page }) => {
    await page.clock.install();
    await page.goto("?test=1&board=easy");
    await loaded(page);
    const p = await at(page, 96, 128), toast = page.locator("#toast");
    await touch(page, p, "touchEnd");
    await page.keyboard.press("Escape");
    await expect(toast).toHaveText("Go back again to leave");
    await page.clock.fastForward(2500);
    await expect(toast).toBeHidden();
    await touch(page, p, "touchCancel");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    expect(await toast.isHidden()).toBe(true);
    await touch(page, p, "touchEnd");
    await page.keyboard.press("Escape");
    await expect(toast).toBeVisible();
  });

  test("falls back to a history entry where close watchers are missing", async ({ page }) => {
    await page.addInitScript(() => Reflect.deleteProperty(window, "CloseWatcher"));
    await page.goto("?test=1&board=easy");
    await loaded(page);
    const game = page.url(), p = await at(page, 96, 128);
    await touch(page, p, "touchEnd");
    await page.goBack();
    await expect(page.locator("#toast")).toHaveText("Go back again to leave");
    expect(page.url()).toBe(game);
    await touch(page, p, "touchCancel");
    await page.goBack();
    expect(page.url()).toBe("about:blank");
  });

  test("keeps the history guard in step with Forward", async ({ page }) => {
    await page.addInitScript(() => Reflect.deleteProperty(window, "CloseWatcher"));
    await page.goto("?test=1&board=easy");
    await loaded(page);
    const p = await at(page, 96, 128), toast = page.locator("#toast");
    await touch(page, p, "touchEnd");
    await page.goBack();
    await expect(toast).toBeVisible();
    await page.goForward();
    await touch(page, p, "touchEnd");
    await page.evaluate(() => document.getElementById("toast")!.hidden = true);
    await page.goBack();
    await expect(toast).toBeVisible();
    await page.goBack();
    expect(page.url()).toBe("about:blank");
  });

  test("keeps the history guard armed across a reload", async ({ page }) => {
    await page.addInitScript(() => Reflect.deleteProperty(window, "CloseWatcher"));
    await page.goto("?test=1&board=easy");
    await loaded(page);
    await touch(page, await at(page, 96, 128), "touchEnd");
    await page.reload();
    await loaded(page);
    await touch(page, await at(page, 96, 128), "touchEnd");
    await page.goBack();
    await expect(page.locator("#toast")).toHaveText("Go back again to leave");
    await page.goBack();
    expect(page.url()).toBe("about:blank");
  });
});

test.describe("analytics", () => {
  test.use({ hasTouch: true, serviceWorkers: "block" });

  const named = (page: Page, name: string) => page.evaluate((n) => (window.sentEvents ?? []).filter(([e]) => e === n).map(([, d]) => d), name);

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      const events: [string, unknown][] = [];
      window.sentEvents = events;
      window.umami = { track: (name, data) => events.push([name, data]) };
    });
  });

  test("reports a started game, its solution and the game that replaces it", async ({ page }) => {
    await page.goto("?test=1&board=easy");
    await loaded(page);
    expect(await named(page, "new-game-started")).toEqual([
      { ropes: 2, trigger: "first-load", generationMs: 0, tries: 1, waitMs: expect.any(Number), prefetched: false, bundled: false },
    ]);
    await drag(page, await at(page, 192, 256), await at(page, 64, 0));
    await expect(page.locator("#overlay")).toContainText("Solved", { timeout: 30_000 });
    expect(await named(page, "puzzle-completed")).toEqual([{ ropes: 2, moves: 1, elapsedMs: expect.any(Number) }]);
    await page.locator("#overlay button").click();
    await loaded(page);
    const next = (await named(page, "new-game-started"))[1];
    expect(next).toMatchObject({ trigger: "next", replacedSolved: true, replacedMoves: 1, replacedRopesLeft: 0 });
    expect(next).not.toHaveProperty("replacedElapsedMs");
    await page.locator("#new").click();
    await loaded(page);
    expect((await named(page, "new-game-started"))[2]).toMatchObject({
      trigger: "new",
      replacedSolved: false,
      replacedMoves: 0,
      replacedRopesLeft: 2,
      replacedElapsedMs: expect.any(Number),
    });
  });

  test("starts a first visit with a bundled board for any rope count", async ({ page }) => {
    await page.goto("?test=1&ropes=10");
    await loaded(page);
    expect((await named(page, "new-game-started"))[0]).toMatchObject({ ropes: 10, trigger: "first-load", prefetched: true, bundled: true });
    await page.locator("#ropes").selectOption("7");
    await loaded(page);
    expect((await named(page, "new-game-started"))[1]).toMatchObject({ ropes: 7, prefetched: true, bundled: true });
  });

  test("starts a second visit with a stocked board", async ({ page }) => {
    await page.addInitScript(() => localStorage.removeItem("rope-tangle/game"));
    await page.goto("?test=1&ropes=4");
    await loaded(page);
    await expect.poll(() => page.evaluate(() => localStorage.getItem("rope-tangle/ready/4") !== null), { timeout: 60_000 }).toBe(true);
    await page.reload();
    await loaded(page);
    expect((await named(page, "new-game-started"))[0]).toMatchObject({ ropes: 4, trigger: "first-load", prefetched: true, bundled: false });
  });

  test("keeps the replaced game's details when its replacement is itself replaced", async ({ page }) => {
    await page.route("**/assets/ready-*.js", (route) => route.abort());
    await page.goto("?test=1&ropes=4");
    await loaded(page);
    await page.locator("#ropes").selectOption("10");
    await page.locator("#ropes").selectOption("9");
    await loaded(page);
    const started = await named(page, "new-game-started");
    expect(started).toHaveLength(2);
    expect(started).toMatchObject([
      { trigger: "first-load" },
      { trigger: "rope-count", ropes: 9, replacedSolved: false, replacedMoves: 0, replacedRopesLeft: 4, replacedElapsedMs: expect.any(Number) },
    ]);
  });

  test("reports a back request caught by the guard", async ({ page }) => {
    await page.goto("?test=1&board=easy");
    await loaded(page);
    await touch(page, await at(page, 96, 128), "touchEnd");
    await page.keyboard.press("Escape");
    await expect(page.locator("#toast")).toBeVisible();
    expect(await named(page, "back-guard-caught")).toEqual([{}]);
  });

  test("reports a board that could not be generated", async ({ page }) => {
    await page.route("**/assets/ready-*.js", (route) => route.abort());
    await page.route("**/assets/worker-*.js", (route) => route.abort());
    await page.goto("?test=1&ropes=5");
    await expect(page.locator("#overlay button")).toHaveText("Try again", { timeout: 15_000 });
    expect(await named(page, "new-game-failed")).toEqual([{ ropes: 5, trigger: "first-load", reason: "crashed", detail: "The board generator stopped" }]);
    await page.locator("#overlay button").click();
    await expect.poll(async () => (await named(page, "new-game-failed")).length).toBe(2);
    expect((await named(page, "new-game-failed"))[1]).toMatchObject({ trigger: "retry", reason: "crashed" });
  });

  test("gives up on a board generator that stops answering and reports it", async ({ page }) => {
    await page.route("**/assets/ready-*.js", (route) => route.abort());
    await page.route("**/assets/worker-*.js", (route) => route.fulfill({ contentType: "text/javascript", body: "self.onmessage = () => {};" }));
    await page.clock.install();
    await page.goto("?test=1&ropes=6");
    await expect(page.locator("#overlay")).toContainText("Scrambling");
    await page.clock.fastForward(30_000);
    await page.clock.fastForward(30_000);
    await expect(page.locator("#overlay button")).toHaveText("Try again");
    expect(await named(page, "generation-timeout")).toEqual([{ ropes: 6, background: false }, { ropes: 6, background: false }]);
    expect(await named(page, "new-game-failed")).toEqual([{ ropes: 6, trigger: "first-load", reason: "timeout", detail: "The board generator didn't answer" }]);
  });

  const setHidden = (page: Page, hidden: boolean) =>
    page.evaluate((h) => {
      Object.defineProperty(document, "hidden", { configurable: true, get: () => h });
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => (h ? "hidden" : "visible") });
      document.dispatchEvent(new Event("visibilitychange"));
    }, hidden);

  test("leaves time the page was hidden out of the solve time", async ({ page }) => {
    await page.clock.install();
    await page.goto("?test=1&board=easy");
    await loaded(page);
    await setHidden(page, true);
    await page.clock.fastForward(60_000);
    await setHidden(page, false);
    await drag(page, await at(page, 192, 256), await at(page, 64, 0));
    await expect(page.locator("#overlay")).toContainText("Solved", { timeout: 30_000 });
    const elapsedMs = await page.evaluate(() => {
      const d = window.sentEvents?.find(([n]) => n === "puzzle-completed")?.[1];
      return typeof d === "object" && d !== null && "elapsedMs" in d && typeof d.elapsedMs === "number" ? d.elapsedMs : -1;
    });
    expect(elapsedMs).toBeGreaterThan(0);
    expect(elapsedMs).toBeLessThan(30_000);
  });

  test("does not time out a generator while the page is hidden", async ({ page }) => {
    await page.route("**/assets/ready-*.js", (route) => route.abort());
    await page.route("**/assets/worker-*.js", (route) => route.fulfill({ contentType: "text/javascript", body: "self.onmessage = () => {};" }));
    await page.clock.install();
    await page.goto("?test=1&ropes=6");
    await expect(page.locator("#overlay")).toContainText("Scrambling");
    await setHidden(page, true);
    for (const ms of [30_000, 30_000, 15_000]) await page.clock.fastForward(ms);
    expect(await named(page, "generation-timeout")).toEqual([]);
    await setHidden(page, false);
    await page.clock.fastForward(29_000);
    expect(await named(page, "generation-timeout")).toEqual([]);
    await page.clock.fastForward(2_000);
    expect(await named(page, "generation-timeout")).toEqual([{ ropes: 6, background: false }]);
  });

  test("reports uncaught errors without addresses", async ({ page }) => {
    await page.goto("?test=1&board=easy");
    await loaded(page);
    await page.evaluate(() => setTimeout(() => {
      throw new Error("boom at https://example.test/x.js");
    }));
    await expect.poll(() => named(page, "unhandled-error")).toEqual([{ source: "error", name: "Error", reason: "boom at <url>" }]);
  });
});

test.describe("analytics tracker", () => {
  test("holds events until the tracker script has loaded, then sends them in order", async ({ page }) => {
    await page.route("**/e2e-tracker.js", async (route) => {
      await new Promise((r) => setTimeout(r, 1000));
      await route.fulfill({
        contentType: "text/javascript",
        body: "window.sentEvents = []; window.umami = { track: (n, d) => window.sentEvents.push([n, d]) };",
      });
    });
    await page.goto("?test=1&board=easy");
    await loaded(page);
    await expect.poll(() => page.evaluate(() => (window.sentEvents ?? []).map(([n]) => n))).toEqual(["new-game-started"]);
    const script = page.locator('script[src="/e2e-tracker.js"]');
    await expect(script).toHaveAttribute("data-website-id", "e2e-site");
    await expect(script).toHaveAttribute("data-performance", "true");
    await expect(script).toHaveAttribute("data-tag", "e2e-build");
  });
});
