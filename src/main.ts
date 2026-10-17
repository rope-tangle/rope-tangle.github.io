import { resolveDistinctId } from "./analytics/distinct-id";
import { initErrorTracking } from "./analytics/errors";
import { injectTracker, track, trackerConfig } from "./analytics/umami";
import { startApp, storageOf } from "./game/app";

initErrorTracking(window, (data) => track("unhandled-error", data));
const trackerSettings = trackerConfig(import.meta.env, resolveDistinctId(window, storageOf(window)));
if (trackerSettings) injectTracker(document, trackerSettings);

startApp(document, window);

const deployId = import.meta.env.VITE_APP_VERSION;
if (deployId) {
  const label = document.createElement("div");
  label.id = "deploy-id";
  label.textContent = deployId;
  document.body.append(label);
}

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  const base = import.meta.env.BASE_URL;
  navigator.serviceWorker
    .register(`${base}sw.js`, { scope: base })
    .then(() => navigator.serviceWorker.ready)
    .then((reg) => reg.active?.postMessage({ cacheUrls: performance.getEntriesByType("resource").map((e) => e.name) }))
    .catch(() => undefined);
}
