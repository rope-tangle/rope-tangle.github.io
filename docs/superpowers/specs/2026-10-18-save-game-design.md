# Saving the game and stocking ready boards — design spec

Date: 2026-10-18
Status: draft for Adrian's review

## 1. Goal

Closing or reloading the page never loses a game in progress, and a new board appears instantly: on the first board of a visit (including the very first visit), after "New"/"Next", and after changing the rope count.

## 2. Decisions

- One current game. Changing the rope count replaces it, as today; there are no per-size saved games.
- A ready board of every size (4–10 ropes) is kept in localStorage. Starting a game uses up only that size's board, so only that one is regenerated.
- The repo ships one pre-built board per size; they fill the stock wherever it is empty, so even a first-ever visit has every size ready.
- The game is saved only at rest. Closing the page mid-drag or mid-flight resumes the board as it was before that move.
- A solved game is not resumed; a reload after a win starts the next board.
- Saves are keyed by base path, so the `/dev/` preview never touches the live game's saves. Settings stay shared.
- A resumed game is invisible to analytics except for one `game-resumed` event; its clock and move count carry over, so `puzzle-completed` and the `replaced*` fields stay correct across visits. No "abandoned" event.
- Records carry a format version. Unreadable records are deleted and treated as missing, never repaired.
- The PWA update prompt is out of scope; it follows as its own PR once saving has shipped.

## 3. Snapshots keep rope ids

The engine never renumbers ropes: a rope's id is its index in `engine.ropes`, and a cleared rope stays there with `cleared = true`. Only `toSnapshot` drops cleared ropes, and `fromSnapshot` then renumbers the rest, which shifts colors (`colors[id % colors.length]`).

`toSnapshot` therefore exports every rope, a cleared one as a placeholder with `cleared: true` and no points; `fromSnapshot` restores each rope under its original id, placeholders as cleared ropes without points. Colors then follow from the seed via `shuffledColors(seed)`, so saves need no color list. The only reader of cleared ropes, the fade drawing in `scene.ts`, has nothing to fade after a resume.

## 4. Storage

localStorage, plain JSON at full precision, one key per record. Measured sizes: 23–25 KB (5 ropes), 40–53 KB (8), 61–79 KB (10); 7 ready boards plus one game stay under about 0.6 MB. Plain JSON is lossless, so a resumed or stocked board behaves exactly like the original (fresh boards still carry velocities up to 2.4 px per step, so dropping them would not be exact). Reads are synchronous, so a stocked board can be shown before the generator worker exists.

Keys, with `<base>` from `import.meta.env.BASE_URL` (`/` live, `/dev/` preview):

- `rope-tangle<base>game` — the current unfinished game: `{ v, ropes, seed, moves, playedMs, snapshot }`. `playedMs` is the active (paused-while-hidden) solve time so far.
- `rope-tangle<base>ready/<n>` for n = 4…10 — a ready board: `{ v, ropes, seed, generationMs, tries, bundled, snapshot }`.
- `rope-tangle/settings` — unchanged.

`v` is 1. A record is rejected and deleted if its JSON doesn't parse, `v` differs, a number isn't finite, a point list's length isn't a multiple of 6, a rope end names a hole the board doesn't have, `ropes` doesn't match the snapshot (or, for a ready board, its key), or the board size doesn't match `boardForRopes(ropes)`.

A refused write (quota, private mode) is ignored; the game carries on unsaved, as settings do. Two open tabs share the keys; the last write wins.

Debug dumps from failed generation tries go to the in-memory dump list when the board is generated and are not stored.

## 5. Ready-board stock and the generator

`BoardSource`'s single prefetch slot is replaced by a stock: a size → ready board map mirroring the `ready/<n>` records, loaded at startup. Its watchdog, timeout, crash and superseded handling stay as they are.

