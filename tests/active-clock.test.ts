import { activeClock } from "../src/game/active-clock";

describe("active clock", () => {
  it("leaves out the time the page was hidden", () => {
    let t = 1000, hidden = false;
    const clock = activeClock(() => t, () => hidden);
    const start = clock.now();
    t = 4000;
    hidden = true;
    clock.visibilityChanged();
    t = 64_000;
    expect(clock.now() - start).toBe(3000);
    hidden = false;
    clock.visibilityChanged();
    t = 66_000;
    expect(clock.now() - start).toBe(5000);
  });

  it("starts paused on a page that loads hidden", () => {
    let t = 0, hidden = true;
    const clock = activeClock(() => t, () => hidden);
    const start = clock.now();
    t = 10_000;
    hidden = false;
    clock.visibilityChanged();
    t = 12_000;
    expect(clock.now() - start).toBe(2000);
  });
});
