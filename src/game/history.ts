import type { EngineSnapshot } from "../engine/snapshot";

export interface HistoryEntry {
  snapshot: EngineSnapshot;
  moves: number;
}

export class History {
  start: EngineSnapshot | null;
  readonly undo: HistoryEntry[];
  readonly redo: HistoryEntry[];

  constructor(start: EngineSnapshot | null, undo: HistoryEntry[] = [], redo: HistoryEntry[] = []) {
    this.start = start;
    this.undo = undo;
    this.redo = redo;
  }

  recordMove(before: HistoryEntry | null): void {
    if (before) this.undo.push(before);
    this.redo.length = 0;
  }

  stepBack(current: HistoryEntry): HistoryEntry | null {
    const e = this.undo.pop();
    if (!e) return null;
    this.redo.push(current);
    return e;
  }

  stepForward(current: HistoryEntry): HistoryEntry | null {
    const e = this.redo.pop();
    if (!e) return null;
    this.undo.push(current);
    return e;
  }

  clear(): void {
    this.undo.length = 0;
    this.redo.length = 0;
  }

  canUndo(): boolean {
    return this.undo.length > 0;
  }

  canRedo(): boolean {
    return this.redo.length > 0;
  }
}
