import process from "node:process";
import { startHangWatchdog, type HangWatchdog } from "./hang-watchdog";

// `testTimeout` can't interrupt a synchronous loop, and a fork worker stuck in
// one never notices its parent exit. Measure tests block for up to an hour.
declare global {
  var ropeTangleHangWatchdog: HangWatchdog | undefined;
}

const watchdog = (globalThis.ropeTangleHangWatchdog ??= startHangWatchdog({
  maxBlockedMs: process.env.MEASURE ? Infinity : 180_000,
}));

beforeEach(() => {
  const { testPath, currentTestName } = expect.getState();
  watchdog.beat(`${testPath} > ${currentTestName}`);
});
