import { fromSnapshot, toSnapshot } from "../engine/snapshot";
import { decodeGame, encodeGame, GAME_VERSION, readRecord, removeRecord, writeRecord, type DiscardReason, type SavedGame } from "./records";
import { Session } from "./session";
import type { KeyValueStore } from "./settings";

export interface CurrentGame {
  session: Session;
  ropes: number;
  seed: number;
  startedAt: number;
}

export class GameSaver {
  private game: CurrentGame | null = null;
  private lastRevision = 0;
  private savedMidSettle = false;
  private readonly store: KeyValueStore;
  private readonly key: string;
  private readonly now: () => number;

  constructor(store: KeyValueStore, key: string, now: () => number) {
    this.store = store;
    this.key = key;
    this.now = now;
  }

  load(onDiscard?: (reason: DiscardReason) => void): SavedGame | null {
    return readRecord(this.store, this.key, decodeGame, onDiscard, GAME_VERSION);
  }

  started(g: CurrentGame): void {
    this.track(g);
    this.write();
  }

  resumed(g: CurrentGame): void {
    this.track(g);
  }

  tick(): void {
    const g = this.game;
    if (!g) return;
    if (g.session.won) {
      removeRecord(this.store, this.key);
      this.game = null;
      return;
    }
    const s = g.session;
    const changed = s.revision !== this.lastRevision;
    const cameToRest = this.savedMidSettle && s.phase === "idle";
    if (s.engine.endsSeated() && (changed || cameToRest)) this.write();
  }

  hidden(): void {
    if (this.game && this.game.session.engine.endsSeated() && !this.game.session.won) this.write();
  }

  forget(): void {
    this.game = null;
  }

  private track(g: CurrentGame): void {
    this.game = g;
    this.lastRevision = g.session.revision;
    this.savedMidSettle = false;
  }

  private write(): void {
    const g = this.game;
    if (!g) return;
    const s = g.session;
    this.lastRevision = s.revision;
    this.savedMidSettle = s.phase !== "idle";
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
  session.settle();
  return { session, startedAt: now - saved.playedMs };
}
