# Undo, redo, Start Over and Try Again

## Intent

Players can step back through their moves, step forward again, restart the current board, and replay a solved board. Untangling is trial and error: a move that makes things worse should cost one tap to take back, not a whole new board.

## Behavior (Adrian's decisions)

### Undo

- Undo jumps the board straight back to the saved state from before the last move. Nothing slides back or animates; the earlier board simply replaces the current one. (On 2026-10-05 Adrian found that sliding a dropped rope back along its path looked weird and didn't restore the state.)
- Ropes that cleared as a result of the undone move come back.
- The move counter goes down by one, "like the move never happened". In practice the counter takes the value it had in the restored state.
- Undo can be repeated all the way back to the start of the game as long as the page stays open. All undo states are kept in memory.
- Undo works at any time except while a rope end is held: it stops whatever is still settling and jumps to the earlier board. While an end is held, Undo does nothing.
- If a dropped end is still flying or landing in its hole when Undo is tapped, the undo waits until every end is in a hole (a fraction of a second) and then happens. That moment provides the redo state for the undone move. *(my call)*
- Once the puzzle is solved the game is over. Undo and Redo do nothing, and the solved dialog offers only Try Again and Next.

### Redo

- Redo steps forward again through undone moves, one at a time, restoring the state as it was after each move.
- Making a move after undoing clears everything that could have been redone.
- Like Undo, Redo does nothing while an end is held or once the puzzle is solved.

### After a reload

- The saved game keeps the current state, the start state, up to 10 undo states (the 10 nearest the current position) and up to 10 redo states (the 10 nearest the current position).
- After a reload, Undo can go back at most 10 moves, not all the way to the start. Start Over still works, because the start state is saved.

### Start Over

- Start Over puts the board back to the start state of this game, with the move counter at 0.
- It clears both the undo and redo history, so it cannot be undone. Adrian deliberately skipped making it undoable, to avoid the complexity.
- During an unsolved game, Start Over asks for confirmation before resetting. It never asks once the game is solved. *(The bar button stays usable after a solve and does the same as Try Again.)*

### Try Again

- The solved dialog shows two buttons side by side: **Try again** and **Next**. Try Again restarts the same board from its start state (like Start Over, without confirmation).

### Layout (mockup C + D, chosen by Adrian)

- Undo and Redo are round floating buttons (about 54 px, white, light shadow, icons ↶ and ↷) in the bottom-left and bottom-right corners of the board area.
- Start Over is a text button "Start over" in the top bar, right after "New".
- The solved dialog keeps its text line, with "Try again" and "Next" next to each other below it, neither wrapping.

## Calls I made (Adrian can override)

- **The board reserves space at the bottom** for the floating buttons on short or wide screens, so they never cover a hole or a rope end. *(my call)*
- **Undo and Redo are greyed out** when there is nothing to step to, and disabled while an end is held and after a solve. *(my call)*
- **When an undo state is captured:** at the moment a move starts (the grab that turns into a move), the state recorded is the board as it was at that grab. A snapshot needs every end in a hole. If the player grabs a new end while a previously dropped end is still flying to its hole, there is no such state between the two moves, so the two moves become a single undo step and Undo takes back both. This should be rare, because a dropped end only flies the short way from the finger to the nearest hole. *(my call)*
- **The confirmation for Start Over** is an in-app dialog in the style of the settings dialog ("Start over this board?" with "Start over" and "Cancel"), not the browser's `confirm()`. *(my call)*
- **The clock:** Start Over and Try Again restart the game's play clock, so `puzzle-completed.elapsedMs` measures the latest attempt. *(my call)*
- **Analytics:** `puzzle-completed` is sent on every solve, including solves after Try Again, with a `replay: true` flag once the board has been solved before, so funnels can leave replays out. *(Adrian agreed)* It also gains `undos`, `redos` and `startOvers` counts for the game. `startOvers` counts only the bar's Start Over taps in an unsolved game, not Try Again. The counts survive reloads, so they go in the saved game. A new `game-restarted { ropes, moves, ropesLeft, via: "start-over" | "try-again" }` event is sent on Start Over and Try Again. Undo and redo are not sent as separate events. *(my call, except where marked)*
- **"New" and the rope-count switch** stay as they are, with no confirmation. *(my call: not asked for)*

## Storage

Measured board snapshot sizes as stored JSON: 17 KB (4 ropes) up to 77 KB (10 ropes). The worst case for a 10-rope game is a current state, a start state, 10 undo states and 10 redo states: 22 × 77 KB ≈ 1.7 MB, plus about 0.35 MB for the stock of ready boards.

Chromium allows about 5.2 M characters of localStorage per origin (measured). WebKit's quota is believed to be about 5 MB counted in UTF-16, which would be roughly 2.5 M characters. This is unverified, and Adrian plays on an iPad too. The `/dev/` preview shares the origin, so a second saved game and a second stock can sit in the same quota. The ready-board stock matters more than history: losing it brings back multi-second waits for a new board. So:

- The history states use a compact encoding. Rounding coordinates is the obvious first step: the current JSON writes full double precision. The builder should check that a rounded snapshot restores and settles without visible change.
- The saved-game record is capped at about 1 M characters. History states are dropped to stay under the cap: the redo state furthest ahead first, then the oldest undo state. *(my call)*
- If writing the saved game still fails, drop history states in the same order and retry until the write succeeds. The current state and the start state are never dropped for history's sake. A failed history write must never cost the player the game.

## Saved-game compatibility

Saved games from the current format (`GAME_VERSION` 1: current state only) must still load. Per AGENTS.md, losing a real saved game is worse than missing features. A version-1 save loads with empty undo and redo history and no start state. Start Over and Try Again are then unavailable for that one game: the button is greyed out, and the solved dialog shows only Next. *(my call)*

## Existing behavior that constrains the design

- The game is saved only when every rope end is in a hole (`Engine.endsSeated()`), after each drop or clear and once at rest (`GameSaver.tick`). Snapshots (`toSnapshot`) throw if an end is out of its hole.
- Restoring builds a fresh engine from a snapshot (`fromSnapshot`) and a new `Session` that starts settling (`restoreGame`). Undo, Redo and Start Over can reuse that path.
- Rope colors come from the seed, and snapshots keep rope ids, so colors survive restores.

## Non-goals

- Making Start Over undoable, or letting Redo step forward after Start Over.
- Undo after the puzzle is solved.
- Keeping undo history for games other than the current one.
- Animating undo or redo.

## Left to the builder

- Where the history lives (inside `Session`, in a separate history object, or in `GameSaver`), and the saved-game record layout for version 2.
- The exact compact encoding, as long as it restores faithfully.
- Button styling details beyond the mockup, and how the bottom space is reserved.
- Test coverage: unit tests for history rules (redo cleared by a new move, the 10/10 storage cap, the size cap, quota fallback, version-1 load), and an e2e test for undo, redo, Start Over with confirmation, and Try Again.
