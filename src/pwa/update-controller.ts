import { sanitizeReason } from "../analytics/errors";
import type { Events, UpdateTrigger } from "../analytics/umami";

export type Track = <K extends keyof Events>(name: K, data: Events[K]) => void;
export type UpdateSW = () => Promise<void>;

export interface UpdatableRegistration {
  update(): Promise<unknown> | void;
}

export interface UpdateControllerDeps {
  track: Track;
  prepareReload: () => Promise<void>;
  showIndicator: (onRefresh: () => void) => void;
  fallbackReload?: () => void;
  scheduleFallback?: (handler: () => void, ms: number) => void;
}

export interface UpdateController {
  onNeedRefresh(): void;
  setUpdateSW(updateSW: UpdateSW): void;
  requestReloadIfPending(): void;
}

export const FALLBACK_RELOAD_MS = 3000;
const MAX_CHECK_FAILURE_REASONS = 5;

export function createUpdateController(deps: UpdateControllerDeps): UpdateController {
  const fallbackReload = deps.fallbackReload ?? (() => location.reload());
  const scheduleFallback =
    deps.scheduleFallback ??
    ((handler: () => void, ms: number) => {
      setTimeout(handler, ms);
    });
  let pending = false, applying = false;
  let updateSW: UpdateSW | null = null;
  let buffered: UpdateTrigger | null = null;

  const apply = (trigger: UpdateTrigger): void => {
    if (applying) return;
    const activate = updateSW;
    if (!activate) {
      buffered = trigger;
      return;
    }
    applying = true;
    void deps.prepareReload().then(() => {
      deps.track("pwa-update-applied", { trigger });
      Promise.resolve(activate()).catch((e: unknown) => deps.track("pwa-update-apply-failed", { reason: sanitizeReason(e) }));
      scheduleFallback(() => {
        deps.track("pwa-update-fallback-reload", {});
        fallbackReload();
      }, FALLBACK_RELOAD_MS);
    });
  };

  return {
    onNeedRefresh() {
      if (pending) return;
      pending = true;
      deps.track("pwa-update-detected", {});
      deps.showIndicator(() => apply("manual"));
    },
    setUpdateSW(fn) {
      updateSW = fn;
      if (buffered !== null) {
        const trigger = buffered;
        buffered = null;
        apply(trigger);
      }
    },
    requestReloadIfPending() {
      if (pending) apply("focus-regain");
    },
  };
}

export interface UpdateCheckDeps {
  track: Track;
  addVisibilityListener?: (handler: () => void) => void;
  isVisible?: () => boolean;
  checkNow?: boolean;
}

export function setupUpdateChecks(registration: UpdatableRegistration, controller: UpdateController, deps: UpdateCheckDeps): void {
  const isVisible = deps.isVisible ?? (() => document.visibilityState === "visible");
  const addVisibilityListener = deps.addVisibilityListener ?? ((handler: () => void) => document.addEventListener("visibilitychange", handler));
  const reported = new Set<string>();
  const reportFailure = (e: unknown): void => {
    const reason = sanitizeReason(e);
    if (reported.has(reason) || reported.size >= MAX_CHECK_FAILURE_REASONS) return;
    reported.add(reason);
    deps.track("pwa-update-check-failed", { reason });
  };
  const check = (): void => {
    Promise.resolve(registration.update()).catch(reportFailure);
  };
  addVisibilityListener(() => {
    if (!isVisible()) return;
    check();
    controller.requestReloadIfPending();
  });
  if (deps.checkNow) check();
}

export interface WatchedWorker {
  readonly state: string;
  addEventListener(type: "statechange", handler: () => void): void;
}

export interface InstallWatchable {
  readonly active: unknown;
  readonly installing: WatchedWorker | null;
  addEventListener(type: "updatefound", handler: () => void): void;
}

export interface InstallWatchDeps {
  track: Track;
  onWaiting: () => void;
  isOnline?: () => boolean;
}

export function watchInstalls(registration: InstallWatchable, deps: InstallWatchDeps): void {
  const isOnline = deps.isOnline ?? (() => navigator.onLine);
  let reported = false;
  const watch = (worker: WatchedWorker | null): void => {
    if (!worker) return;
    let last = worker.state;
    worker.addEventListener("statechange", () => {
      if (worker.state === "installed" && registration.active !== null) deps.onWaiting();
      if (worker.state === "redundant" && last === "installing" && !reported) {
        reported = true;
        deps.track("pwa-update-install-failed", { isUpdate: registration.active !== null, online: isOnline() });
      }
      last = worker.state;
    });
  };
  registration.addEventListener("updatefound", () => watch(registration.installing));
  watch(registration.installing);
}

export function reloadOnceActivated(updateSW: UpdateSW, waiting: () => WatchedWorker | null, reload: () => void): UpdateSW {
  return async () => {
    const worker = waiting();
    await updateSW();
    if (worker && worker.state !== "activated") {
      await new Promise<void>((resolve) => {
        worker.addEventListener("statechange", () => {
          if (worker.state === "activated") resolve();
        });
      });
    }
    reload();
  };
}
