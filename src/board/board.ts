import type { Point } from "../util/point";

export interface Hole {
  x: number;
  y: number;
  rim: number;
  ox: number;
  oy: number;
}

export interface Board {
  width: number;
  height: number;
  holes: Hole[];
  rimLength: number;
}

export const PITCH = 64;

const SIZES = new Map<number, [number, number]>([
  [4, [4, 5]],
  [5, [4, 6]],
  [6, [5, 6]],
  [7, [5, 7]],
  [8, [6, 7]],
  [9, [6, 8]],
  [10, [7, 8]],
]);

export const ROPE_COUNTS: readonly number[] = [...SIZES.keys()];

export function rimParam(board: { width: number; height: number }, p: Point): number {
  const w = board.width, h = board.height;
  if (p.y <= 0) return Math.min(Math.max(p.x, 0), w);
  if (p.x >= w) return w + Math.min(p.y, h);
  if (p.y >= h) return w + h + (w - Math.max(p.x, 0));
  return 2 * w + h + (h - p.y);
}

export function rimPoint(board: Board, t: number): Point {
  const w = board.width, h = board.height;
  let u = t % board.rimLength;
  if (u < 0) u += board.rimLength;
  if (u <= w) return { x: u, y: 0 };
  u -= w;
  if (u <= h) return { x: w, y: u };
  u -= h;
  if (u <= w) return { x: w - u, y: h };
  u -= w;
  return { x: 0, y: h - u };
}

export function rimBoard(cols: number, rows: number): Board {
  const width = (cols - 1) * PITCH, height = (rows - 1) * PITCH;
  const holes: Hole[] = [];
  const add = (x: number, y: number) => {
    const ox = x === 0 ? -1 : x === width ? 1 : 0;
    const oy = y === 0 ? -1 : y === height ? 1 : 0;
    const l = Math.hypot(ox, oy);
    holes.push({ x, y, rim: rimParam({ width, height }, { x, y }), ox: ox / l, oy: oy / l });
  };
  for (let i = 0; i < cols; i++) add(i * PITCH, 0);
  for (let j = 1; j < rows; j++) add(width, j * PITCH);
  for (let i = cols - 2; i >= 0; i--) add(i * PITCH, height);
  for (let j = rows - 2; j >= 1; j--) add(0, j * PITCH);
  return { width, height, holes, rimLength: 2 * (width + height) };
}

export function boardForRopes(ropes: number): Board {
  const size = SIZES.get(ropes);
  if (!size) throw new Error(`boardForRopes: no board for ${ropes} ropes`);
  return rimBoard(size[0], size[1]);
}
