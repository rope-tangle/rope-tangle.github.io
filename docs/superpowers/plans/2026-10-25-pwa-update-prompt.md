# PWA Update Prompt Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An installed rope-tangle app picks up each deploy through an "Update ready" button and on return to the foreground, without losing the game in progress.

**Architecture:** `vite-plugin-pwa` (`injectManifest`, `registerType: 'prompt'`) builds a small Workbox worker from `src/pwa/sw.ts` that precaches the app and waits for a `SKIP_WAITING` message. A port of Puzzlewise's update controller decides when to apply an update; before reloading it awaits the game's `prepareReload()`, which refuses new grabs and resolves once every rope end is seated and the game is saved.

**Tech Stack:** TypeScript 7, Vite 8, vite-plugin-pwa 2, workbox-precaching/workbox-routing 7, vitest 5, Playwright 1.64.

**Spec:** `docs/superpowers/specs/2026-10-25-pwa-update-prompt-design.md`

## Global Constraints

- Model on Puzzlewise (`~/src/puzzle`, `src/pwa/`): same plugin options, controller behavior, event names and shapes.
- Code style: 2-space indent, double quotes, semicolons, no parameter properties (`erasableSyntaxOnly`), no `console` (oxlint `no-console: error`). Add code comments only when definitely valuable.
- Unit tests live in `tests/*.test.ts`, run in the node environment (no jsdom); inject DOM and browser dependencies.
- Fallback reload after `3000` ms. At most `5` distinct `pwa-update-check-failed` reasons per session.
- The worker deletes caches whose name starts with `rope-tangle-`; nothing else.
- Precache excludes `debug/**` and `assets/debug-*.js`.
- Button: `<button id="update" hidden>Update ready</button>` in `#bar`, after the settings button.
- Commits: conventional commits, each building and passing tests. End every commit message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. The PR ends up with two commits (Task 1, and Tasks 2–6 squashed in Task 7).
- Run `npm run lint`, `npm run build`, `npm test` before each commit; `npm run e2e` where the task says so.

## Review Focus

- Two tabs open when one applies an update → the other tab also ends up on the new build, after its own ends are seated (Task 5 routes `onNeedReload` through `prepareReload`; e2e test in Task 6).
- Tap on the button while another finger still holds a rope end → the reload waits until that end is let go and has landed (unit test in Task 4).
- Update found while a board is still being made ("Scrambling…") → it applies at once, nothing to save (unit test in Task 4).
- A player still holding today's `rope-tangle-v1` cache → it is deleted when the new worker activates, and the Workbox precache survives (e2e test in Task 1).
- `/dev/` previews and `/debug/` under the root worker's scope → the root worker's navigation route never serves them (unit test in Task 1).

---

## File Structure

- `src/pwa/sw.ts` (new): the service worker. Precache, navigation route, legacy cache cleanup; Task 1 activates at once, Task 5 switches to the `SKIP_WAITING` handshake.
- `src/pwa/navigation-allowlist.ts` (new): `appNavigationAllowlist(base)`, shared by the worker and its test.
- `src/pwa/register-failure.ts` (new): pure `describeRegisterFailure(error, env)` for `pwa-register-failed`.
- `src/pwa/update-controller.ts` (new): `createUpdateController`, `setupUpdateChecks`. Pure; all effects injected.
- `src/pwa/register.ts` (new): browser glue over `virtual:pwa-register`; not imported by unit tests.
- `src/game/reload.ts` (new): `ReloadPreparer`, the game side of "safe to reload".
- `src/analytics/errors.ts`: export `errorName`, add `describeValueType`.
- `src/analytics/umami.ts`: six `pwa-*` events.
- `src/game/app.ts`: own a `ReloadPreparer`, refuse grabs while it is closed, return `{ prepareReload }`.
- `src/main.ts`: registration (Task 1: plain `register`; Task 5: `initPwaUpdates`).
- `index.html`: the `#update` button.
- `vite.config.ts`, `package.json`, `tsconfig.json`, `tsconfig.sw.json` (new), `.gitignore`.
- `e2e/serve.mjs` (new), `playwright.config.ts`, `e2e/game.spec.ts`.
- Deleted: `public/sw.js`.

---

### Task 1: Precache the app with a Workbox worker

Behavior after this task matches today's (a new worker activates at once, pages are not reloaded), but the app is precached and the `cacheUrls` workaround is gone.

**Files:**
- Create: `src/pwa/sw.ts`, `src/pwa/navigation-allowlist.ts`, `tsconfig.sw.json`, `tests/navigation-allowlist.test.ts`
- Modify: `package.json`, `vite.config.ts`, `tsconfig.json`, `src/main.ts`, `e2e/game.spec.ts`
- Delete: `public/sw.js`

**Interfaces:**
- Produces: `appNavigationAllowlist(base: string): RegExp` in `src/pwa/navigation-allowlist.ts`; `dist/sw.js` built from `src/pwa/sw.ts`.

- [ ] **Step 1: Install the dependencies**

```bash
npm install --save-dev vite-plugin-pwa@^2.0.0 workbox-precaching@^7.4.0 workbox-routing@^7.4.0
```

Expected: `package.json` devDependencies gain the three packages; `workbox-window` and `workbox-build` arrive as peer dependencies.

- [ ] **Step 2: Write the failing allowlist test**

`tests/navigation-allowlist.test.ts`:

```ts
import { appNavigationAllowlist } from "../src/pwa/navigation-allowlist";

describe("navigation allowlist", () => {
  it("matches the base with or without a query", () => {
    const re = appNavigationAllowlist("/");
    expect(re.test("/")).toBe(true);
    expect(re.test("/?test=1&ropes=4")).toBe(true);
  });

  it("leaves previews, the debug page and the prototype to the network", () => {
    const re = appNavigationAllowlist("/");
    for (const path of ["/dev/", "/dev/?test=1", "/debug/", "/spike/", "/index.html"]) expect(re.test(path)).toBe(false);
  });

  it("escapes the base so a preview base only matches itself", () => {
    const re = appNavigationAllowlist("/dev/");
    expect(re.test("/dev/")).toBe(true);
    expect(re.test("/dev/?seed=3")).toBe(true);
    expect(re.test("/")).toBe(false);
    expect(re.test("/devx/")).toBe(false);
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run tests/navigation-allowlist.test.ts`
Expected: FAIL, cannot resolve `../src/pwa/navigation-allowlist`.

