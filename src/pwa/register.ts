import { registerSW } from "virtual:pwa-register";
import { track } from "../analytics/umami";
import { describeRegisterFailure } from "./register-failure";
import { createUpdateController, reloadOnceActivated, setupUpdateChecks, watchInstalls } from "./update-controller";

export function initPwaUpdates(doc: Document, prepareReload: () => Promise<void>): void {
  const button = doc.getElementById("update");
  if (!(button instanceof HTMLButtonElement)) throw new Error("missing #update");
  let current: ServiceWorkerRegistration | undefined;
  const reloadWhenReady = (): void => {
    void prepareReload().then(() => location.reload());
  };
  if (navigator.serviceWorker.controller) navigator.serviceWorker.addEventListener("controllerchange", reloadWhenReady);
  const controller = createUpdateController({
    track,
    prepareReload,
    showIndicator: (onRefresh) => {
      button.addEventListener("click", onRefresh);
      button.hidden = false;
    },
  });
  const updateSW = registerSW({
    onNeedRefresh: () => controller.onNeedRefresh(),
    onNeedReload: reloadWhenReady,
    onRegisteredSW: (_url, registration) => {
      if (!registration) return;
      current = registration;
      watchInstalls(registration, { track, onWaiting: () => controller.onNeedRefresh() });
      setupUpdateChecks(registration, controller, { track, checkNow: true });
    },
    onRegisterError: (error: unknown) => {
      track(
        "pwa-register-failed",
        describeRegisterFailure(error, {
          readRegister: () => Reflect.get(navigator.serviceWorker, "register"),
          standalone: matchMedia("(display-mode: standalone)").matches,
          visibilityState: doc.visibilityState,
        }),
      );
    },
  });
  controller.setUpdateSW(reloadOnceActivated(updateSW, () => current?.waiting ?? null, () => location.reload()));
}
