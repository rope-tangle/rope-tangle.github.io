import { sanitizeReason } from "../analytics/errors";
import { track, type GameTrigger, type ReplacedGameData } from "../analytics/umami";
import { ROPE_COUNTS } from "../board";
import { drawScene } from "../render/scene";
import { fitView, ROPE_COLORS, type View } from "../render/ropes";
import type { Point } from "../util/point";
import { mulberry32 } from "../util/rng";
import { guardBack } from "./back-guard";
import { activeClock } from "./active-clock";
import { BoardFailure, BoardSource, type LoadedBoard } from "./board-source";
import { bundledLoader, fillFromBundled } from "./bundled";
import { easyBoard } from "./easy";
import { storageKeys } from "./records";
import { GameSaver, restoreGame } from "./saver";
import { Session, type Phase } from "./session";
import { loadSettings, memoryStore, saveSettings, type KeyValueStore } from "./settings";
import { Stock } from "./stock";

const BAR_HEIGHT = 48;
const SIDE_GAP = 32;
const TOAST_MS = 2500;
const MAX_DUMPS = 20;

export interface TestApi {
  boardToClient(x: number, y: number): Point;
  holeToClient(i: number): Point;
  holeAt(x: number, y: number): number;
  state(): {
    phase: Phase;
    moves: number;
    won: boolean;
    active: number;
    held: number | null;
    flying: number;
    ends: (number | null)[][];
    loading: boolean;
  };
  frameStats(): { frames: number; meanMs: number; meanTickMs: number; draws: number };
  resetFrameStats(): void;
}

declare global {
  interface Window {
    ropeTangleTest?: TestApi;
  }
}

export function shuffledColors(seed: number): string[] {
  const c = [...ROPE_COLORS], rng = mulberry32(seed);
  for (let i = c.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [c[i], c[j]] = [c[j]!, c[i]!];
  }
  return c;
}

function element<T extends HTMLElement>(doc: Document, id: string, type: new () => T): T {
  const el = doc.getElementById(id);
  if (!(el instanceof type)) throw new Error(`missing #${id}`);
  return el;
}

export function storageOf(win: Window): KeyValueStore {
  try {
    const s = win.localStorage;
    s.getItem("rope-tangle/probe");
    return s;
  } catch {
    return memoryStore();
  }
}

