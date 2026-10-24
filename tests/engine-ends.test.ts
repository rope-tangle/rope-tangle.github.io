import { rimBoard, type Board } from "../src/board";
import { CLEARANCE, HOLD_RADIUS, HOLD_STEP_MAX, LIFT, LIFT_STEP, POST_R, STEP } from "../src/engine/constants";
import { Engine } from "../src/engine/engine";
import { scriptedMove } from "../src/engine/script";
import { settle } from "../src/engine/settle";
import type { P3 } from "../src/engine/types";

function holeAt(board: Board, x: number, y: number): number {
  const i = board.holes.findIndex((h) => h.x === x && h.y === y);
  if (i < 0) throw new Error(`no hole at ${x},${y}`);
  return i;
}

describe("ends", () => {
  it("lifts a held end before moving it sideways", () => {
    const board = rimBoard(4, 5), E = new Engine(board);
    E.straightRope(holeAt(board, 64, 0), holeAt(board, 128, 0));
    E.grab(0, 0);
    const target = { x: 96, y: 128 };
    for (let i = 0; i < 4; i++) E.substep(target);
    const p = E.endPoint(0, 0);
    expect(p.x).toBe(64);
    expect(p.y).toBe(0);
    expect(p.z).toBeCloseTo(36);
    E.substep(target);
    expect(E.held?.lifted).toBe(true);
    expect(p.z).toBeCloseTo(LIFT);
    expect(Math.hypot(p.x - 64, p.y)).toBeCloseTo(HOLD_STEP_MAX);
  });

  it("carries a held end across the board in a few dozen substeps and stops on the target", () => {
    const board = rimBoard(4, 5), E = new Engine(board);
    E.straightRope(holeAt(board, 0, 0), holeAt(board, 64, 0));
    E.grab(0, 0);
    const target = { x: 192, y: 256 }, p = E.endPoint(0, 0);
    let n = 0;
    while (n < 200 && !(E.held?.lifted && Math.hypot(p.x - target.x, p.y - target.y) < 1e-6)) {
      const x = p.x, y = p.y;
      E.substep(target);
      expect(Math.hypot(p.x - x, p.y - y)).toBeLessThanOrEqual(HOLD_STEP_MAX + 1e-9);
      n++;
    }
    expect(n).toBeLessThan(45);
    expect(p.x).toBeCloseTo(target.x);
    expect(p.y).toBeCloseTo(target.y);
  });

  it("moves a held end at the slow step while it climbs over a rope ahead", () => {
    const board = rimBoard(4, 5), E = new Engine(board);
    E.straightRope(holeAt(board, 0, 0), holeAt(board, 64, 0));
    const pts: P3[] = [];
    for (let i = 0; i <= 40; i++) pts.push({ x: 192 * (i / 40), y: 128, z: 200 * Math.sin(Math.PI * (i / 40)) });
    E.addRope(pts, [holeAt(board, 0, 128), holeAt(board, 192, 128)]);
    E.grab(0, 0);
    const target = { x: 96, y: 256 }, p = E.endPoint(0, 0), reach = HOLD_RADIUS + HOLD_STEP_MAX;
    let climbing = 0;
    for (let n = 0; n < 200; n++) {
      const x = p.x, y = p.y, lifted = E.held?.lifted;
      const below = E.ropes[1]!.pts.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < reach && q.z + CLEARANCE > p.z + LIFT_STEP);
      E.substep(target);
      if (lifted && below) {
        climbing++;
        expect(Math.hypot(p.x - x, p.y - y)).toBeLessThanOrEqual(STEP + 1e-9);
      }
    }
    expect(climbing).toBeGreaterThan(0);
  });

  it("lands a moved end in its new hole at rest height", () => {
    const board = rimBoard(4, 5), E = new Engine(board);
    E.straightRope(holeAt(board, 64, 0), holeAt(board, 128, 0));
    const to = holeAt(board, 192, 128);
    scriptedMove(E, 0, 0, to);
    expect(E.ropes[0]!.ends[0]).toBe(to);
    expect(E.endPoint(0, 0)).toMatchObject({ x: 192, y: 128, z: 0 });
    expect(E.held).toBeNull();
    expect(E.busy()).toBe(false);
  });

  it("lets a released end fly home while another end is held", () => {
    const board = rimBoard(4, 5), E = new Engine(board);
    E.straightRope(holeAt(board, 64, 0), holeAt(board, 128, 0));
    E.straightRope(holeAt(board, 64, 256), holeAt(board, 128, 256));
    const to = holeAt(board, 192, 128);
    E.grab(0, 0);
    E.release([{ x: 96, y: 128 }, { x: 192, y: 128 }], to);
    expect(E.busyRopes()).toEqual(new Set([0]));
    E.grab(1, 1);
    const hold = { x: 128, y: 256 };
    for (let guard = 0; E.busy() && guard < 5000; guard++) E.substep(hold);
    expect(E.busy()).toBe(false);
    expect(E.ropes[0]!.ends[0]).toBe(to);
    expect(E.held).toMatchObject({ rope: 1, end: 1 });
  });

  it("seats every end only once nothing is held, flying or landing", () => {
    const board = rimBoard(4, 5), E = new Engine(board);
    E.straightRope(holeAt(board, 64, 0), holeAt(board, 128, 0));
    expect(E.endsSeated()).toBe(true);
    E.grab(0, 0);
    expect(E.endsSeated()).toBe(false);
    E.release([{ x: 192, y: 128 }], holeAt(board, 192, 128));
    expect(E.endsSeated()).toBe(false);
    while (E.flying.length > 0) E.substep(null);
    expect(E.endsSeated()).toBe(false);
    for (let guard = 0; E.busy() && guard < 5000; guard++) E.substep(null);
    expect(E.endsSeated()).toBe(true);
  });
});

describe("pegs", () => {
  it("keeps a rope on the board side of another rope's pegs", () => {
    const board = rimBoard(5, 6), E = new Engine(board);
    E.straightRope(holeAt(board, 0, 128), holeAt(board, 0, 192));
    const pts: P3[] = [];
    for (let i = 0; i <= 24; i++) pts.push({ x: 0, y: 64 + 8 * i, z: i === 0 || i === 24 ? 0 : 20 });
    E.addRope(pts, [holeAt(board, 0, 64), holeAt(board, 0, 256)]);
    settle(E);
    for (const p of E.ropes[1]!.pts) if (p.y >= 128 && p.y <= 192) expect(p.x).toBeGreaterThan(POST_R - 3);
    expect([...E.signature().values()].flat()).toHaveLength(0);
  });
});

describe("clearing", () => {
  it("clears a rope that has crossed nothing for the required streak", () => {
    const board = rimBoard(4, 5), E = new Engine(board);
    E.straightRope(holeAt(board, 0, 64), holeAt(board, 192, 64));
    expect(E.clearFree(3)).toEqual([]);
    expect(E.clearFree(3)).toEqual([]);
    expect(E.clearFree(3)).toEqual([0]);
    expect(E.active()).toHaveLength(0);
  });

  it("does not clear a rope while one of its ends is held", () => {
    const board = rimBoard(4, 5), E = new Engine(board);
    E.straightRope(holeAt(board, 0, 64), holeAt(board, 192, 64));
    E.grab(0, 1);
    expect(E.clearFree(1)).toEqual([]);
  });
});
