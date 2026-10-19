import { ROPE_COUNTS } from "../board";

export interface Settings {
  ropes: number;
  showMoves: boolean;
}

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const SETTINGS_KEY = "rope-tangle/settings";
export const DEFAULT_SETTINGS: Readonly<Settings> = { ropes: 5, showMoves: true };

export function memoryStore(): KeyValueStore {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => {
      m.set(k, v);
    },
    removeItem: (k) => {
      m.delete(k);
    },
  };
}

export function loadSettings(store: KeyValueStore): Settings {
  let v: unknown;
  try {
    const raw = store.getItem(SETTINGS_KEY);
    v = raw === null ? null : JSON.parse(raw);
  } catch {
    v = null;
  }
  if (typeof v !== "object" || v === null) return { ...DEFAULT_SETTINGS };
  const ropes =
    "ropes" in v && typeof v.ropes === "number" && ROPE_COUNTS.includes(v.ropes)
      ? v.ropes
      : DEFAULT_SETTINGS.ropes;
  const showMoves = "showMoves" in v && typeof v.showMoves === "boolean" ? v.showMoves : DEFAULT_SETTINGS.showMoves;
  return { ropes, showMoves };
}

export function saveSettings(store: KeyValueStore, s: Settings): void {
  try {
    store.setItem(SETTINGS_KEY, JSON.stringify({ ropes: s.ropes, showMoves: s.showMoves }));
  } catch {
    return;
  }
}