- `next(ropes)`: a stocked board is removed from the map and from storage and returned at once (`prefetched: true`). Otherwise it is generated as today and the player waits.
- Filling: one generator job at a time on the single worker, only for missing sizes. Order: the current size first, then the others by distance from it, smaller first on a tie (playing 8: 8, 7, 9, 6, 10, 5, 4). The order is recomputed after each job and whenever the current size changes. Each finished board is written to storage at once.
- A request for a size that isn't stocked: if the running job is that size, it waits for it; otherwise the running background job is superseded (worker terminated, as today), the requested size is generated, and filling resumes.
- Failures: the 30 s watchdog applies to every job. A failed background job sends `prefetch-failed` and filling moves on; the failed size comes up again after the next game start.
- Filling starts once the first board is on screen.

## 6. Bundled boards

The repo holds one pre-generated ready board per size (`src/game/bundled/<n>.json`, ready-board format with `bundled: true`), produced by a script (`npm run bundled-boards`) from fixed seeds. They are loaded lazily with `import.meta.glob`, so they are separate hashed chunks under `assets/` that the service worker already caches, and are not part of the main bundle.

At startup, before the first board is picked, every size missing from the stock is filled from its bundled board and written to storage like any other ready board. After that a bundled board is an ordinary stock entry: when it is taken, its replacement is generated. All first-time visitors get the same boards; this is accepted.

When the first board needs a bundled one, it waits for that chunk (about 25 KB for 5 ropes); the other sizes load alongside. Resuming a saved game never waits for bundled chunks.

The committed boards must be regenerated whenever the record format or the board layout changes. A unit test decodes every bundled board with the production validator, so a stale file fails CI. Regenerating them is not checked for reproducibility, because floating-point results differ between Node versions.

## 7. Saving and resuming the game

At startup, after settings, stock and bundled boards:

- If a readable saved game exists, it is resumed: engine from the snapshot, `Session` with its move count, colors from the seed, game start time = `played.now() - playedMs`. The rope selector shows the game's size, and that becomes the setting (they only differ when two tabs disagree). `game-resumed` is sent, then filling starts.
- Otherwise `load("first-load")` runs as today, now taking from the stock.

The game is written:

- when a new board begins, because its ready board has just left the stock and a reload must not use up another one;
- each time the session comes to rest: a released end has landed, the ropes have settled and no clearing is pending (phase changes to `idle`);
- on `visibilitychange` to hidden and on `pagehide`, if the session is at rest (this keeps `playedMs` current; otherwise nothing is written).

The save is deleted when the puzzle is solved.

When a game is replaced, the old save stays until the new board begins, so a reload during "Scrambling…" or after `new-game-failed` resumes the old game; no `new-game-started` was sent, so analytics stay consistent.

In test mode the `board=easy` board is never saved and nothing is resumed; other `?test` runs save and resume normally.

Each save serializes up to about 80 KB of JSON on the main thread. PR 4 measures `stringify` + `setItem` for a 10-rope board on the Mac mini; above about 2 ms, the write is moved out of the frame the session comes to rest in.

## 8. Analytics

- New event `game-resumed`: `{ ropes, moves, ropesLeft, elapsedMs }`.
- `new-game-started`: `prefetched` keeps today's meaning, a board made in the background before the player asked for it: either from the stock, or a background job the player then waited for (`waitMs` tells the two apart). New field `bundled` is true when the board was a bundled one.
- `puzzle-completed.elapsedMs` and the `replaced*` fields use the carried-over clock and move count.
- `trigger: "first-load"` is sent only when no game was resumed.

## 9. PRs and testing

1. **Snapshots keep rope ids.** Unit: clear a rope, snapshot, restore; ids and colors unchanged, cleared placeholders restored as cleared, fade drawing skips them.
2. **Stock.** Storage records, keys, stocked ready boards, filling. Unit: record round trip; each rejection case from §4 deletes the record; keys follow the base path; `BoardSource` with a fake worker: takes from stock, fill order, storage writes, superseding, failure moves on, stock survives into a new instance. E2E: a second visit's first board comes from the stock.
3. **Bundled boards.** Script, committed boards, startup fill. Unit: every bundled board passes the validator and matches its size. E2E: a fresh visit's first board is bundled and appears without the generator.
4. **Saving the game.** Save/resume and `game-resumed`. Unit: when the session reaches rest; clock and move count restored. E2E: make a move, reload, same ends and move count; solve, reload, a fresh board appears.
