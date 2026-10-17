import { throttled } from "../src/generate/progress";

describe("progress throttle", () => {
  it("passes on at most one call per interval, measured from the start", () => {
    let t = 0, sent = 0;
    const tick = throttled(() => sent++, 1000, () => t);
    for (t = 0; t <= 2500; t += 100) tick();
    expect(sent).toBe(2);
  });

  it("stays quiet when calls stop", () => {
    let t = 0, sent = 0;
    const tick = throttled(() => sent++, 1000, () => t);
    t = 999;
    tick();
    expect(sent).toBe(0);
    t = 1000;
    tick();
    expect(sent).toBe(1);
  });
});
