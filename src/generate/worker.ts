import { snapshotTransfer } from "../engine/snapshot";
import { throttled } from "./progress";
import { handleRequest, isGenerateRequest, type GenerateProgress } from "./protocol";

const PROGRESS_EVERY_MS = 1000;

addEventListener("message", (e: MessageEvent<unknown>) => {
  if (!isGenerateRequest(e.data)) return;
  const progress: GenerateProgress = { id: e.data.id, progress: true };
  const res = handleRequest(e.data, throttled(() => postMessage(progress, { transfer: [] }), PROGRESS_EVERY_MS));
  postMessage(res, { transfer: res.ok ? snapshotTransfer(res.snapshot) : [] });
});
