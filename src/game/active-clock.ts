export interface ActiveClock {
  now(): number;
  visibilityChanged(): void;
}

export function activeClock(wall: () => number, isHidden: () => boolean): ActiveClock {
  let hiddenTotal = 0, hiddenSince: number | null = isHidden() ? wall() : null;
  return {
    now: () => {
      const t = wall();
      return t - hiddenTotal - (hiddenSince === null ? 0 : t - hiddenSince);
    },
    visibilityChanged: () => {
      if (isHidden()) {
        hiddenSince ??= wall();
      } else if (hiddenSince !== null) {
        hiddenTotal += wall() - hiddenSince;
        hiddenSince = null;
      }
    },
  };
}
