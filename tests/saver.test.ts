import type { RopeSnapshot } from "../src/engine/snapshot";
import { easyBoard } from "../src/game/easy";
import { generateBoard } from "../src/generate/generate";
import { decodeGame, encodeGame, storageKeys } from "../src/game/records";
import { GameSaver, restoreGame } from "../src/game/saver";
import { Session } from "../src/game/session";
import { memoryStore, type KeyValueStore } from "../src/game/settings";

const KEY = storageKeys("/").game;
const still = { now: () => 0 };

function setup() {
  let t = 1_000;
  const store = memoryStore(), saver = new GameSaver(store, KEY, () => t);
  const session = new Session(generateBoard(9, 4).engine);
  saver.started({ session, ropes: 4, seed: 9, startedAt: 400 });
  return { store, saver, session, advance: (ms: number) => (t += ms), saved: () => saver.load() };
}

function runUntilIdle(s: Session, saver: GameSaver): void {
  for (let frame = 0; frame < 3000 && s.phase !== "idle"; frame++) {
    s.step(still, 1e9);
    saver.tick();
  }
  saver.tick();
}

describe("game saver", () => {
  it("saves a game as soon as it starts", () => {
    const { saved } = setup();
    expect(saved()).toMatchObject({ ropes: 4, seed: 9, moves: 0, playedMs: 600 });
  });

  it("saves again when the board comes to rest after a move", () => {
    const { session, saver, saved, advance } = setup();
    const r = session.engine.active()[0]!;
    const free = session.engine.board.holes.findIndex((_, i) => !session.engine.occupied().has(i));
    expect(session.grab(session.engine.hole(r.ends[1]!))).toBe(true);
    session.drag(session.engine.hole(free));
    session.release();
    advance(5_000);
    saver.tick();
    expect(saved()).toMatchObject({ moves: 0 });
    runUntilIdle(session, saver);
    expect(saved()).toMatchObject({ moves: 1, playedMs: 5_600 });
  });

  it("writes nothing when hidden while a rope is held", () => {
    const { session, saver, saved, advance } = setup();
    const r = session.engine.active()[0]!;
    session.grab(session.engine.hole(r.ends[0]!));
    advance(3_000);
    expect(() => saver.hidden()).not.toThrow();
    expect(saved()).toMatchObject({ playedMs: 600 });
  });

  it("keeps the time thought about when hidden at rest", () => {
    const { saver, saved, advance } = setup();
    advance(3_000);
    saver.hidden();
    expect(saved()).toMatchObject({ playedMs: 3_600 });
  });

  it("deletes the save when the puzzle is solved", () => {
    const store = memoryStore(), saver = new GameSaver(store, KEY, () => 0);
    const session = new Session(easyBoard());
    saver.started({ session, ropes: 4, seed: 1, startedAt: 0 });
    expect(store.getItem(KEY)).not.toBeNull();
    session.won = true;
    saver.tick();
    expect(store.getItem(KEY)).toBeNull();
    saver.hidden();
    expect(store.getItem(KEY)).toBeNull();
  });

  it("keeps the old save while a replacement is being made", () => {
    const { saver, saved, advance } = setup();
    saver.forget();
    advance(9_000);
    saver.hidden();
    saver.tick();
    expect(saved()).toMatchObject({ playedMs: 600 });
  });

  it("says why it dropped a saved game it could not resume", () => {
    const store = memoryStore(), reasons: string[] = [];
    store.setItem(KEY, "{not json");
    const saver = new GameSaver(store, KEY, () => 0);
    expect(saver.load((reason) => reasons.push(reason))).toBeNull();
    expect(reasons).toEqual(["unreadable"]);
  });

  it("carries on unsaved when storage refuses", () => {
    const refusing: KeyValueStore = {
      getItem: () => null,
      setItem: () => {
        throw new Error("quota");
      },
      removeItem: () => undefined,
    };
    const saver = new GameSaver(refusing, KEY, () => 0);
    expect(() => saver.started({ session: new Session(generateBoard(9, 4).engine), ropes: 4, seed: 9, startedAt: 0 })).not.toThrow();
  });
});

describe("resuming a saved game", () => {
  it("removes the save until the resumed game comes to rest or the page is hidden", () => {
    const { store, session } = setup();
    const resumer = new GameSaver(store, KEY, () => 2_000);
    resumer.resumed({ session, ropes: 4, seed: 9, startedAt: 400 });
    expect(store.getItem(KEY)).toBeNull();
    resumer.tick();
    expect(store.getItem(KEY)).toBeNull();
    resumer.hidden();
    expect(resumer.load()).toMatchObject({ ropes: 4, seed: 9, playedMs: 1_600 });
  });

  it("saves a resumed game again once a move has come to rest", () => {
    const store = memoryStore(), saver = new GameSaver(store, KEY, () => 0);
    const session = new Session(generateBoard(9, 4).engine);
    saver.resumed({ session, ropes: 4, seed: 9, startedAt: 0 });
    const r = session.engine.active()[0]!;
    const free = session.engine.board.holes.findIndex((_, i) => !session.engine.occupied().has(i));
    session.grab(session.engine.hole(r.ends[1]!));
    session.drag(session.engine.hole(free));
    session.release();
    saver.tick();
    expect(store.getItem(KEY)).toBeNull();
    runUntilIdle(session, saver);
    expect(saver.load()).toMatchObject({ moves: 1 });
  });
});

describe("restoring a game", () => {
  it("restores moves, rope ids and the solve clock", () => {
    const E = generateBoard(9, 4).engine;
    E.ropes[2]!.cleared = true;
    const s = new Session(E);
    s.moves = 6;
    const store = memoryStore(), saver = new GameSaver(store, KEY, () => 10_000);
    saver.started({ session: s, ropes: 4, seed: 9, startedAt: 2_500 });
    const { session, startedAt } = restoreGame(saver.load()!, 50_000);
    expect(session.moves).toBe(6);
    expect(session.engine.active().map((r) => r.id)).toEqual([0, 1, 3]);
    expect(50_000 - startedAt).toBe(7_500);
  });

  it("rejects a saved game with nothing left to solve", () => {
    const ropes: RopeSnapshot[] = [0, 1, 2, 3].map(() => ({ cleared: true }));
    const g = { ropes: 4, seed: 9, moves: 3, playedMs: 1, snapshot: { cols: 4, rows: 5, ropes } };
    expect(decodeGame(JSON.parse(JSON.stringify(encodeGame(g))))).toBeNull();
  });
});
