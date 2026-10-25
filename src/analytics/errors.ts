const MAX_LENGTH = 200;
const MAX_PER_REASON = 5;
const MAX_TOTAL = 50;

export type UnhandledErrorData = { source: "error" | "rejection"; name: string; reason: string };

export function sanitizeReason(value: unknown): string {
  const raw = value instanceof Error ? value.message : String(value);
  const reason =
    raw
      .replace(/[a-z-]*extension:\/\/\S+/gi, "<ext>")
      .replace(/\b(?:data|blob):\S+/gi, "<url>")
      .replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, "<url>")
      .trim() || "unknown";
  return reason.slice(0, MAX_LENGTH);
}

export function errorName(value: unknown): string {
  if (value instanceof Error) return value.name || "Error";
  return value === null ? "null" : typeof value;
}

export function describeValueType(value: unknown): string {
  if (value === null) return "null";
  if (typeof value !== "object") return typeof value;
  const name: unknown = Object.getPrototypeOf(value)?.constructor?.name;
  return typeof name === "string" && name !== "" ? name : "object";
}

export function createErrorReporter(send: (data: UnhandledErrorData) => void): (source: UnhandledErrorData["source"], cause: unknown) => void {
  const perReason = new Map<string, number>();
  let total = 0, noticeSent = false;
  return (source, cause) => {
    const reason = sanitizeReason(cause);
    const seen = perReason.get(reason) ?? 0;
    if (total < MAX_TOTAL && seen < MAX_PER_REASON) {
      perReason.set(reason, seen + 1);
      total++;
      send({ source, name: errorName(cause), reason });
    } else if (total >= MAX_TOTAL && !noticeSent) {
      noticeSent = true;
      send({ source, name: "RateLimited", reason: `cap of ${MAX_TOTAL} errors per session reached` });
    }
  };
}

export function initErrorTracking(win: Window, send: (data: UnhandledErrorData) => void): void {
  const report = createErrorReporter(send);
  win.addEventListener("error", (e) => {
    if (/^script error\.?$/i.test(e.message.trim()) || /^[a-z-]*extension:\/\//i.test(e.filename)) return;
    report("error", e.error ?? e.message);
  });
  win.addEventListener("unhandledrejection", (e) => report("rejection", e.reason));
}
