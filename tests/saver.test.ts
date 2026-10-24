import type { RopeSnapshot } from "../src/engine/snapshot";
import { easyBoard } from "../src/game/easy";
import { generateBoard } from "../src/generate/generate";
import { decodeGame, encodeGame, GAME_VERSION, storageKeys } from "../src/game/records";
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

function moveEnd(s: Session, rope: number): void {
  const E = s.engine, r = E.active()[rope]!;
  const free = E.board.holes.findIndex((_, i) => !E.occupied().has(i));
  expect(s.grab(E.hole(r.ends[1]!))).toBe(true);
  s.drag(E.hole(free));
  s.release();
}

function runUntilLanded(s: Session, saver: GameSaver): void {
  saver.tick();
  for (let frame = 0; frame < 3000 && s.engine.busy(); frame++) {
    s.step(still, 1);
    saver.tick();
  }
}

function runUntilIdle(s: Session, saver?: GameSaver): void {
  for (let frame = 0; frame < 3000 && s.phase !== "idle"; frame++) {
    s.step(still, 1e9);
    saver?.tick();
  }
  saver?.tick();
}

describe("game saver", () => {
  it("saves a game as soon as it starts", () => {
    const { saved } = setup();
    expect(saved()).toMatchObject({ ropes: 4, seed: 9, moves: 0, playedMs: 600 });
  });

  it("saves a move as soon as the dropped end has landed", () => {
    const { session, saver, saved, advance } = setup();
    moveEnd(session, 0);
    advance(5_000);
    saver.tick();
    expect(saved()).toMatchObject({ moves: 0 });
    runUntilLanded(session, saver);
    expect(session.phase).toBe("busy");
    expect(saved()).toMatchObject({ moves: 1, playedMs: 5_600 });
  });

  it("saves a move whose end landed between two ticks", () => {
    const { session, saver, saved } = setup();
    moveEnd(session, 0);
    while (session.engine.busy()) session.step(still, 1e9);
    saver.tick();
    expect(saved()).toMatchObject({ moves: 1 });
  });

  it("keeps a landed move when the next rope is grabbed before the board settles", () => {
    const { session, saver, saved } = setup();
    moveEnd(session, 0);
    runUntilLanded(session, saver);
    const r = session.engine.active()[1]!;
    expect(session.grab(session.engine.hole(r.ends[0]!))).toBe(true);
    saver.tick();
    saver.hidden();
    expect(saved()).toMatchObject({ moves: 1 });
  });

  it("writes a move twice: once it has landed and once at rest", () => {
    let writes = 0;
    const inner = memoryStore();
    const counting: KeyValueStore = { ...inner, setItem: (k, v) => (writes++, inner.setItem(k, v)) };
    const session = new Session(generateBoard(9, 4).engine), saver = new GameSaver(counting, KEY, () => 0);
    saver.started({ session, ropes: 4, seed: 9, startedAt: 0 });
    const before = writes;
    moveEnd(session, 0);
    runUntilLanded(session, saver);
    runUntilIdle(session, saver);
    for (let frame = 0; frame < 10; frame++) saver.tick();
    expect(session.engine.active()).toHaveLength(4);
    expect(writes - before).toBe(2);
  });

  it("waits to save an end that landed while another rope was held", () => {
    const { session, saver, saved } = setup();
    moveEnd(session, 0);
    const r = session.engine.active()[1]!;
    expect(session.grab(session.engine.hole(r.ends[0]!))).toBe(true);
    for (let frame = 0; frame < 3000 && session.engine.busy(); frame++) {
      session.step(still, 1);
      saver.tick();
    }
    expect(session.engine.busy()).toBe(false);
    saver.hidden();
    expect(saved()).toMatchObject({ moves: 0 });
    session.release();
    runUntilLanded(session, saver);
    expect(saved()).toMatchObject({ moves: 1 });
  });

  it("saves again when the board comes to rest after a move", () => {
    const { session, saver, saved, advance } = setup();
    moveEnd(session, 0);
    runUntilLanded(session, saver);
    advance(2_000);
    runUntilIdle(session, saver);
    expect(saved()).toMatchObject({ moves: 1, playedMs: 2_600 });
  });

  it("saves when a rope clears", () => {
    const { session, saver, saved, advance } = setup();
    advance(1_000);
    session.engine.ropes[2]!.cleared = true;
    session.revision++;
    saver.tick();
    expect(saved()).toMatchObject({ playedMs: 1_600 });
  });

  it("saves when hidden while the board is still settling", () => {
    const { session, saver, saved, advance } = setup();
    moveEnd(session, 0);
    while (session.engine.busy()) session.step(still, 1e9);
    advance(3_000);
    saver.hidden();
    expect(saved()).toMatchObject({ moves: 1, playedMs: 3_600 });
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

  it("versions saved games separately from ready boards", () => {
    const { store, saved } = setup();
    const raw = store.getItem(KEY)!;
    expect(JSON.parse(raw)).toMatchObject({ v: GAME_VERSION });
    expect(saved()).not.toBeNull();
    store.setItem(KEY, raw.replace(`"v":${GAME_VERSION}`, `"v":${GAME_VERSION + 1}`));
    const reasons: string[] = [];
    expect(new GameSaver(store, KEY, () => 0).load((reason) => reasons.push(reason))).toBeNull();
    expect(reasons).toEqual(["version"]);
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
  it("leaves the save in storage untouched when resuming", () => {
    const { store, session, saver } = setup();
    moveEnd(session, 0);
    runUntilLanded(session, saver);
    const before = store.getItem(KEY);
    const resumer = new GameSaver(store, KEY, () => 2_000);
    const { session: resumed, startedAt } = restoreGame(resumer.load()!, 2_000);
    resumer.resumed({ session: resumed, ropes: 4, seed: 9, startedAt });
    runUntilIdle(resumed, resumer);
    expect(store.getItem(KEY)).toBe(before);
    resumer.hidden();
    expect(resumer.load()).toMatchObject({ ropes: 4, seed: 9, moves: 1 });
  });

  it("saves a resumed game again once a move has landed", () => {
    const store = memoryStore(), saver = new GameSaver(store, KEY, () => 0);
    const session = new Session(generateBoard(9, 4).engine);
    saver.resumed({ session, ropes: 4, seed: 9, startedAt: 0 });
    moveEnd(session, 0);
    runUntilLanded(session, saver);
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

  it("lets a board saved mid-settle carry on settling", () => {
    const { session, saver } = setup();
    moveEnd(session, 0);
    runUntilLanded(session, saver);
    const { session: resumed } = restoreGame(saver.load()!, 0);
    expect(resumed.phase).toBe("busy");
    runUntilIdle(resumed);
    expect(resumed.phase).toBe("idle");
  });

  it("rejects a saved game with nothing left to solve", () => {
    const ropes: RopeSnapshot[] = [0, 1, 2, 3].map(() => ({ cleared: true }));
    const g = { ropes: 4, seed: 9, moves: 3, playedMs: 1, snapshot: { cols: 4, rows: 5, ropes } };
    expect(decodeGame(JSON.parse(JSON.stringify(encodeGame(g))))).toBeNull();
  });
});
