import { boardForRopes, PITCH, ROPE_COUNTS } from "../board";
import { BLOCKER_H } from "../engine/constants";
import type { EngineSnapshot, RopeSnapshot } from "../engine/snapshot";
import { GENERATOR_VERSION } from "../generate/version";
import type { HistoryEntry } from "./history";
import type { KeyValueStore } from "./settings";

export const RECORD_VERSION = 1;
export const GAME_VERSION = 1;
export const HISTORY_DECIMALS = 2;

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

export function encodeSnapshot(s: EngineSnapshot, decimals?: number): SnapshotJson {
  const f = decimals === undefined ? null : 10 ** decimals;
  const pts = (a: Float64Array): number[] => (f === null ? Array.from(a) : Array.from(a, (c) => Math.round(c * f) / f));
  return {
    cols: s.cols,
    rows: s.rows,
    ropes: s.ropes.map((r): RopeJson => ("cleared" in r ? { cleared: true } : { pts: pts(r.pts), ends: [r.ends[0], r.ends[1]] })),
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

export type DiscardReason = "unreadable" | "version" | "invalid";

export function readRecord<T>(
  store: KeyValueStore,
  key: string,
  decode: (v: unknown) => T | null,
  onDiscard: (reason: DiscardReason) => void = () => undefined,
  version = RECORD_VERSION,
): T | null {
  let raw: string | null;
  try {
    raw = store.getItem(key);
  } catch {
    return null;
  }
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    removeRecord(store, key);
    onDiscard("unreadable");
    return null;
  }
  let value: T | null;
  try {
    value = decode(parsed);
  } catch {
    value = null;
  }
  if (value === null) {
    removeRecord(store, key);
    onDiscard(isObj(parsed) && parsed["v"] !== version ? "version" : "invalid");
  }
  return value;
}

export function writeRecord(store: KeyValueStore, key: string, value: unknown): boolean {
  return writeText(store, key, JSON.stringify(value));
}

export function writeText(store: KeyValueStore, key: string, text: string): boolean {
  try {
    store.setItem(key, text);
    return true;
  } catch {
    return false;
  }
}

export interface SavedGame {
  ropes: number;
  seed: number;
  moves: number;
  playedMs: number;
  snapshot: EngineSnapshot;
  start: EngineSnapshot | null;
  undo: HistoryEntry[];
  redo: HistoryEntry[];
  undos: number;
  redos: number;
  startOvers: number;
  replay: boolean;
}

export interface HistoryEntryJson {
  moves: number;
  snapshot: SnapshotJson;
}

export interface GameJson {
  v: number;
  ropes: number;
  seed: number;
  moves: number;
  playedMs: number;
  snapshot: SnapshotJson;
  start: SnapshotJson | null;
  undo: HistoryEntryJson[];
  redo: HistoryEntryJson[];
  undos: number;
  redos: number;
  startOvers: number;
  replay: boolean;
}

export function encodeEntry(e: HistoryEntry): HistoryEntryJson {
  return { moves: e.moves, snapshot: encodeSnapshot(e.snapshot, HISTORY_DECIMALS) };
}

export function encodeGame(g: SavedGame): GameJson {
  return {
    v: GAME_VERSION,
    ropes: g.ropes,
    seed: g.seed,
    moves: g.moves,
    playedMs: g.playedMs,
    snapshot: encodeSnapshot(g.snapshot),
    start: g.start && encodeSnapshot(g.start, HISTORY_DECIMALS),
    undo: g.undo.map(encodeEntry),
    redo: g.redo.map(encodeEntry),
    undos: g.undos,
    redos: g.redos,
    startOvers: g.startOvers,
    replay: g.replay,
  };
}

const count = (v: unknown): number => (isInt(v) && v >= 0 ? v : 0);

function decodeEntries(v: unknown, ropes: number): HistoryEntry[] {
  if (!Array.isArray(v)) return [];
  const out: HistoryEntry[] = [];
  for (const e of v) {
    if (!isObj(e) || !isInt(e["moves"]) || e["moves"] < 0) continue;
    const snapshot = decodeSnapshot(e["snapshot"], ropes);
    if (snapshot) out.push({ moves: e["moves"], snapshot });
  }
  return out;
}

export function decodeGame(v: unknown): SavedGame | null {
  if (!isObj(v) || v["v"] !== GAME_VERSION) return null;
  const { ropes, seed, moves, playedMs } = v;
  if (!isInt(ropes) || !isInt(seed) || !isInt(moves) || moves < 0 || !isNum(playedMs) || playedMs < 0) return null;
  const snapshot = decodeSnapshot(v["snapshot"], ropes);
  if (!snapshot || snapshot.ropes.every((r) => "cleared" in r)) return null;
  return {
    ropes,
    seed,
    moves,
    playedMs,
    snapshot,
    start: decodeSnapshot(v["start"], ropes),
    undo: decodeEntries(v["undo"], ropes),
    redo: decodeEntries(v["redo"], ropes),
    undos: count(v["undos"]),
    redos: count(v["redos"]),
    startOvers: count(v["startOvers"]),
    replay: v["replay"] === true,
  };
}