- [ ] **Step 4: Implement the allowlist**

`src/pwa/navigation-allowlist.ts`:

```ts
export function appNavigationAllowlist(base: string): RegExp {
  const escaped = base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escaped}(?:\\?|$)`);
}
```

Run: `npx vitest run tests/navigation-allowlist.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Write the worker**

`src/pwa/sw.ts`:

```ts
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute, type PrecacheEntry } from "workbox-precaching";
import { NavigationRoute, registerRoute } from "workbox-routing";
import { appNavigationAllowlist } from "./navigation-allowlist";

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: (PrecacheEntry | string)[] };

cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

const base = import.meta.env.BASE_URL;
registerRoute(new NavigationRoute(createHandlerBoundToURL(`${base}index.html`), { allowlist: [appNavigationAllowlist(base)] }));

self.addEventListener("install", () => {
  void self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("rope-tangle-")).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});
```

`self.__WB_MANIFEST` must appear verbatim: the plugin replaces that exact expression.

- [ ] **Step 6: Type-check the worker separately**

`tsconfig.sw.json`:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "lib": ["ES2023", "WebWorker"],
    "types": ["vite/client"]
  },
  "include": ["src/pwa/sw.ts"],
  "exclude": []
}
```

In `tsconfig.json`, add after `"include"`:

```json
  "exclude": ["src/pwa/sw.ts"]
```

In `package.json`, change the scripts:

```json
    "build": "tsc --noEmit && tsc --noEmit -p tsconfig.sw.json && vite build",
    "typecheck": "tsc --noEmit && tsc --noEmit -p tsconfig.sw.json",
```

- [ ] **Step 7: Configure the plugin**

`vite.config.ts`: add `import { VitePWA } from "vite-plugin-pwa";` and, before `build:`, a `plugins` entry:

```ts
  plugins: [
    VitePWA({
      strategies: "injectManifest",
      srcDir: "src/pwa",
      filename: "sw.ts",
      registerType: "prompt",
      injectRegister: false,
      manifest: false,
      injectManifest: {
        globPatterns: ["**/*.{js,html,png,webmanifest}"],
        globIgnores: ["debug/**", "assets/debug-*.js"],
      },
    }),
  ],
```

`injectRegister: false` because `main.ts` registers the worker itself (Task 5 switches to `virtual:pwa-register`, which works with any `injectRegister` value). `manifest: false` keeps `public/manifest.webmanifest` as is.

- [ ] **Step 8: Replace today's worker and registration**

```bash
git rm public/sw.js
```

In `src/main.ts`, replace the whole `if (import.meta.env.PROD && "serviceWorker" in navigator) { … }` block with:

```ts
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  const base = import.meta.env.BASE_URL;
  navigator.serviceWorker.register(`${base}sw.js`, { scope: base }).catch(() => undefined);
}
```

- [ ] **Step 9: Build and inspect the precache**

Run: `npm run build && grep -o '"url":"[^"]*"' dist/sw.js | sort`
Expected: entries for `index.html`, `manifest.webmanifest`, the three icons, and `assets/main-*.js`, `assets/worker-*.js`, `assets/settle-*.js`, `assets/ready-4-*.js` … `assets/ready-10-*.js`. No `debug/index.html`, no `assets/debug-*.js`.

If the URLs are not quoted that way in the minified output, inspect with `grep -o 'assets/[a-z0-9-]*-[A-Za-z0-9_-]*\.js' dist/sw.js | sort -u` and `grep -c debug dist/sw.js` (expected `0`).

- [ ] **Step 10: Add the legacy-cache e2e test**

In `e2e/game.spec.ts`, inside `test.describe("offline", …)`, add:

```ts
  test("drops the old worker's cache and keeps the precache", async ({ page }) => {
    await page.goto("?test=1");
    await loaded(page);
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
    await page.evaluate(() => caches.open("rope-tangle-v1").then(() => undefined));
    await page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => r?.unregister()));
    await page.reload();
    await loaded(page);
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
    await expect
      .poll(() => page.evaluate(() => caches.keys()), { timeout: 15_000 })
      .toEqual([expect.stringContaining("workbox-precache")]);
  });
```

The unregister + reload makes the worker install and activate again, the way a player on today's worker gets the new one.

- [ ] **Step 11: Run everything**

Run: `npm run lint && npm run build && npm test && npm run e2e`
Expected: all green, including "plays offline after one visit" and "caches the board generator even when it finishes loading late" (now satisfied by the precache).

If oxlint's type-aware pass reports `src/pwa/sw.ts` as outside any project, add `"src/pwa/sw.ts"` to `ignorePatterns` in `.oxlintrc.jsonc`; `tsconfig.sw.json` still type-checks it in `npm run build`.

- [ ] **Step 12: Commit**

```bash
git add -A package.json package-lock.json vite.config.ts tsconfig.json tsconfig.sw.json src/pwa src/main.ts tests/navigation-allowlist.test.ts e2e/game.spec.ts public/sw.js .oxlintrc.jsonc
git commit -m "feat: precache the app with a Workbox service worker

The hand-written worker cached pages network-first and only learned
about assets from the page, so the board worker could miss the cache.
vite-plugin-pwa now builds src/pwa/sw.ts with the whole app in its
precache (except the debug page), and navigations to the base are
served from it. A new worker still activates at once, as before. The
old worker's rope-tangle-v1 cache is deleted on activation.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: PWA analytics events and the register-failure description

**Files:**
- Modify: `src/analytics/umami.ts`, `src/analytics/errors.ts`
- Create: `src/pwa/register-failure.ts`, `tests/register-failure.test.ts`

