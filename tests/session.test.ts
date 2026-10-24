import { easyBoard } from "../src/game/easy";
import { GRAB_RADIUS, Session } from "../src/game/session";

const still = { now: () => 0 };

function holeAt(s: Session, x: number, y: number): number {
  const i = s.engine.board.holes.findIndex((h) => h.x === x && h.y === y);
  if (i < 0) throw new Error(`no hole at ${x},${y}`);
  return i;
}

function runUntilIdle(s: Session): void {
  for (let frame = 0; frame < 3000 && s.phase !== "idle"; frame++) s.step(still, 1e9);
  expect(s.phase).toBe("idle");
}

describe("session", () => {
  it("grabs the nearest end within reach and nothing farther", () => {
    const s = new Session(easyBoard());
    expect(s.grab({ x: 96, y: 128 })).toBe(false);
    expect(s.grab({ x: GRAB_RADIUS - 2, y: 0 })).toBe(true);
    expect(s.phase).toBe("held");
    expect(s.engine.held).toMatchObject({ rope: 0, end: 0 });
    expect(s.grab({ x: 192, y: 0 })).toBe(false);
  });

  it("counts a move when the end lands in another hole", () => {
    const s = new Session(easyBoard());
    s.grab({ x: 192, y: 256 });
    s.drag({ x: 128, y: 256 });
    s.release();
    expect(s.moves).toBe(1);
    runUntilIdle(s);
    expect(s.engine.ropes[0]!.ends[1]).toBe(holeAt(s, 128, 256));
  });

  it("does not count a move when the end goes back to its own hole", () => {
    const s = new Session(easyBoard());
    s.grab({ x: 192, y: 256 });
    s.drag({ x: 188, y: 250 });
    s.release();
    expect(s.moves).toBe(0);
    runUntilIdle(s);
    expect(s.engine.ropes[0]!.ends[1]).toBe(holeAt(s, 192, 256));
  });

  it("drops an end released between holes into the nearest free hole", () => {
    const s = new Session(easyBoard());
    s.grab({ x: 192, y: 256 });
    s.drag({ x: 150, y: 250 });
    expect(s.targetHole()).toBe(holeAt(s, 128, 256));
    s.release();
    runUntilIdle(s);
    expect(s.engine.ropes[0]!.ends[1]).toBe(holeAt(s, 128, 256));
  });

  it("keeps the pointer on the board", () => {
    const s = new Session(easyBoard());
    s.grab({ x: 192, y: 256 });
    s.drag({ x: 500, y: -40 });
    expect(s.pointer).toEqual({ x: 192, y: 0 });
  });

  it("lets another rope be grabbed while a released end is still flying, but not the flying rope", () => {
    const s = new Session(easyBoard());
    s.grab({ x: 192, y: 256 });
    s.drag({ x: 64, y: 0 });
    s.release();
    expect(s.engine.flying).toHaveLength(1);
    expect(s.grab({ x: 0, y: 0 })).toBe(false);
    expect(s.grab({ x: 192, y: 0 })).toBe(true);
    expect(s.engine.held).toMatchObject({ rope: 1, end: 0 });
  });

  it("clears ropes that cross nothing, fades them and wins when none remain", () => {
    const s = new Session(easyBoard());
    s.grab({ x: 192, y: 256 });
    s.drag({ x: 64, y: 0 });
    s.release();
    runUntilIdle(s);
    expect(s.won).toBe(true);
    expect(s.engine.active()).toHaveLength(0);
    expect(s.fades.get(0)).toBeGreaterThan(0);
    expect(s.animating()).toBe(true);
    for (let i = 0; i < 25; i++) s.step(still, 1e9);
    expect(s.fades.get(0)).toBe(0);
    expect(s.animating()).toBe(false);
  });

  it("bumps its revision on each drop and each clear", () => {
    const s = new Session(easyBoard());
    s.grab({ x: 192, y: 256 });
    s.drag({ x: 64, y: 0 });
    s.release();
    expect(s.revision).toBe(1);
    runUntilIdle(s);
    expect(s.engine.active()).toHaveLength(0);
    expect(s.revision).toBe(2);
  });

  it("always runs two substeps a frame, then respects the time budget", () => {
    const s = new Session(easyBoard());
    s.grab({ x: 192, y: 256 });
    s.drag({ x: 128, y: 256 });
    s.release();
    let t = 0;
    const slow = { now: () => (t += 100) };
    expect(s.step(slow, 8)).toBe(2);
  });

  it("does nothing while idle", () => {
    const s = new Session(easyBoard());
    expect(s.step(still, 1e9)).toBe(0);
  });
});
