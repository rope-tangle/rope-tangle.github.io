import type { Engine } from "../src/engine/engine";
import { easyBoard } from "../src/game/easy";
import { GRAB_RADIUS, Session } from "../src/game/session";
import { History } from "../src/game/history";
import type { Point } from "../src/util/point";

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

function move(s: Session, from: Point, to: Point): void {
  expect(s.grab(from)).toBe(true);
  s.drag(to);
  s.release();
}

const ends = (s: Session) => s.engine.ropes.map((r) => [...r.ends]);

const STILLNESS: keyof Engine = "drift";
const pinStill = (s: Session) => Object.defineProperty(s.engine, STILLNESS, { get: () => 0, set: () => {} });

describe("session undo, redo and start over", () => {
  it("undoes a move back to the board before it", () => {
    const s = new Session(easyBoard());
    move(s, { x: 192, y: 256 }, { x: 128, y: 256 });
    runUntilIdle(s);
    expect(s.undo()).toBe(true);
    expect(s.moves).toBe(0);
    expect(s.engine.ropes[0]!.ends[1]).toBe(holeAt(s, 192, 256));
    expect(s.canRedo()).toBe(true);
    expect(s.undos).toBe(1);
  });

  it("redoes an undone move", () => {
    const s = new Session(easyBoard());
    move(s, { x: 192, y: 256 }, { x: 128, y: 256 });
    runUntilIdle(s);
    s.undo();
    runUntilIdle(s);
    expect(s.redo()).toBe(true);
    expect(s.moves).toBe(1);
    expect(s.engine.ropes[0]!.ends[1]).toBe(holeAt(s, 128, 256));
    expect(s.redos).toBe(1);
    expect(s.canRedo()).toBe(false);
  });

  it("clears redo after a new move", () => {
    const s = new Session(easyBoard());
    move(s, { x: 192, y: 256 }, { x: 128, y: 256 });
    runUntilIdle(s);
    s.undo();
    runUntilIdle(s);
    move(s, { x: 192, y: 256 }, { x: 64, y: 256 });
    expect(s.canRedo()).toBe(false);
  });

  it("does nothing while an end is held", () => {
    const s = new Session(easyBoard());
    move(s, { x: 192, y: 256 }, { x: 128, y: 256 });
    runUntilIdle(s);
    expect(s.grab({ x: 192, y: 0 })).toBe(true);
    expect(s.undo()).toBe(false);
    expect(s.redo()).toBe(false);
    expect(s.startOver()).toBeNull();
    expect(s.canUndo()).toBe(false);
    expect(s.canStartOver()).toBe(false);
    expect(s.moves).toBe(1);
  });

  it("queues an undo tapped while the dropped end is in flight", () => {
    const s = new Session(easyBoard());
    move(s, { x: 192, y: 256 }, { x: 128, y: 256 });
    expect(s.engine.flying).toHaveLength(1);
    expect(s.undo()).toBe(true);
    expect(s.queued).toBe("undo");
    expect(s.moves).toBe(1);
    runUntilIdle(s);
    expect(s.queued).toBeNull();
    expect(s.moves).toBe(0);
    expect(s.engine.ropes[0]!.ends[1]).toBe(holeAt(s, 192, 256));
    expect(s.redo()).toBe(true);
    expect(s.moves).toBe(1);
    expect(s.engine.ropes[0]!.ends[1]).toBe(holeAt(s, 128, 256));
  });

  it("refuses a grab while an undo is queued", () => {
    const s = new Session(easyBoard());
    move(s, { x: 192, y: 256 }, { x: 128, y: 256 });
    s.undo();
    expect(s.grab({ x: 192, y: 0 })).toBe(false);
  });

  it("merges a move grabbed before the previous end landed", () => {
    const s = new Session(easyBoard());
    move(s, { x: 192, y: 256 }, { x: 128, y: 256 });
    expect(s.engine.flying).toHaveLength(1);
    move(s, { x: 192, y: 0 }, { x: 128, y: 0 });
    runUntilIdle(s);
    expect(s.moves).toBe(2);
    expect(s.undo()).toBe(true);
    expect(s.moves).toBe(0);
    expect(s.canUndo()).toBe(false);
  });

  it("ignores undo and redo once solved", () => {
    const s = new Session(easyBoard());
    move(s, { x: 192, y: 256 }, { x: 64, y: 0 });
    runUntilIdle(s);
    expect(s.won).toBe(true);
    expect(s.canUndo()).toBe(false);
    expect(s.undo()).toBe(false);
    expect(s.redo()).toBe(false);
    expect(s.moves).toBe(1);
  });

  it("solves on the frame the winning end lands when the board is already still", () => {
    const s = new Session(easyBoard());
    pinStill(s);
    move(s, { x: 192, y: 256 }, { x: 64, y: 0 });
    for (let frame = 0; frame < 3000 && !s.engine.endsSeated(); frame++) s.step(still, 1e9);
    expect(s.engine.endsSeated()).toBe(true);
    expect(s.won).toBe(true);
  });

  it("carries out an undo tapped during the winning move instead of the solve", () => {
    const s = new Session(easyBoard());
    pinStill(s);
    move(s, { x: 192, y: 256 }, { x: 64, y: 0 });
    expect(s.undo()).toBe(true);
    runUntilIdle(s);
    expect(s.won).toBe(false);
    expect(s.moves).toBe(0);
    expect(s.undos).toBe(1);
    expect(s.canRedo()).toBe(true);
  });

  it("starts over from the start state", () => {
    const s = new Session(easyBoard()), initial = ends(s);
    move(s, { x: 192, y: 256 }, { x: 128, y: 256 });
    runUntilIdle(s);
    move(s, { x: 128, y: 256 }, { x: 64, y: 256 });
    runUntilIdle(s);
    expect(s.startOver()).toBe("start-over");
    expect(s.moves).toBe(0);
    expect(s.history.undo).toEqual([]);
    expect(s.history.redo).toEqual([]);
    expect(ends(s)).toEqual(initial);
    expect(s.startOvers).toBe(1);
    expect(s.replay).toBe(false);
  });

  it("tries again after a solve", () => {
    const s = new Session(easyBoard());
    move(s, { x: 192, y: 256 }, { x: 64, y: 0 });
    runUntilIdle(s);
    expect(s.canStartOver()).toBe(true);
    expect(s.startOver()).toBe("try-again");
    expect(s.won).toBe(false);
    expect(s.replay).toBe(true);
    expect(s.startOvers).toBe(0);
    expect(s.engine.active()).toHaveLength(2);
    expect(s.fades.size).toBe(0);
  });

  it("cannot start over without a start state", () => {
    const s = new Session(easyBoard(), new History(null));
    expect(s.canStartOver()).toBe(false);
    expect(s.startOver()).toBeNull();
  });

  it("refuses a second undo when only one entry remains", () => {
    const s = new Session(easyBoard());
    move(s, { x: 192, y: 256 }, { x: 128, y: 256 });
    runUntilIdle(s);
    expect(s.undo()).toBe(true);
    expect(s.undo()).toBe(false);
    expect(s.moves).toBe(0);
    expect(s.undos).toBe(1);
  });
});