**Interfaces:**
- Produces in `src/analytics/umami.ts`:
  ```ts
  export type UpdateTrigger = "manual" | "focus-regain";
  export type PwaRegisterFailedData = { reason: string; valueType: string; name: string; registerFunction: "native" | "replaced" | "unavailable"; displayMode: "standalone" | "browser"; visibilityState: string };
  // Events gains:
  "pwa-update-detected": Record<string, never>;
  "pwa-update-applied": { trigger: UpdateTrigger };
  "pwa-update-apply-failed": { reason: string };
  "pwa-update-fallback-reload": Record<string, never>;
  "pwa-update-check-failed": { reason: string };
  "pwa-register-failed": PwaRegisterFailedData;
  ```
- Produces in `src/analytics/errors.ts`: `export function errorName(value: unknown): string` (unchanged body, now exported) and `export function describeValueType(value: unknown): string`.
- Produces in `src/pwa/register-failure.ts`:
  ```ts
  export interface RegisterEnv { readRegister: () => unknown; standalone: boolean; visibilityState: string }
  export function describeRegisterFailure(error: unknown, env: RegisterEnv): PwaRegisterFailedData
  ```

- [ ] **Step 1: Write the failing test**

`tests/register-failure.test.ts`:

```ts
import { describeRegisterFailure, type RegisterEnv } from "../src/pwa/register-failure";

const env = (over: Partial<RegisterEnv> = {}): RegisterEnv => ({
  readRegister: () => Array.prototype.push,
  standalone: false,
  visibilityState: "visible",
  ...over,
});

describe("register failure description", () => {
  it("describes an Error with a native register function in a browser tab", () => {
    expect(describeRegisterFailure(new TypeError("Failed to register a ServiceWorker at https://x.test/sw.js"), env())).toEqual({
      reason: "Failed to register a ServiceWorker at <url>",
      valueType: "TypeError",
      name: "TypeError",
      registerFunction: "native",
      displayMode: "browser",
      visibilityState: "visible",
    });
  });

  it("names a replaced register function and an installed app", () => {
    const d = describeRegisterFailure("nope", env({ readRegister: () => () => undefined, standalone: true, visibilityState: "hidden" }));
    expect(d).toMatchObject({ reason: "nope", valueType: "string", name: "string", registerFunction: "replaced", displayMode: "standalone", visibilityState: "hidden" });
  });

  it("calls the register function unavailable when reading it throws", () => {
    const d = describeRegisterFailure(null, env({ readRegister: () => {
      throw new Error("denied");
    } }));
    expect(d).toMatchObject({ valueType: "null", name: "null", registerFunction: "unavailable" });
  });

  it("names a plain object by its constructor", () => {
    expect(describeRegisterFailure(new Event("error"), env())).toMatchObject({ valueType: "Event", name: "object" });
  });
});
```

`Array.prototype.push` stands in for a native function in node. `name` for a non-Error keeps `errorName`'s existing `typeof` answer, so `unhandled-error` data does not change.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/register-failure.test.ts`
Expected: FAIL, cannot resolve `../src/pwa/register-failure`.

- [ ] **Step 3: Add the helpers and events**

`src/analytics/errors.ts`: change `function errorName(` to `export function errorName(` and add below it:

```ts
export function describeValueType(value: unknown): string {
  if (value === null) return "null";
  if (typeof value !== "object") return typeof value;
  const name: unknown = Object.getPrototypeOf(value)?.constructor?.name;
  return typeof name === "string" && name !== "" ? name : "object";
}
```

`src/analytics/umami.ts`: after `NewGameStartedData`, add

```ts
export type UpdateTrigger = "manual" | "focus-regain";

export type PwaRegisterFailedData = {
  reason: string;
  valueType: string;
  name: string;
  registerFunction: "native" | "replaced" | "unavailable";
  displayMode: "standalone" | "browser";
  visibilityState: string;
};
```

and at the end of `Events`:

```ts
  "pwa-update-detected": Record<string, never>;
  "pwa-update-applied": { trigger: UpdateTrigger };
  "pwa-update-apply-failed": { reason: string };
  "pwa-update-fallback-reload": Record<string, never>;
  "pwa-update-check-failed": { reason: string };
  "pwa-register-failed": PwaRegisterFailedData;
```

- [ ] **Step 4: Implement the description**

`src/pwa/register-failure.ts`:

```ts
import { describeValueType, errorName, sanitizeReason } from "../analytics/errors";
import type { PwaRegisterFailedData } from "../analytics/umami";

export interface RegisterEnv {
  readRegister: () => unknown;
  standalone: boolean;
  visibilityState: string;
}

function describeRegisterFunction(readRegister: () => unknown): PwaRegisterFailedData["registerFunction"] {
  let register: unknown;
  try {
    register = readRegister();
  } catch {
    return "unavailable";
  }
  return typeof register === "function" && Function.prototype.toString.call(register).includes("[native code]") ? "native" : "replaced";
}

export function describeRegisterFailure(error: unknown, env: RegisterEnv): PwaRegisterFailedData {
  return {
    reason: sanitizeReason(error),
    valueType: describeValueType(error),
    name: errorName(error),
    registerFunction: describeRegisterFunction(env.readRegister),
    displayMode: env.standalone ? "standalone" : "browser",
    visibilityState: env.visibilityState,
  };
}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run tests/register-failure.test.ts tests/analytics.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/analytics/umami.ts src/analytics/errors.ts src/pwa/register-failure.ts tests/register-failure.test.ts
git commit -m "feat: add the PWA update analytics events

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Update controller and update checks

A port of Puzzlewise's `src/pwa/update-controller.ts`. Differences: `track` is injected (no module mocking in tests); `flush()` becomes `prepareReload(): Promise<void>`, awaited before `updateSW(true)`; no `share-link-rescue` trigger, so `reloadNow()` takes no argument; no `diagnostics.warn` (no console in this repo).

**Files:**
- Create: `src/pwa/update-controller.ts`, `tests/update-controller.test.ts`

**Interfaces:**
- Consumes: `Events`, `UpdateTrigger` from `src/analytics/umami.ts`; `sanitizeReason` from `src/analytics/errors.ts`.
- Produces:
  ```ts
  export type Track = <K extends keyof Events>(name: K, data: Events[K]) => void;
  export type UpdateSW = (reload?: boolean) => Promise<void>;
  export interface UpdatableRegistration { update(): Promise<unknown> | void }
  export interface UpdateControllerDeps {
    track: Track;
    prepareReload: () => Promise<void>;
    showIndicator: (onRefresh: () => void) => void;
    reload?: () => void;
    scheduleFallback?: (handler: () => void, ms: number) => void;
  }
  export interface UpdateController {
    onNeedRefresh(): void;
    setUpdateSW(updateSW: UpdateSW): void;
    requestReloadIfPending(): void;
    reloadNow(): void;
    readonly pending: boolean;
  }
  export const FALLBACK_RELOAD_MS = 3000;
  export function createUpdateController(deps: UpdateControllerDeps): UpdateController;
  export interface UpdateCheckDeps { track: Track; addVisibilityListener?: (handler: () => void) => void; isVisible?: () => boolean }
  export function setupUpdateChecks(registration: UpdatableRegistration, controller: UpdateController, deps: UpdateCheckDeps): void;
  ```

- [ ] **Step 1: Write the failing tests**

`tests/update-controller.test.ts`:

```ts
import type { Events } from "../src/analytics/umami";
import { createUpdateController, FALLBACK_RELOAD_MS, setupUpdateChecks, type UpdateController, type UpdateControllerDeps } from "../src/pwa/update-controller";

