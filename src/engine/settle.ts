import type { Engine } from "./engine";

export function settle(E: Engine, max = 800, eps = 0.15, onStep: () => void = () => undefined): number {
  E.resetDrift();
  for (let i = 0; i < max; i++) {
    E.substep(null);
    onStep();
    if (E.drift < eps && !E.busy()) return i + 1;
  }
  return max;
}
