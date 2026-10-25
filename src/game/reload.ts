import type { Session } from "./session";

export class ReloadPreparer {
  closed = false;
  private readonly game: () => Session | null;
  private readonly save: () => void;
  private waiting: (() => void)[] = [];

  constructor(game: () => Session | null, save: () => void) {
    this.game = game;
    this.save = save;
  }

  prepare(): Promise<void> {
    this.closed = true;
    const ready = new Promise<void>((resolve) => this.waiting.push(resolve));
    this.check();
    return ready;
  }

  check(): void {
    if (this.waiting.length === 0) return;
    const s = this.game();
    if (s && !s.won && !s.engine.endsSeated()) return;
    this.save();
    for (const resolve of this.waiting.splice(0)) resolve();
  }
}
