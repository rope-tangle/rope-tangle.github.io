import type { BoardFailure } from "../game/board-source";
import type { UnhandledErrorData } from "./errors";

declare global {
  interface Window {
    umami?: { track(name: string, data?: Record<string, unknown>): void };
  }
}

export type GameTrigger = "first-load" | "new" | "next" | "rope-count" | "retry";

export type ReplacedGameData = {
  replacedSolved?: boolean;
  replacedMoves?: number;
  replacedRopesLeft?: number;
  replacedElapsedMs?: number;
};

export type NewGameStartedData = ReplacedGameData & {
  ropes: number;
  trigger: GameTrigger;
  generationMs: number;
  tries: number;
  waitMs: number;
  prefetched: boolean;
  bundled: boolean;
};

export type Events = {
  "new-game-started": NewGameStartedData;
  "new-game-failed": ReplacedGameData & { ropes: number; trigger: GameTrigger; reason: BoardFailure["kind"]; detail: string };
  "generation-timeout": { ropes: number; background: boolean };
  "prefetch-failed": { ropes: number; reason: BoardFailure["kind"] };
  "puzzle-completed": { ropes: number; moves: number; elapsedMs: number };
  "game-resumed": { ropes: number; moves: number; ropesLeft: number; elapsedMs: number };
  "back-guard-caught": Record<string, never>;
  "unhandled-error": UnhandledErrorData;
};

export interface TrackerConfig {
  src: string;
  websiteId: string;
  distinctId?: string;
  tag?: string;
}

export function trackerConfig(
  env: { VITE_UMAMI_WEBSITE_ID?: string; VITE_UMAMI_SCRIPT_URL?: string; VITE_APP_VERSION?: string },
  distinctId: string | undefined,
): TrackerConfig | null {
  const websiteId = env.VITE_UMAMI_WEBSITE_ID, src = env.VITE_UMAMI_SCRIPT_URL;
  if (!websiteId || !src) return null;
  const config: TrackerConfig = { src, websiteId };
  if (distinctId) config.distinctId = distinctId;
  if (env.VITE_APP_VERSION) config.tag = env.VITE_APP_VERSION;
  return config;
}

const MAX_HELD = 50;

type Umami = NonNullable<Window["umami"]>;

export function createTracker(umami: () => Umami | undefined) {
  let held: [string, Record<string, unknown>][] | null = null;
  const send = (u: Umami, name: string, data: Record<string, unknown>) => {
    try {
      u.track(name, data);
    } catch {}
  };
  return {
    track: <K extends keyof Events>(name: K, data: Events[K]) => {
      const u = umami();
      if (u) send(u, name, data);
      else if (held && held.length < MAX_HELD) held.push([name, data]);
    },
    wait: () => {
      held ??= [];
    },
    flush: () => {
      const u = umami();
      if (!u || !held) return;
      for (const [name, data] of held) send(u, name, data);
      held = null;
    },
    drop: () => {
      held = null;
    },
  };
}

const tracker = createTracker(() => (typeof window === "undefined" ? undefined : window.umami));

export const track = tracker.track;

export function injectTracker(doc: Document, config: TrackerConfig): void {
  const script = doc.createElement("script");
  script.defer = true;
  script.src = config.src;
  script.dataset["websiteId"] = config.websiteId;
  script.dataset["performance"] = "true";
  if (config.distinctId) script.dataset["distinctId"] = config.distinctId;
  if (config.tag) script.dataset["tag"] = config.tag;
  script.addEventListener("load", tracker.flush);
  script.addEventListener("error", tracker.drop);
  tracker.wait();
  doc.head.append(script);
}