type Sent = [keyof Events, unknown][];

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function setup(over: Partial<UpdateControllerDeps> = {}) {
  const sent: Sent = [];
  const deps = {
    track: (name: keyof Events, data: unknown) => void sent.push([name, data]),
    prepareReload: vi.fn(() => Promise.resolve()),
    showIndicator: vi.fn<(onRefresh: () => void) => void>(),
    reload: vi.fn(),
    scheduleFallback: vi.fn<(handler: () => void, ms: number) => void>(),
    ...over,
  };
  const updateSW = vi.fn(() => Promise.resolve());
  return { sent, deps, updateSW, controller: createUpdateController(deps) };
}

describe("update controller", () => {
  it("is not pending before an update is waiting", () => {
    expect(setup().controller.pending).toBe(false);
  });

  it("marks the update pending and shows the button once", () => {
    const { controller, deps, sent } = setup();
    controller.onNeedRefresh();
    controller.onNeedRefresh();
    expect(controller.pending).toBe(true);
    expect(deps.showIndicator).toHaveBeenCalledOnce();
    expect(sent.filter(([n]) => n === "pwa-update-detected")).toEqual([["pwa-update-detected", {}]]);
  });

  it("prepares the game before activating the new worker", async () => {
    let finish = () => {};
    const { controller, updateSW } = setup({ prepareReload: () => new Promise<void>((resolve) => (finish = () => resolve())) });
    controller.setUpdateSW(updateSW);
    controller.reloadNow();
    await settle();
    expect(updateSW).not.toHaveBeenCalled();
    finish();
    await settle();
    expect(updateSW).toHaveBeenCalledWith(true);
  });

  it("applies once, however often it is triggered while preparing", async () => {
    let finish = () => {};
    const { controller, deps, updateSW } = setup({ prepareReload: vi.fn(() => new Promise<void>((resolve) => (finish = () => resolve()))) });
    controller.setUpdateSW(updateSW);
    controller.onNeedRefresh();
    controller.reloadNow();
    controller.reloadNow();
    controller.requestReloadIfPending();
    finish();
    await settle();
    expect(deps.prepareReload).toHaveBeenCalledOnce();
    expect(updateSW).toHaveBeenCalledOnce();
    expect(deps.scheduleFallback).toHaveBeenCalledOnce();
  });

  it("buffers a request made before updateSW exists and applies it once set", async () => {
    const { controller, deps, updateSW, sent } = setup();
    controller.onNeedRefresh();
    controller.requestReloadIfPending();
    await settle();
    expect(deps.prepareReload).not.toHaveBeenCalled();
    controller.setUpdateSW(updateSW);
    controller.setUpdateSW(updateSW);
    await settle();
    expect(updateSW).toHaveBeenCalledOnce();
    expect(sent).toContainEqual(["pwa-update-applied", { trigger: "focus-regain" }]);
  });

  it("does nothing on setUpdateSW when no update was requested", async () => {
    const { controller, updateSW } = setup();
    controller.setUpdateSW(updateSW);
    await settle();
    expect(updateSW).not.toHaveBeenCalled();
  });

  it("applies on return to the foreground only while an update is pending", async () => {
    const { controller, updateSW, sent } = setup();
    controller.setUpdateSW(updateSW);
    controller.requestReloadIfPending();
    await settle();
    expect(updateSW).not.toHaveBeenCalled();
    controller.onNeedRefresh();
    controller.requestReloadIfPending();
    await settle();
    expect(updateSW).toHaveBeenCalledWith(true);
    expect(sent).toContainEqual(["pwa-update-applied", { trigger: "focus-regain" }]);
  });

  it("applies with the manual trigger when the button is tapped", async () => {
    let tap = () => {};
    const { controller, updateSW, sent } = setup({ showIndicator: (onRefresh) => (tap = onRefresh) });
    controller.setUpdateSW(updateSW);
    controller.onNeedRefresh();
    tap();
    await settle();
    expect(updateSW).toHaveBeenCalledWith(true);
    expect(sent).toContainEqual(["pwa-update-applied", { trigger: "manual" }]);
  });

  it("falls back to a hard reload after the fallback delay", async () => {
    const { controller, deps, updateSW, sent } = setup();
    controller.setUpdateSW(updateSW);
    controller.reloadNow();
    await settle();
    expect(deps.scheduleFallback).toHaveBeenCalledWith(expect.any(Function), FALLBACK_RELOAD_MS);
    expect(deps.reload).not.toHaveBeenCalled();
    deps.scheduleFallback.mock.calls[0]![0]();
    expect(deps.reload).toHaveBeenCalledOnce();
    expect(sent).toContainEqual(["pwa-update-fallback-reload", {}]);
  });

  it("reports an activation that rejects and still schedules the fallback", async () => {
    const { controller, deps, sent } = setup();
    controller.setUpdateSW(() => Promise.reject(new Error("boom")));
    controller.reloadNow();
    await settle();
    expect(sent).toContainEqual(["pwa-update-apply-failed", { reason: "boom" }]);
    expect(deps.scheduleFallback).toHaveBeenCalledOnce();
  });
});

