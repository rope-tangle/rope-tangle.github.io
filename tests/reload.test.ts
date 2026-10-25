import { generateBoard } from "../src/generate/generate";
import { storageKeys } from "../src/game/records";
import { ReloadPreparer } from "../src/game/reload";
import { GameSaver } from "../src/game/saver";
import { Session } from "../src/game/session";
import { memoryStore } from "../src/game/settings";

const KEY = storageKeys("/").game;
const still = { now: () => 0 };

function setup() {
  const session = new Session(generateBoard(9, 4).engine);
  const saver = new GameSaver(memoryStore(), KEY, () => 0);
  saver.started({ session, ropes: 4, seed: 9, startedAt: 0 });
  let current: Session | null = session;
  const preparer = new ReloadPreparer(() => current, () => saver.hidden());
  return { session, saver, preparer, setGame: (s: Session | null) => (current = s) };
}

function watch(p: Promise<void>): { done: boolean } {
  const state = { done: false };
  void p.then(() => (state.done = true));
  return state;
}

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function moveEnd(s: Session): void {
  const E = s.engine, r = E.active()[0]!;
  const free = E.board.holes.findIndex((_, i) => !E.occupied().has(i));
  expect(s.grab(E.hole(r.ends[1]!))).toBe(true);
  s.drag(E.hole(free));
  s.release();
}

function frames(s: Session, preparer: ReloadPreparer, until: () => boolean): void {
  for (let f = 0; f < 3000 && !until(); f++) {
    s.step(still, 1);
    preparer.check();
  }
}

describe("reload preparer", () => {
  it("is open until a reload is prepared", () => {
    const { preparer } = setup();
    expect(preparer.closed).toBe(false);
    void preparer.prepare();
    expect(preparer.closed).toBe(true);
  });

  it("resolves at once while no board is in play", async () => {
    const { preparer, setGame } = setup();
    setGame(null);
    const p = watch(preparer.prepare());
    await settle();
    expect(p.done).toBe(true);
  });

  it("resolves at once for a solved game", async () => {
    const { preparer, session } = setup();
    session.won = true;
    const p = watch(preparer.prepare());
    await settle();
    expect(p.done).toBe(true);
  });

  it("waits for a dropped end to land, then saves the move before resolving", async () => {
    const { session, saver, preparer } = setup();
    moveEnd(session);
    const p = watch(preparer.prepare());
    await settle();
    expect(p.done).toBe(false);
    frames(session, preparer, () => session.engine.endsSeated());
    expect(saver.load()).toMatchObject({ moves: 1 });
    await settle();
    expect(p.done).toBe(true);
  });

  it("waits while another finger still holds an end", async () => {
    const { session, preparer } = setup();
    const r = session.engine.active()[1]!;
    expect(session.grab(session.engine.hole(r.ends[0]!))).toBe(true);
    const p = watch(preparer.prepare());
    for (let f = 0; f < 30; f++) {
      session.step(still, 1);
      preparer.check();
    }
    await settle();
    expect(p.done).toBe(false);
    session.release();
    frames(session, preparer, () => session.engine.endsSeated());
    await settle();
    expect(p.done).toBe(true);
  });
});
