import { boardForRopes, PITCH, ROPE_COUNTS } from "../board";
import { BLOCKER_H } from "../engine/constants";
import type { EngineSnapshot, RopeSnapshot } from "../engine/snapshot";
import { GENERATOR_VERSION } from "../generate/version";
import type { KeyValueStore } from "./settings";

export const RECORD_VERSION = 1;

export interface StorageKeys {
  game: string;
  ready(ropes: number): string;
  bundled(ropes: number): string;
}

export function storageKeys(base: string): StorageKeys {
  const prefix = `rope-tangle${base}`;
  return { game: `${prefix}game`, ready: (ropes) => `${prefix}ready/${ropes}`, bundled: (ropes) => `${prefix}bundled/${ropes}` };
}

export interface ReadyBoard {
  ropes: number;
  seed: number;
  generationMs: number;
  tries: number;
  bundled: boolean;
  snapshot: EngineSnapshot;
}

export type RopeJson = { pts: number[]; ends: [number, number] } | { cleared: true };

export interface SnapshotJson {
  cols: number;
  rows: number;
  ropes: RopeJson[];
}

export interface ReadyJson {
  v: number;
  generator: number;
  ropes: number;
  seed: number;
  generationMs: number;
  tries: number;
  bundled: boolean;
  snapshot: SnapshotJson;
}

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isInt = (v: unknown): v is number => Number.isInteger(v);

export function encodeSnapshot(s: EngineSnapshot): SnapshotJson {
  return {
    cols: s.cols,
    rows: s.rows,
    ropes: s.ropes.map((r): RopeJson => ("cleared" in r ? { cleared: true } : { pts: Array.from(r.pts), ends: [r.ends[0], r.ends[1]] })),
  };
}

export function decodeSnapshot(v: unknown, ropes: number): EngineSnapshot | null {
  if (!ROPE_COUNTS.includes(ropes) || !isObj(v) || !Array.isArray(v["ropes"]) || v["ropes"].length !== ropes) return null;
  const board = boardForRopes(ropes);
  const cols = Math.round(board.width / PITCH) + 1, rows = Math.round(board.height / PITCH) + 1;
  if (v["cols"] !== cols || v["rows"] !== rows) return null;
  const used = new Set<number>(), out: RopeSnapshot[] = [];
  const margin = Math.max(board.width, board.height), extent = [board.width, board.height];
  const inside = (c: number, axis: number) => (axis === 2 ? Math.abs(c) <= BLOCKER_H : c >= -margin && c <= extent[axis]! + margin);
  for (const r of v["ropes"]) {
    if (!isObj(r)) return null;
    if (r["cleared"] === true) {
      out.push({ cleared: true });
      continue;
    }
    const pts = r["pts"], ends = r["ends"];
    if (!Array.isArray(pts) || pts.length < 12 || pts.length % 6 !== 0) return null;
    if (!pts.every((c, i) => isNum(c) && inside(c, i % 3))) return null;
    if (!Array.isArray(ends) || ends.length !== 2) return null;
    const a: unknown = ends[0], b: unknown = ends[1];
    if (!isInt(a) || !isInt(b)) return null;
    for (const h of [a, b]) {
      if (h < 0 || h >= board.holes.length || used.has(h)) return null;
      used.add(h);
    }
    out.push({ pts: Float64Array.from(pts), ends: [a, b] });
  }
  return { cols, rows, ropes: out };
}

export function encodeReady(b: ReadyBoard): ReadyJson {
  return { v: RECORD_VERSION, generator: GENERATOR_VERSION, ropes: b.ropes, seed: b.seed, generationMs: b.generationMs, tries: b.tries, bundled: b.bundled, snapshot: encodeSnapshot(b.snapshot) };
}

export function decodeReady(v: unknown, ropes: number): ReadyBoard | null {
  if (!isObj(v) || v["v"] !== RECORD_VERSION || v["generator"] !== GENERATOR_VERSION || v["ropes"] !== ropes) return null;
  const { seed, generationMs, tries } = v;
  if (!isInt(seed) || !isNum(generationMs) || !isInt(tries)) return null;
  const snapshot = decodeSnapshot(v["snapshot"], ropes);
  return snapshot ? { ropes, seed, generationMs, tries, bundled: v["bundled"] === true, snapshot } : null;
}

export function removeRecord(store: KeyValueStore, key: string): void {
  try {
    store.removeItem(key);
  } catch {
    return;
  }
}

export function readRecord<T>(store: KeyValueStore, key: string, decode: (v: unknown) => T | null): T | null {
  let raw: string | null;
  try {
    raw = store.getItem(key);
  } catch {
    return null;
  }
  if (raw === null) return null;
  let value: T | null;
  try {
    value = decode(JSON.parse(raw));
  } catch {
    value = null;
  }
  if (value === null) removeRecord(store, key);
  return value;
}

export function writeRecord(store: KeyValueStore, key: string, value: unknown): boolean {
  try {
    store.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}
