export function appNavigationAllowlist(base: string): RegExp {
  const escaped = base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escaped}(?:\\?|$)`);
}
