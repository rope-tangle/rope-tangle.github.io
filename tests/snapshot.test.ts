import { fromSnapshot, snapshotTransfer, toSnapshot } from "../src/engine/snapshot";
import type { Engine } from "../src/engine/engine";
import { generateBoard } from "../src/generate/generate";

const state = (E: Engine) => E.ropes.map((r) => r.pts.map((p) => [p.x, p.y, p.z, p.px, p.py, p.pz]));

describe("engine snapshots", () => {
  it("round-trips a realized board and keeps simulating identically", () => {
    const E = generateBoard(1, 4).engine;
    const s = toSnapshot(E);
    const F = fromSnapshot(s);
    expect(F.board).toEqual(E.board);
    expect(F.ropes.map((r) => r.ends)).toEqual(E.ropes.map((r) => r.ends));
    expect(state(F)).toEqual(state(E));
    for (let i = 0; i < 50; i++) {
      E.substep(null);
      F.substep(null);
    }
    expect(state(F)).toEqual(state(E));
  });

  it("lists one transferable buffer per rope", () => {
    const s = toSnapshot(generateBoard(2, 4).engine);
    expect(snapshotTransfer(s)).toHaveLength(4);
    const first = s.ropes[0]!;
    expect("pts" in first && first.pts.length % 6).toBe(0);
  });

  it("keeps the ids of the remaining ropes after some have cleared", () => {
    const E = generateBoard(3, 5).engine;
    E.ropes[1]!.cleared = true;
    E.ropes[3]!.cleared = true;
    const s = toSnapshot(E);
    expect(s.ropes[1]).toEqual({ cleared: true });
    const F = fromSnapshot(s);
    expect(F.ropes.map((r) => r.cleared)).toEqual([false, true, false, true, false]);
    expect(F.active().map((r) => r.id)).toEqual([0, 2, 4]);
    expect(F.active().map((r) => r.ends)).toEqual(E.active().map((r) => r.ends));
    const live = (G: Engine) => G.active().map((r) => r.pts.map((p) => [p.x, p.y, p.z, p.px, p.py, p.pz]));
    expect(live(F)).toEqual(live(E));
    for (let i = 0; i < 50; i++) {
      E.substep(null);
      F.substep(null);
    }
    expect(live(F)).toEqual(live(E));
  });

  it("transfers no buffer for a cleared rope", () => {
    const E = generateBoard(2, 4).engine;
    E.ropes[0]!.cleared = true;
    expect(snapshotTransfer(toSnapshot(E))).toHaveLength(3);
  });

  it("refuses an engine with an end out of its hole", () => {
    const E = generateBoard(1, 4).engine;
    E.grab(0, 0);
    expect(() => toSnapshot(E)).toThrow();
  });
});
