# PWA update prompt — design spec

Date: 2026-10-25
Status: draft for Adrian's review

## 1. Goal

Players get the latest version of the game regularly, even if they never reload it: an installed app kept in memory on a phone picks up each deploy without losing the game in progress. Updating the service worker is not a goal in itself, only the means. The mechanism is modeled on Puzzlewise's service worker and update prompt.

## 2. Decisions

- Puzzlewise's stack: `vite-plugin-pwa` with `strategies: 'injectManifest'` and `registerType: 'prompt'`, a small custom worker, and a port of its update controller.
- An update is applied on a tap of an "Update ready" button, or automatically on the next return to the foreground while one is pending, as in Puzzlewise.
- Applying waits until every rope end is seated and the game is saved, then reloads. New grabs are refused while it waits.
- The button sits in the top bar, never over the board.
- Analytics: the update funnel and the registration failure, as in Puzzlewise. The worker's own error reporting (Puzzlewise #430) is not ported.
- Like Puzzlewise, a cold start opens the cached build and then offers the update. Today a cold start online loads the newest build from the network.

## 3. The service worker

`src/pwa/sw.ts`, bundled by `vite-plugin-pwa`; `self.__WB_MANIFEST` is injected at build time.

- `cleanupOutdatedCaches()` and `precacheAndRoute(self.__WB_MANIFEST)`.
- A `NavigationRoute` serving the precached `index.html`, with an allowlist matching only the base followed by an optional query (Puzzlewise's `appNavigationAllowlist(base)`), so `?test`, `?seed=` and friends load offline.
- A `message` handler that calls `skipWaiting()` on `{ type: "SKIP_WAITING" }`. The worker never activates itself, so the first deploy of this worker is also offered through the button to players still running today's `public/sw.js`.
- On `activate`, caches named `rope-tangle-*` (today's `rope-tangle-v1`) are deleted. Workbox's caches have other names.

Precache: `index.html`, all JS chunks (main, board worker, settle, the seven bundled `ready-*.js`), the icons and `manifest.webmanifest`, about 400 KB raw. `debug/index.html` and `debug-*.js` are excluded with `globIgnores`, so the debug page always comes from the network.

Other paths stay network-only:

- `/spike/` is copied into `dist` after the build, so it is never in the manifest.
- `/dev/` previews register their own worker at `/dev/sw.js` with scope `/dev/`. The browser picks the registration with the longest matching scope, and the root worker's routes only match root-build URLs.
- `/debug/` is excluded from the precache and from the navigation allowlist.

`public/manifest.webmanifest` stays as is; the plugin runs with `manifest: false`.

Every deploy bakes `VITE_APP_VERSION` (`#<run number>`) into the main chunk, so each deploy of main yields a new `sw.js` and one update, as in Puzzlewise. Nothing changes the worker without a deploy.

`tsconfig.sw.json` type-checks `sw.ts` with the WebWorker lib (as in Puzzlewise); `sw.ts` is excluded from the main `tsconfig.json`. `npm run build` checks both.

Removed: `public/sw.js`, and in `main.ts` the registration with its `PerformanceObserver` → `cacheUrls` message (precaching makes it unnecessary).

## 4. Detecting and applying updates

### 4.1 Update controller

`src/pwa/update-controller.ts` ports Puzzlewise's `createUpdateController` and `setupUpdateChecks`. Every side effect is injected, so the logic is unit-tested without a browser.

- Checks: on page load (registering the worker checks) and on every `visibilitychange` → visible (`registration.update()`). No timer.
- `onNeedRefresh`: marks the update pending (once), sends `pwa-update-detected` and shows the button.
- Apply triggers: a tap on the button (`manual`), or `visibilitychange` → visible while pending (`focus-regain`).
- Applying latches on the first trigger; later triggers do nothing. A trigger that arrives before `registerSW` has returned `updateSW` is buffered with its original trigger and applied once it is set.
- Applying: send `pwa-update-applied { trigger }`, await `prepareReload()`, call `updateSW(true)` and schedule a fallback reload after 3 s. A rejection from `updateSW(true)` sends `pwa-update-apply-failed { reason }`; the fallback still runs. The fallback sends `pwa-update-fallback-reload` and calls `location.reload()`.
- A failing `registration.update()` sends `pwa-update-check-failed { reason }`, each distinct reason at most once per session and at most 5 reasons.

The one deliberate difference from Puzzlewise: its synchronous `flush()` becomes an async `prepareReload(): Promise<void>` supplied by the game.

### 4.2 Preparing the game for a reload

`prepareReload()` in `app.ts`:

- From the moment it is called, new grabs are refused.
- It resolves on the first frame where every rope end is seated (`engine.endsSeated()`), right after saving the game.
- With no game (a board is still being made) or a solved game, it resolves at once.
- An end held when it is called stays held until the player lets go (on phones, going to the background usually cancels the pointer, which releases it). The reload then follows once that end has landed.

### 4.3 Registration

`src/pwa/register.ts` is the glue over `registerSW` from `virtual:pwa-register`: `onNeedRefresh` → controller, `onRegisteredSW` → `setupUpdateChecks`, `onRegisterError` → `pwa-register-failed`. It runs only in production builds, like today's registration. It is not imported by unit tests, since the virtual module only exists at build time.

### 4.4 The button

`<button id="update" hidden>Update ready</button>` in `#bar`, after ⚙︎, styled like the other bar buttons. It is shown when an update is pending, and a tap applies the update. The label is shorter than Puzzlewise's "Update ready — tap to refresh" so the bar still fits a narrow phone.

### 4.5 Analytics

Added to `Events` in `src/analytics/umami.ts`, with Puzzlewise's shapes:

| Event | Data |
|---|---|
| `pwa-update-detected` | `{}` |
| `pwa-update-applied` | `{ trigger: "manual" \| "focus-regain" }` |
| `pwa-update-apply-failed` | `{ reason }` |
| `pwa-update-fallback-reload` | `{}` |
| `pwa-update-check-failed` | `{ reason }` |
| `pwa-register-failed` | `{ reason, valueType, name, registerFunction, displayMode, visibilityState }` |

`reason` goes through the existing `sanitizeReason` (`src/analytics/errors.ts`). `describeValueType` and `errorName` are ported from Puzzlewise for `pwa-register-failed`. Puzzlewise's `share-link-rescue` trigger has no counterpart.

## 5. Error handling

Nothing here blocks play.

- Registration fails: `pwa-register-failed`; the game runs without updates for that session.
- An update check fails: `pwa-update-check-failed`; the next return to the foreground checks again.
- Activation fails or never takes over: `pwa-update-apply-failed` where it rejects, then the hard reload after 3 s.

## 6. Testing

Unit (vitest):

- Update controller and checks, ported from Puzzlewise's `update-controller.test.ts` and adapted to the async `prepareReload`, plus: applying waits for `prepareReload` before calling `updateSW`, and a second trigger while waiting does nothing.
- Navigation allowlist, register-failure description.
- `prepareReload()`: resolves at once without a game, waits through a landing, refuses grabs while waiting, saves before resolving.

E2E (Playwright), against a real update:

- The `webServer` builds the app twice into separate directories, with `VITE_APP_VERSION` A and B. A small static server, `e2e/serve.mjs`, replaces `vite preview`: it serves build A until a test switches it to B through a control request, and back to A for the next test.
- Applying by tap: load A, make a move, switch to B, fire `visibilitychange`; `#update` becomes visible. Tapping it reloads into B (the deploy label reads B), and the move is still there.
- Applying on return to the foreground: with an update pending, release an end and fire hide → show while it is in flight. The reload happens only after the end has landed, and the move survives.
- Today's offline tests stay; "plays offline after one visit" now passes through precaching.

## 7. PR shape

One PR with two commits, each building and working on its own:

1. Precache the app with a Workbox worker that still activates at once (today's behavior: `skipWaiting` on install, `clients.claim` on activate). Removes `public/sw.js` and the `cacheUrls` workaround.
2. Switch to prompt mode and add the update controller, the button, `prepareReload` and the analytics.
