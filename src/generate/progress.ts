export function throttled(send: () => void, everyMs: number, now: () => number = () => performance.now()): () => void {
  let last = now();
  return () => {
    const t = now();
    if (t - last < everyMs) return;
    last = t;
    send();
  };
}
