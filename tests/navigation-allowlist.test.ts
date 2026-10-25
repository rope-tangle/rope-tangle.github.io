import { appNavigationAllowlist } from "../src/pwa/navigation-allowlist";

describe("navigation allowlist", () => {
  it("matches the base with or without a query", () => {
    const re = appNavigationAllowlist("/");
    expect(re.test("/")).toBe(true);
    expect(re.test("/?test=1&ropes=4")).toBe(true);
  });

  it("leaves previews, the debug page and the prototype to the network", () => {
    const re = appNavigationAllowlist("/");
    for (const path of ["/dev/", "/dev/?test=1", "/debug/", "/spike/", "/index.html"]) expect(re.test(path)).toBe(false);
  });

  it("escapes the base so a preview base only matches itself", () => {
    const re = appNavigationAllowlist("/dev/");
    expect(re.test("/dev/")).toBe(true);
    expect(re.test("/dev/?seed=3")).toBe(true);
    expect(re.test("/")).toBe(false);
    expect(re.test("/devx/")).toBe(false);
  });
});
