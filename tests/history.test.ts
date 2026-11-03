import type { EngineSnapshot } from "../src/engine/snapshot";
import { History, type HistoryEntry } from "../src/game/history";

const snap = (): EngineSnapshot => ({ cols: 1, rows: 1, ropes: [] });
const entry = (moves: number): HistoryEntry => ({ snapshot: snap(), moves });

describe("history", () => {
  it("records a move and steps back to it", () => {
    const h = new History(snap()), a = entry(0), cur = entry(1);
    h.recordMove(a);
    expect(h.stepBack(cur)).toBe(a);
    expect(h.redo).toEqual([cur]);
    expect(h.canUndo()).toBe(false);
  });

  it("steps forward to the state it stepped back from", () => {
    const h = new History(snap()), a = entry(0), cur = entry(1);
    h.recordMove(a);
    const back = h.stepBack(cur)!;
    const a2 = { ...back };
    expect(h.stepForward(a2)).toBe(cur);
    expect(h.undo.at(-1)).toBe(a2);
    expect(h.canRedo()).toBe(false);
  });

  it("clears the redo stack when a move is recorded", () => {
    const h = new History(snap());
    h.recordMove(entry(0));
    h.stepBack(entry(1));
    h.recordMove(entry(0));
    expect(h.canRedo()).toBe(false);
  });

  it("merges a move recorded without a before state", () => {
    const h = new History(snap()), a = entry(0);
    h.recordMove(a);
    h.stepBack(entry(1));
    h.stepForward(entry(0));
    h.recordMove(null);
    expect(h.undo).toHaveLength(1);
    expect(h.canRedo()).toBe(false);
  });

  it("returns null when there is nothing to step to", () => {
    const h = new History(snap());
    expect(h.stepBack(entry(0))).toBeNull();
    expect(h.stepForward(entry(0))).toBeNull();
    expect(h.undo).toEqual([]);
    expect(h.redo).toEqual([]);
  });

  it("clears both stacks but keeps the start", () => {
    const start = snap(), h = new History(start, [entry(0)], [entry(2)]);
    h.clear();
    expect(h.canUndo()).toBe(false);
    expect(h.canRedo()).toBe(false);
    expect(h.start).toBe(start);
  });
});