export function startApp(doc: Document, win: Window): void {
  const canvas = element(doc, "board", HTMLCanvasElement);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d context");
  const ropesSelect = element(doc, "ropes", HTMLSelectElement);
  const newButton = element(doc, "new", HTMLButtonElement);
  const movesLabel = element(doc, "moves", HTMLSpanElement);
  const overlay = element(doc, "overlay", HTMLDivElement);
  const toast = element(doc, "toast", HTMLDivElement);
  const settingsButton = element(doc, "settings-button", HTMLButtonElement);
  const dialog = element(doc, "settings", HTMLDialogElement);
  const showMoves = element(doc, "show-moves", HTMLInputElement);
  const dumpButton = element(doc, "show-dump", HTMLButtonElement);
  const dumpBox = element(doc, "dump", HTMLTextAreaElement);
  const closeSettings = element(doc, "close-settings", HTMLButtonElement);

  const params = new URLSearchParams(win.location.search);
  const testMode = params.has("test");
  const easy = testMode && params.get("board") === "easy";
  const store = storageOf(win);
  const settings = loadSettings(store);
  const visitRopes = Number(params.get("ropes"));
  if (testMode && ROPE_COUNTS.includes(visitRopes)) settings.ropes = visitRopes;

  const dumps: string[] = [];
  const keys = storageKeys(import.meta.env.BASE_URL);
  const stock = new Stock(store, keys);
  const bundledLoads = fillFromBundled(stock, bundledLoader, settings.ropes);
  const source = new BoardSource({
    stock,
    onTimeout: (ropes, background) => track("generation-timeout", { ropes, background }),
    isHidden: () => doc.hidden,
    onPrefetchFailed: (ropes, reason) => track("prefetch-failed", { ropes, reason }),
    onDumps: (d) => {
      dumps.push(...d);
      dumps.splice(0, Math.max(0, dumps.length - MAX_DUMPS));
    },
  });
  const played = activeClock(() => win.performance.now(), () => doc.hidden);
  const saver = new GameSaver(store, keys.game, () => played.now());
  doc.addEventListener("visibilitychange", () => {
    if (doc.hidden) saver.hidden();
    played.visibilityChanged();
    if (!doc.hidden) source.resume();
  });
  const frames = { count: 0, total: 0, last: 0, ticks: 0, tickTotal: 0, draws: 0 };
  const clock = { now: () => win.performance.now() };
  let session: Session | null = null;
  let colors: readonly string[] = ROPE_COLORS;
  let view: View = { s: 1, ox: 0, oy: 0 };
  let dpr = 1, loadToken = 0, renderMs = 0, budgetMs = 8, winShown = false, dirty = true, movesText = "";
  let activePointer: number | null = null;
  let gameRopes = 0, gameStartedAt = 0;
  let replaced: ReplacedGameData = {};

  const layout = () => {
    dpr = Math.min(win.devicePixelRatio || 1, 2);
    const w = win.innerWidth, h = win.innerHeight - BAR_HEIGHT;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    if (session) view = fitView(session.engine.board, w, h, SIDE_GAP);
    dirty = true;
  };

  const updateMoves = () => {
    const text = settings.showMoves && session ? String(session.moves) : "";
    if (text !== movesText) movesLabel.textContent = movesText = text;
  };

  const showOverlay = (text: string, button?: { label: string; action: () => void }) => {
    const line = doc.createElement("div");
    line.textContent = text;
    overlay.replaceChildren(line);
    if (button) {
      const b = doc.createElement("button");
      b.textContent = button.label;
      b.addEventListener("click", button.action);
      overlay.append(b);
    }
    overlay.hidden = false;
  };

  const begin = (b: LoadedBoard) => {
    session = new Session(b.engine);
    gameRopes = b.ropes;
    gameStartedAt = played.now();
    if (!easy) saver.started({ session, ropes: b.ropes, seed: b.seed, startedAt: gameStartedAt });
    colors = shuffledColors(b.seed);
    winShown = false;
    layout();
    overlay.hidden = true;
    updateMoves();
  };

  const load = (trigger: GameTrigger) => {
    const token = ++loadToken, ropes = settings.ropes, requestedAt = played.now();
    if (session) {
      replaced = { replacedSolved: session.won, replacedMoves: session.moves, replacedRopesLeft: session.engine.active().length };
      if (!session.won) replaced.replacedElapsedMs = Math.round(requestedAt - gameStartedAt);
    }
    saver.forget();
    session = null;
    updateMoves();
    showOverlay("Scrambling…");
    const started = (b: LoadedBoard) => {
      begin(b);
      track("new-game-started", {
        ropes: b.ropes,
        trigger,
        generationMs: Math.round(b.generationMs),
        tries: b.tries,
        waitMs: Math.round(played.now() - requestedAt),
        prefetched: b.prefetched,
        bundled: b.bundled,
        ...replaced,
      });
      replaced = {};
    };
    if (easy) {
      started({ engine: easyBoard(), seed: 1, ropes: 2, tries: 1, generationMs: 0, prefetched: false, bundled: false });
      return;
    }
    (bundledLoads.get(ropes) ?? Promise.resolve()).then(() => (token === loadToken ? source.next(ropes) : new Promise<never>(() => undefined))).then(
      (b) => {
        if (token !== loadToken) return;
        started(b);
        source.fill();
      },
      (e: unknown) => {
        if (token !== loadToken) return;
        track("new-game-failed", { ropes, trigger, reason: e instanceof BoardFailure ? e.kind : "error", detail: sanitizeReason(e), ...replaced });
        showOverlay(e instanceof Error ? e.message : "No board", { label: "Try again", action: () => load("retry") });
      },
    );
  };

  const toBoard = (ev: PointerEvent): Point => {
    const r = canvas.getBoundingClientRect();
    return { x: (ev.clientX - r.left - view.ox) / view.s, y: (ev.clientY - r.top - view.oy) / view.s };
  };

  canvas.addEventListener("pointerdown", (ev) => {
    if (activePointer !== null || !session || !session.grab(toBoard(ev))) return;
    activePointer = ev.pointerId;
    canvas.setPointerCapture(ev.pointerId);
  });
  canvas.addEventListener("pointermove", (ev) => {
    if (ev.pointerId === activePointer) session?.drag(toBoard(ev));
  });
  const letGo = (ev: PointerEvent) => {
    if (ev.pointerId !== activePointer) return;
    activePointer = null;
    session?.release();
    updateMoves();
  };
  canvas.addEventListener("pointerup", letGo);
  canvas.addEventListener("pointercancel", letGo);
  canvas.addEventListener("lostpointercapture", letGo);

  let toastTimer = 0;
  guardBack(win, canvas, () => {
    track("back-guard-caught", {});
    toast.textContent = "Go back again to leave";
    toast.hidden = false;
    win.clearTimeout(toastTimer);
    toastTimer = win.setTimeout(() => {
      toast.hidden = true;
    }, TOAST_MS);
  });

  for (const n of ROPE_COUNTS) {
    const o = doc.createElement("option");
    o.value = String(n);
    o.textContent = String(n);
    ropesSelect.append(o);
  }
  ropesSelect.value = String(settings.ropes);
  ropesSelect.addEventListener("change", () => {
    settings.ropes = Number(ropesSelect.value);
    saveSettings(store, settings);
    load("rope-count");
  });
  newButton.addEventListener("click", () => load("new"));
  showMoves.checked = settings.showMoves;
  showMoves.addEventListener("change", () => {
    settings.showMoves = showMoves.checked;
    saveSettings(store, settings);
    updateMoves();
  });
  settingsButton.addEventListener("click", () => {
    dumpBox.hidden = true;
    dumpButton.disabled = dumps.length === 0;
    dialog.showModal();
  });
  dumpButton.addEventListener("click", () => {
    dumpBox.value = dumps.join("\n\n");
    dumpBox.hidden = false;
    dumpBox.select();
  });
  closeSettings.addEventListener("click", () => dialog.close());
  win.addEventListener("resize", layout);

  const tick = (t: number) => {
    const tickStart = clock.now();
    if (frames.last > 0) {
      frames.count++;
      frames.total += t - frames.last;
    }
    frames.last = t;
    const s = session;
    if (s) {
      const moving = s.animating();
      s.step(clock, budgetMs);
      saver.tick();
      if (moving || dirty) {
        dirty = false;
        const t1 = clock.now();
        drawScene(ctx, s.engine, colors, view, dpr, { pointer: s.pointer, hoverHole: s.targetHole(), fades: s.fades });
        frames.draws++;
        renderMs = renderMs * 0.9 + (clock.now() - t1) * 0.1;
        budgetMs = Math.max(4, Math.min(11, 14 - renderMs));
      }
      updateMoves();
      if (s.won && !winShown) {
        winShown = true;
        const n = s.moves;
        track("puzzle-completed", { ropes: gameRopes, moves: n, elapsedMs: Math.round(played.now() - gameStartedAt) });
        showOverlay(settings.showMoves ? `Solved · ${n} ${n === 1 ? "move" : "moves"}` : "✓", { label: "Next", action: () => load("next") });
      }
    }
    frames.ticks++;
    frames.tickTotal += clock.now() - tickStart;
    win.requestAnimationFrame(tick);
  };

  if (testMode) {
    const toClient = (x: number, y: number): Point => {
      const r = canvas.getBoundingClientRect();
      return { x: r.left + view.ox + x * view.s, y: r.top + view.oy + y * view.s };
    };
    win.ropeTangleTest = {
      boardToClient: toClient,
      holeToClient: (i) => {
        const h = session?.engine.board.holes[i];
        if (!h) throw new Error(`no hole ${i}`);
        return toClient(h.x, h.y);
      },
      holeAt: (x, y) => session?.engine.board.holes.findIndex((h) => h.x === x && h.y === y) ?? -1,
      state: () => ({
        phase: session?.phase ?? "idle",
        moves: session?.moves ?? 0,
        won: session?.won ?? false,
        active: session?.engine.active().length ?? 0,
        held: session?.engine.held?.rope ?? null,
        flying: session?.engine.flying.length ?? 0,
        ends: session ? session.engine.ropes.map((r) => [...r.ends]) : [],
        loading: session === null,
      }),
      frameStats: () => ({
        frames: frames.count,
        meanMs: frames.count > 0 ? frames.total / frames.count : 0,
        meanTickMs: frames.ticks > 0 ? frames.tickTotal / frames.ticks : 0,
        draws: frames.draws,
      }),
      resetFrameStats: () => {
        frames.count = 0;
        frames.total = 0;
        frames.last = 0;
        frames.ticks = 0;
        frames.tickTotal = 0;
      },
    };
  }

  layout();
  win.addEventListener("pagehide", () => saver.hidden());

  const saved = easy ? null : saver.load((reason) => track("saved-game-discarded", { reason }));
  if (saved) {
    const { session: resumed, startedAt } = restoreGame(saved, played.now());
    session = resumed;
    gameRopes = saved.ropes;
    gameStartedAt = startedAt;
    colors = shuffledColors(saved.seed);
    settings.ropes = saved.ropes;
    ropesSelect.value = String(saved.ropes);
    saveSettings(store, settings);
    saver.resumed({ session: resumed, ropes: saved.ropes, seed: saved.seed, startedAt });
    layout();
    overlay.hidden = true;
    updateMoves();
    track("game-resumed", { ropes: saved.ropes, moves: saved.moves, ropesLeft: resumed.engine.active().length, elapsedMs: Math.round(saved.playedMs) });
    source.fill(saved.ropes);
  } else {
    load("first-load");
  }
  win.requestAnimationFrame(tick);
}