function fakeController(): UpdateController {
  return { onNeedRefresh: vi.fn(), setUpdateSW: vi.fn(), requestReloadIfPending: vi.fn(), reloadNow: vi.fn(), pending: false };
}

function checks(update: () => Promise<unknown> | void, visible = true) {
  const sent: Sent = [];
  const registration = { update: vi.fn(update) };
  const controller = fakeController();
  let onVisibility = () => {};
  setupUpdateChecks(registration, controller, {
    track: (name, data) => void sent.push([name, data]),
    addVisibilityListener: (handler) => (onVisibility = handler),
    isVisible: () => visible,
  });
  return { sent, registration, controller, show: () => onVisibility() };
}

describe("update checks", () => {
  it("does not check at setup", () => {
    expect(checks(() => undefined).registration.update).not.toHaveBeenCalled();
  });

  it("checks and applies a pending update when the page becomes visible", () => {
    const { registration, controller, show } = checks(() => undefined);
    show();
    expect(registration.update).toHaveBeenCalledOnce();
    expect(controller.requestReloadIfPending).toHaveBeenCalledOnce();
  });

  it("ignores the page becoming hidden", () => {
    const { registration, controller, show } = checks(() => undefined, false);
    show();
    expect(registration.update).not.toHaveBeenCalled();
    expect(controller.requestReloadIfPending).not.toHaveBeenCalled();
  });

  it("reports nothing when a check succeeds", async () => {
    const { sent, show } = checks(() => Promise.resolve());
    show();
    await settle();
    expect(sent).toEqual([]);
  });

  it("reports each failing reason once", async () => {
    const { sent, show } = checks(() => Promise.reject(new Error("offline")));
    for (let i = 0; i < 4; i++) {
      show();
      await settle();
    }
    expect(sent).toEqual([["pwa-update-check-failed", { reason: "offline" }]]);
  });

  it("reports at most five distinct reasons", async () => {
    let i = 0;
    const { sent, show } = checks(() => Promise.reject(new Error(`reason-${i++}`)));
    for (let n = 0; n < 6; n++) {
      show();
      await settle();
    }
    expect(sent.map(([, d]) => d)).toEqual([0, 1, 2, 3, 4].map((n) => ({ reason: `reason-${n}` })));
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/update-controller.test.ts`
Expected: FAIL, cannot resolve `../src/pwa/update-controller`.

- [ ] **Step 3: Implement the controller and checks**

`src/pwa/update-controller.ts`:

```ts
import { sanitizeReason } from "../analytics/errors";
import type { Events, UpdateTrigger } from "../analytics/umami";

export type Track = <K extends keyof Events>(name: K, data: Events[K]) => void;
export type UpdateSW = (reload?: boolean) => Promise<void>;

export interface UpdatableRegistration {
  update(): Promise<unknown> | void;
}

export interface UpdateControllerDeps {
  track: Track;
  prepareReload: () => Promise<void>;
  showIndicator: (onRefresh: () => void) => void;
  reload?: () => void;
  scheduleFallback?: (handler: () => void, ms: number) => void;
}

export interface UpdateController {
  onNeedRefresh(): void;
  setUpdateSW(updateSW: UpdateSW): void;
  requestReloadIfPending(): void;
  reloadNow(): void;
  readonly pending: boolean;
}

export const FALLBACK_RELOAD_MS = 3000;
const MAX_CHECK_FAILURE_REASONS = 5;

export function createUpdateController(deps: UpdateControllerDeps): UpdateController {
  const reload = deps.reload ?? (() => location.reload());
  const scheduleFallback =
    deps.scheduleFallback ??
    ((handler: () => void, ms: number) => {
      setTimeout(handler, ms);
    });
  let pending = false, applying = false;
  let updateSW: UpdateSW | null = null;
  let buffered: UpdateTrigger | null = null;

  const apply = (trigger: UpdateTrigger): void => {
    if (applying) return;
    const activate = updateSW;
    if (!activate) {
      buffered = trigger;
      return;
    }
    applying = true;
    deps.track("pwa-update-applied", { trigger });
    void deps.prepareReload().then(() => {
      Promise.resolve(activate(true)).catch((e: unknown) => deps.track("pwa-update-apply-failed", { reason: sanitizeReason(e) }));
      scheduleFallback(() => {
        deps.track("pwa-update-fallback-reload", {});
        reload();
      }, FALLBACK_RELOAD_MS);
    });
  };

  return {
    onNeedRefresh() {
      if (pending) return;
      pending = true;
      deps.track("pwa-update-detected", {});
      deps.showIndicator(() => apply("manual"));
    },
    setUpdateSW(fn) {
      updateSW = fn;
      if (buffered !== null) {
        const trigger = buffered;
        buffered = null;
        apply(trigger);
      }
    },
    requestReloadIfPending() {
      if (pending) apply("focus-regain");
    },
    reloadNow() {
      apply("manual");
    },
    get pending() {
      return pending;
    },
  };
}

export interface UpdateCheckDeps {
  track: Track;
  addVisibilityListener?: (handler: () => void) => void;
  isVisible?: () => boolean;
}

export function setupUpdateChecks(registration: UpdatableRegistration, controller: UpdateController, deps: UpdateCheckDeps): void {
  const isVisible = deps.isVisible ?? (() => document.visibilityState === "visible");
  const addVisibilityListener = deps.addVisibilityListener ?? ((handler: () => void) => document.addEventListener("visibilitychange", handler));
  const reported = new Set<string>();
  const reportFailure = (e: unknown): void => {
    const reason = sanitizeReason(e);
    if (reported.has(reason) || reported.size >= MAX_CHECK_FAILURE_REASONS) return;
    reported.add(reason);
    deps.track("pwa-update-check-failed", { reason });
  };
  addVisibilityListener(() => {
    if (!isVisible()) return;
    Promise.resolve(registration.update()).catch(reportFailure);
    controller.requestReloadIfPending();
  });
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/update-controller.test.ts`
Expected: PASS (16 tests). If oxlint later flags the floating `Promise.resolve(...).catch(...)` expressions, prefix them with `void`.

- [ ] **Step 5: Commit**

```bash
git add src/pwa/update-controller.ts tests/update-controller.test.ts
git commit -m "feat: decide when to apply a waiting app update

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Prepare the game for a reload

**Files:**
- Create: `src/game/reload.ts`, `tests/reload.test.ts`
- Modify: `src/game/app.ts`

**Interfaces:**
- Consumes: `Session` (`phase`, `won`, `engine.endsSeated()`, `grab`, `drag`, `release`, `step`) and `GameSaver` (`started`, `hidden`, `load`) as they exist on main.
- Produces:
  ```ts
  // src/game/reload.ts
  export class ReloadPreparer {
    closed: boolean;
    constructor(game: () => Session | null, save: () => void);
    prepare(): Promise<void>;
    check(): void;
  }
  // src/game/app.ts
  export interface App { prepareReload(): Promise<void> }
  export function startApp(doc: Document, win: Window): App;
  ```

- [ ] **Step 1: Write the failing tests**

`tests/reload.test.ts`:

```ts
import { generateBoard } from "../src/generate/generate";
import { storageKeys } from "../src/game/records";
import { ReloadPreparer } from "../src/game/reload";
import { GameSaver } from "../src/game/saver";
import { Session } from "../src/game/session";
import { memoryStore } from "../src/game/settings";

const KEY = storageKeys("/").game;
const still = { now: () => 0 };

function setup() {
  const session = new Session(generateBoard(9, 4).engine);
  const saver = new GameSaver(memoryStore(), KEY, () => 0);
  saver.started({ session, ropes: 4, seed: 9, startedAt: 0 });
  let current: Session | null = session;
  const preparer = new ReloadPreparer(() => current, () => saver.hidden());
  return { session, saver, preparer, setGame: (s: Session | null) => (current = s) };
}

function watch(p: Promise<void>): { done: boolean } {
  const state = { done: false };
  void p.then(() => (state.done = true));
  return state;
}

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function moveEnd(s: Session): void {
  const E = s.engine, r = E.active()[0]!;
  const free = E.board.holes.findIndex((_, i) => !E.occupied().has(i));
  expect(s.grab(E.hole(r.ends[1]!))).toBe(true);
  s.drag(E.hole(free));
  s.release();
}

function frames(s: Session, preparer: ReloadPreparer, until: () => boolean): void {
  for (let f = 0; f < 3000 && !until(); f++) {
    s.step(still, 1);
    preparer.check();
  }
}

describe("reload preparer", () => {
  it("is open until a reload is prepared", () => {
    const { preparer } = setup();
    expect(preparer.closed).toBe(false);
    void preparer.prepare();
    expect(preparer.closed).toBe(true);
  });

  it("resolves at once while no board is in play", async () => {
    const { preparer, setGame } = setup();
    setGame(null);
    const p = watch(preparer.prepare());
    await settle();
    expect(p.done).toBe(true);
  });

  it("resolves at once for a solved game", async () => {
    const { preparer, session } = setup();
    session.won = true;
    const p = watch(preparer.prepare());
    await settle();
    expect(p.done).toBe(true);
  });

  it("waits for a dropped end to land, then saves the move before resolving", async () => {
    const { session, saver, preparer } = setup();
    moveEnd(session);
    const p = watch(preparer.prepare());
    await settle();
    expect(p.done).toBe(false);
    frames(session, preparer, () => session.engine.endsSeated());
    expect(saver.load()).toMatchObject({ moves: 1 });
    await settle();
    expect(p.done).toBe(true);
  });

  it("waits while another finger still holds an end", async () => {
    const { session, preparer } = setup();
    const r = session.engine.active()[1]!;
    expect(session.grab(session.engine.hole(r.ends[0]!))).toBe(true);
    const p = watch(preparer.prepare());
    for (let f = 0; f < 30; f++) {
      session.step(still, 1);
      preparer.check();
    }
    await settle();
    expect(p.done).toBe(false);
    session.release();
    frames(session, preparer, () => session.engine.endsSeated());
    await settle();
    expect(p.done).toBe(true);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/reload.test.ts`
Expected: FAIL, cannot resolve `../src/game/reload`.

- [ ] **Step 3: Implement the preparer**

`src/game/reload.ts`:

```ts
import type { Session } from "./session";

export class ReloadPreparer {
  closed = false;
  private readonly game: () => Session | null;
  private readonly save: () => void;
  private waiting: (() => void)[] = [];

  constructor(game: () => Session | null, save: () => void) {
    this.game = game;
    this.save = save;
  }

  prepare(): Promise<void> {
    this.closed = true;
    const ready = new Promise<void>((resolve) => this.waiting.push(resolve));
    this.check();
    return ready;
  }

  check(): void {
    if (this.waiting.length === 0) return;
    const s = this.game();
    if (s && !s.won && !s.engine.endsSeated()) return;
    this.save();
    for (const resolve of this.waiting.splice(0)) resolve();
  }
}
```

Run: `npx vitest run tests/reload.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 4: Wire it into the app**

In `src/game/app.ts`:

1. Import: `import { ReloadPreparer } from "./reload";`
2. Above `startApp`, add:
   ```ts
   export interface App {
     prepareReload(): Promise<void>;
   }
   ```
3. Change the signature to `export function startApp(doc: Document, win: Window): App {`.
4. Right after `const saver = new GameSaver(store, keys.game, () => played.now());`, add:
   ```ts
   const reload = new ReloadPreparer(() => session, () => saver.hidden());
   ```
   (`session` is declared a few lines further down with `let`; the closure only reads it later, so the order is fine.)
5. In the `pointerdown` listener, change the guard to:
   ```ts
   if (reload.closed || activePointer !== null || !session || !session.grab(toBoard(ev))) return;
   ```
6. In `tick`, add `reload.check();` right before `frames.ticks++;` (outside `if (s)`, so a reload prepared while no board is in play also resolves).
7. At the end of `startApp`, after `win.requestAnimationFrame(tick);`, add:
   ```ts
   return { prepareReload: () => reload.prepare() };
   ```

`saver.hidden()` writes only when every end is seated and the game is not solved, which is exactly when `check()` calls it; for the easy test board nothing is written, as before.

- [ ] **Step 5: Run everything**

Run: `npm run lint && npm run build && npm test`
Expected: all green (main.ts ignores the return value until Task 5).

- [ ] **Step 6: Commit**

```bash
git add src/game/reload.ts src/game/app.ts tests/reload.test.ts
git commit -m "feat: let the game prepare for a reload

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Prompt mode, registration and the button

**Files:**
- Create: `src/pwa/register.ts`
- Modify: `src/pwa/sw.ts`, `src/main.ts`, `index.html`, `tsconfig.json`

**Interfaces:**
- Consumes: `createUpdateController`, `setupUpdateChecks` (Task 3), `describeRegisterFailure` (Task 2), `track` from `src/analytics/umami.ts`, `App.prepareReload` (Task 4).
- Produces: `export function initPwaUpdates(doc: Document, prepareReload: () => Promise<void>): void` in `src/pwa/register.ts`.

- [ ] **Step 1: Switch the worker to the SKIP_WAITING handshake**

In `src/pwa/sw.ts`, replace the `install` listener and the `activate` listener with:

```ts
self.addEventListener("message", (event) => {
  if ((event.data as { type?: unknown } | null)?.type === "SKIP_WAITING") void self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith("rope-tangle-")).map((k) => caches.delete(k)))));
});
```

The worker no longer activates itself and no longer claims clients, as in Puzzlewise.

- [ ] **Step 2: Add the button**

In `index.html`, after `<button id="settings-button" aria-label="Settings">⚙︎</button>`, add:

```html
      <button id="update" hidden>Update ready</button>
```

The existing `#bar button` rule styles it; `[hidden] { display: none !important; }` hides it.

- [ ] **Step 3: Write the registration glue**

`tsconfig.json`: change `"types"` to `["vitest/globals", "vite/client", "vite-plugin-pwa/client"]`.

`src/pwa/register.ts`:

```ts
import { registerSW } from "virtual:pwa-register";
import { track } from "../analytics/umami";
import { describeRegisterFailure } from "./register-failure";
import { createUpdateController, setupUpdateChecks } from "./update-controller";

export function initPwaUpdates(doc: Document, prepareReload: () => Promise<void>): void {
  const button = doc.getElementById("update");
  if (!(button instanceof HTMLButtonElement)) throw new Error("missing #update");
  const controller = createUpdateController({
    track,
    prepareReload,
    showIndicator: (onRefresh) => {
      button.addEventListener("click", onRefresh);
      button.hidden = false;
    },
  });
  const updateSW = registerSW({
    onNeedRefresh: () => controller.onNeedRefresh(),
    onNeedReload: () => {
      void prepareReload().then(() => location.reload());
    },
    onRegisteredSW: (_url, registration) => {
      if (registration) setupUpdateChecks(registration, controller, { track });
    },
    onRegisterError: (error: unknown) => {
      track(
        "pwa-register-failed",
        describeRegisterFailure(error, {
          readRegister: () => navigator.serviceWorker.register,
          standalone: matchMedia("(display-mode: standalone)").matches,
          visibilityState: doc.visibilityState,
        }),
      );
    },
  });
  controller.setUpdateSW(updateSW);
}
```

`onNeedReload` replaces `registerSW`'s own `location.reload()` when the new worker takes control. That covers this tab after `updateSW(true)` and every other open tab of the app, so all of them reload only once their ends are seated. If oxlint flags `navigator.serviceWorker.register` as an unbound method, use `() => Reflect.get(navigator.serviceWorker, "register")`.

- [ ] **Step 4: Register through it**

`src/main.ts`:

1. Add `import { initPwaUpdates } from "./pwa/register";`
2. Change `startApp(document, window);` to `const app = startApp(document, window);`
3. Replace the registration block from Task 1 with:
   ```ts
   if (import.meta.env.PROD && "serviceWorker" in navigator) initPwaUpdates(document, app.prepareReload);
   ```

- [ ] **Step 5: Run everything**

Run: `npm run lint && npm run build && npm test && npm run e2e`
Expected: all green, and `grep -c SKIP_WAITING dist/sw.js` prints `1`.

- [ ] **Step 6: Commit**

```bash
git add src/pwa/sw.ts src/pwa/register.ts src/main.ts index.html tsconfig.json
git commit -m "feat: offer a waiting app update in the top bar

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: End-to-end tests against a real update

**Files:**
- Create: `e2e/serve.mjs`
- Modify: `playwright.config.ts`, `e2e/game.spec.ts`, `.gitignore`

**Interfaces:**
- Consumes: the test API (`window.ropeTangleTest`), `#update`, `#deploy-id` (shows `VITE_APP_VERSION`).
- Produces: a static server on port 4719 serving `dist/` (build `e2e-build`), or `dist-next/` (build `e2e-next`) for requests carrying the cookie `build=next`. Cookies are per browser context, so tests running in parallel don't affect each other.

- [ ] **Step 1: Write the server**

`e2e/serve.mjs`:

```js
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const builds = { current: join(root, "dist"), next: join(root, "dist-next") };
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".png": "image/png",
  ".webmanifest": "application/manifest+json",
};
const port = Number(process.argv[2] ?? 4719);

createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const dir = /(?:^|;\s*)build=next(?:;|$)/.test(req.headers.cookie ?? "") ? builds.next : builds.current;
  let path = normalize(decodeURIComponent(url.pathname));
  if (path.endsWith(sep) || path.endsWith("/")) path = join(path, "index.html");
  const file = join(dir, path);
  if (!file.startsWith(dir + sep)) {
    res.writeHead(403).end();
    return;
  }
  readFile(file).then(
    (body) => {
      res.writeHead(200, { "Content-Type": types[extname(file)] ?? "application/octet-stream", "Cache-Control": "no-cache" });
      res.end(body);
    },
    () => res.writeHead(404).end(),
  );
}).listen(port);
```

- [ ] **Step 2: Build twice and serve both**

`.gitignore`: add a line `dist-next/`.

`playwright.config.ts`, `webServer.command`:

```ts
    command:
      "VITE_APP_VERSION=e2e-build VITE_UMAMI_WEBSITE_ID=e2e-site VITE_UMAMI_SCRIPT_URL=/e2e-tracker.js npm run build && VITE_APP_VERSION=e2e-next VITE_UMAMI_WEBSITE_ID=e2e-site VITE_UMAMI_SCRIPT_URL=/e2e-tracker.js npx vite build --outDir dist-next && node e2e/serve.mjs 4719",
```

Run: `npm run e2e`
Expected: every existing test still passes on the new server.

- [ ] **Step 3: Write the update tests**

In `e2e/game.spec.ts`, move `HOLES_ON_4_ROPE_BOARD` and `moveOneEnd` out of `test.describe("saved games", …)` to file level (below `idle`), unchanged. Then add at the end of the file:

```ts
test.describe("app updates", () => {
  const savedMoves = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem("rope-tangle/game") ?? "{}").moves);

  async function controlledPage(page: Page): Promise<void> {
    await page.goto("?test=1&ropes=4");
    await loaded(page);
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
    await page.reload();
    await loaded(page);
    await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
    await expect(page.locator("#update")).toBeHidden();
  }

  async function deployNext(page: Page): Promise<void> {
    await page.context().addCookies([{ name: "build", value: "next", url: "http://localhost:4719/" }]);
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await expect(page.locator("#update")).toBeVisible({ timeout: 15_000 });
  }

  test("applies an update on a tap and keeps the game", async ({ page }) => {
    await controlledPage(page);
    await expect(page.locator("#deploy-id")).toHaveText("e2e-build");
    await moveOneEnd(page);
    await deployNext(page);
    await page.locator("#update").click();
    await expect(page.locator("#deploy-id")).toHaveText("e2e-next", { timeout: 15_000 });
    await loaded(page);
    expect((await state(page)).moves).toBe(1);
  });

  test("on return to the foreground, waits for a flying end to land before reloading", async ({ page }) => {
    await controlledPage(page);
    await deployNext(page);
    const s = await state(page);
    const taken = new Set(s.ends.flat());
    const free = [...Array(HOLES_ON_4_ROPE_BOARD).keys()].find((i) => !taken.has(i))!;
    await drag(page, await page.evaluate((i) => window.ropeTangleTest!.holeToClient(i), s.ends[0]![1]!), await page.evaluate((i) => window.ropeTangleTest!.holeToClient(i), free));
    const savedWhenShown = await page.evaluate(() => {
      const moves: unknown = JSON.parse(localStorage.getItem("rope-tangle/game") ?? "{}").moves;
      document.dispatchEvent(new Event("visibilitychange"));
      return moves;
    });
    expect(savedWhenShown).toBe(0);
    await expect(page.locator("#deploy-id")).toHaveText("e2e-next", { timeout: 15_000 });
    await loaded(page);
    expect((await state(page)).moves).toBe(1);
    expect(await savedMoves(page)).toBe(1);
  });

  test("moves a second open tab to the new build too", async ({ page, context }) => {
    await controlledPage(page);
    const other = await context.newPage();
    await other.goto("?test=1&ropes=4");
    await loaded(other);
    await deployNext(page);
    await page.locator("#update").click();
    await expect(page.locator("#deploy-id")).toHaveText("e2e-next", { timeout: 15_000 });
    await expect(other.locator("#deploy-id")).toHaveText("e2e-next", { timeout: 15_000 });
  });
});
```

`savedWhenShown === 0` proves the visibility event arrived before the move was saved; the move surviving the reload proves the reload waited for the landing.

- [ ] **Step 4: Run the update tests and repeat them**

Run: `npx playwright test -g "app updates" --repeat-each=5`
Expected: 15 passed. If `savedWhenShown` is sometimes `1` (the end landed before the evaluate ran), dispatch the event from inside a `pointerup` listener added in the same evaluate before the drag instead, so it fires the moment the end is released:

```ts
await page.evaluate(() => document.addEventListener("pointerup", () => setTimeout(() => document.dispatchEvent(new Event("visibilitychange"))), { once: true, capture: true }));
```

Then confirm the update tests fail without the waiting: temporarily change `ReloadPreparer.check` to skip the `endsSeated()` condition, run `npx playwright test -g "flying end"` (expected FAIL on `moves`), and restore it.

- [ ] **Step 5: Run everything**

Run: `npm run lint && npm run build && npm test && npm run e2e`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add e2e/serve.mjs e2e/game.spec.ts playwright.config.ts .gitignore
git commit -m "test: apply a real app update end to end

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Squash into the PR's second commit and open the PR

- [ ] **Step 1: Squash Tasks 2–6**

Find Task 1's commit (`feat: precache the app with a Workbox service worker`) and squash everything after it into one commit:

```bash
BASE=$(git log --format=%H --grep="^feat: precache the app with a Workbox service worker" -1)
TREE=$(git rev-parse HEAD^{tree})
git reset --soft "$BASE"
git commit -m "feat: offer app updates without losing the game

The worker now waits for the page instead of activating itself. Each
return to the foreground checks for a new build; when one is waiting,
an \"Update ready\" button appears in the top bar. Tapping it, or
returning to the app while it shows, applies the update: new grabs are
refused, and once every rope end is seated the game is saved and the
page reloads into the new build. Other open tabs reload the same way.
A fallback reload follows after 3 s if the new worker never takes over.

The update funnel is reported as pwa-update-detected, -applied
{trigger}, -apply-failed, -fallback-reload, -check-failed and
pwa-register-failed. The end-to-end tests serve two builds and apply a
real update.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
test "$(git rev-parse HEAD^{tree})" = "$TREE" && echo "tree identical"
git log --oneline origin/main..HEAD
```

Expected: `tree identical`, then four commits, newest first: the new one, Task 1, the plan, the spec.

- [ ] **Step 2: Verify each commit builds**

```bash
git rebase --exec "npm run lint && npm run build && npm test" origin/main
```

Expected: every commit passes.

- [ ] **Step 3: Push and open the PR (ask Adrian first)**

```bash
git push -u origin pwa-update-prompt
```

PR title: `feat: offer app updates without losing the game`. Body: what each commit does, the precache contents and size, the test counts, the Review Focus list, and that the first deploy offers the update to players on today's worker at their next cold start.
