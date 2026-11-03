import { fromSnapshot, toSnapshot } from "../engine/snapshot";
import { History } from "./history";
import {
  decodeGame, encodeEntryText, encodeGameBase, encodeStartText, GAME_VERSION, gameText, readRecord, removeRecord, writeText, type DiscardReason, type SavedGame,
} from "./records";
import { Session } from "./session";
import type { KeyValueStore } from "./settings";

export interface CurrentGame {
  session: Session;
  ropes: number;
  seed: number;
  startedAt: number;
}

export const SAVED_UNDO = 10;
export const SAVED_REDO = 10;
export const GAME_CHAR_CAP = 1_000_000;

export class GameSaver {
  private game: CurrentGame | null = null;
  private lastRevision = 0;
  private savedMidSettle = false;
  private texts = new Map<object, string>();
  private readonly store: KeyValueStore;
  private readonly key: string;
  private readonly now: () => number;
  private readonly charCap: number;

  constructor(store: KeyValueStore, key: string, now: () => number, charCap = GAME_CHAR_CAP) {
    this.store = store;
    this.key = key;
    this.now = now;
    this.charCap = charCap;
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
    const base = encodeGameBase({
      ropes: g.ropes,
      seed: g.seed,
      moves: s.moves,
      playedMs: Math.round(this.now() - g.startedAt),
      snapshot: toSnapshot(s.engine),
      undos: s.undos,
      redos: s.redos,
      startOvers: s.startOvers,
      replay: s.replay,
    });
    const texts = new Map<object, string>();
    const cached = (key: object, encode: () => string): string => {
      const t = this.texts.get(key) ?? encode();
      texts.set(key, t);
      return t;
    };
    const start = s.history.start;
    const startText = start && cached(start, () => encodeStartText(start));
    const undo = s.history.undo.slice(-SAVED_UNDO).map((e) => cached(e, () => encodeEntryText(e)));
    const redo = s.history.redo.slice(-SAVED_REDO).map((e) => cached(e, () => encodeEntryText(e)));
    this.texts = texts;
    const drop = () => (redo.length > 0 ? redo.shift() : undo.shift()) !== undefined;
    let text = gameText(base, startText, undo, redo);
    while (text.length > this.charCap && drop()) text = gameText(base, startText, undo, redo);
    while (!writeText(this.store, this.key, text) && drop()) text = gameText(base, startText, undo, redo);
  }
}

export function restoreGame(saved: SavedGame, now: number): { session: Session; startedAt: number } {
  const session = new Session(fromSnapshot(saved.snapshot), new History(saved.start, saved.undo, saved.redo));
  session.moves = saved.moves;
  session.undos = saved.undos;
  session.redos = saved.redos;
  session.startOvers = saved.startOvers;
  session.replay = saved.replay;
  session.settle();
  return { session, startedAt: now - saved.playedMs };
}
