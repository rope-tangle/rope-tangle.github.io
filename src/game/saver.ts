import { fromSnapshot, toSnapshot } from "../engine/snapshot";
import { decodeGame, encodeGame, readRecord, removeRecord, writeRecord, type DiscardReason, type SavedGame } from "./records";
import { Session, type Phase } from "./session";
import type { KeyValueStore } from "./settings";

export interface CurrentGame {
  session: Session;
  ropes: number;
  seed: number;
  startedAt: number;
}

export class GameSaver {
  private game: CurrentGame | null = null;
  private lastPhase: Phase = "idle";
  private readonly store: KeyValueStore;
  private readonly key: string;
  private readonly now: () => number;

  constructor(store: KeyValueStore, key: string, now: () => number) {
    this.store = store;
    this.key = key;
    this.now = now;
  }

  load(onDiscard?: (reason: DiscardReason) => void): SavedGame | null {
    return readRecord(this.store, this.key, decodeGame, onDiscard);
  }

  started(g: CurrentGame): void {
    this.game = g;
    this.lastPhase = g.session.phase;
    this.write();
  }

  resumed(g: CurrentGame): void {
    this.game = g;
    this.lastPhase = g.session.phase;
    removeRecord(this.store, this.key);
  }

  tick(): void {
    const g = this.game;
    if (!g) return;
    if (g.session.won) {
      removeRecord(this.store, this.key);
      this.game = null;
      return;
    }
    const phase = g.session.phase;
    if (phase === "idle" && this.lastPhase !== "idle") this.write();
    this.lastPhase = phase;
  }

  hidden(): void {
    if (this.game && this.game.session.phase === "idle" && !this.game.session.won) this.write();
  }

  forget(): void {
    this.game = null;
  }

  private write(): void {
    const g = this.game;
    if (!g) return;
    const s = g.session;
    writeRecord(this.store, this.key, encodeGame({
      ropes: g.ropes,
      seed: g.seed,
      moves: s.moves,
      playedMs: Math.round(this.now() - g.startedAt),
      snapshot: toSnapshot(s.engine),
    }));
  }
}

export function restoreGame(saved: SavedGame, now: number): { session: Session; startedAt: number } {
  const session = new Session(fromSnapshot(saved.snapshot));
  session.moves = saved.moves;
  return { session, startedAt: now - saved.playedMs };
}
