import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute, type PrecacheEntry } from "workbox-precaching";
import { NavigationRoute, registerRoute } from "workbox-routing";
import { appNavigationAllowlist } from "./navigation-allowlist";

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: (PrecacheEntry | string)[] };

cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

const base = import.meta.env.BASE_URL;
registerRoute(new NavigationRoute(createHandlerBoundToURL(`${base}index.html`), { allowlist: [appNavigationAllowlist(base)] }));

self.addEventListener("message", (event) => {
  const data: unknown = event.data;
  if (typeof data === "object" && data !== null && "type" in data && data.type === "SKIP_WAITING") void self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith("rope-tangle-")).map((k) => caches.delete(k)))));
});
