import type { KeyValueStore } from "../game/settings";

export const DISTINCT_ID_KEY = "rope-tangle/analytics-userid";

const QUERY_PARAM = "userid";
const VALID_ID = /^[a-z0-9-]{1,32}$/;

export interface UrlHost {
  location: { href: string };
  history: { state: unknown; replaceState(data: unknown, unused: string, url: string): void };
}

const isValid = (id: string | null): id is string => id !== null && id !== "off" && VALID_ID.test(id);

export function resolveDistinctId(host: UrlHost, store: KeyValueStore): string | undefined {
  const url = new URL(host.location.href);
  const param = url.searchParams.get(QUERY_PARAM);
  if (param !== null) {
    url.searchParams.delete(QUERY_PARAM);
    try {
      host.history.replaceState(host.history.state, "", url.href);
    } catch {}
    if (param === "" || param === "off") write(store, "");
    else if (isValid(param)) write(store, param);
  }
  let stored: string | null = null;
  try {
    stored = store.getItem(DISTINCT_ID_KEY);
  } catch {}
  return isValid(stored) ? stored : undefined;
}

function write(store: KeyValueStore, id: string): void {
  try {
    store.setItem(DISTINCT_ID_KEY, id);
  } catch {}
}
