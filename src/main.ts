import { resolveDistinctId } from "./analytics/distinct-id";
import { initErrorTracking } from "./analytics/errors";
import { injectTracker, track, trackerConfig } from "./analytics/umami";
import { startApp, storageOf } from "./game/app";
import { initPwaUpdates } from "./pwa/register";

initErrorTracking(window, (data) => track("unhandled-error", data));
const trackerSettings = trackerConfig(import.meta.env, resolveDistinctId(window, storageOf(window)));
if (trackerSettings) injectTracker(document, trackerSettings);

const app = startApp(document, window);

const deployId = import.meta.env.VITE_APP_VERSION;
if (deployId) {
  const label = document.createElement("div");
  label.id = "deploy-id";
  label.textContent = deployId;
  document.body.append(label);
}

if (import.meta.env.PROD && "serviceWorker" in navigator) initPwaUpdates(document, () => app.prepareReload());
