import { handleRequest, isGenerateRequest } from "../src/generate/protocol";

describe("generation protocol", () => {
  it("recognizes requests and nothing else", () => {
    expect(isGenerateRequest({ id: 1, seed: 2, ropes: 4 })).toBe(true);
    expect(isGenerateRequest({ id: 1, seed: "2", ropes: 4 })).toBe(false);
    expect(isGenerateRequest(null)).toBe(false);
    expect(isGenerateRequest("go")).toBe(false);
  });

  it("answers a request with a snapshot of the generated board", () => {
    const res = handleRequest({ id: 7, seed: 1, ropes: 4 });
    expect(res.id).toBe(7);
    if (!res.ok) throw new Error(res.error);
    expect(res.snapshot.ropes).toHaveLength(4);
    expect(res.seed).toBeGreaterThanOrEqual(1);
    expect(res.tries).toBeGreaterThanOrEqual(1);
    expect(res.ms).toBeGreaterThan(0);
  });

  it("answers an impossible request with an error instead of throwing", () => {
    const res = handleRequest({ id: 8, seed: 1, ropes: 3 });
    expect(res).toMatchObject({ id: 8, ok: false, kind: "error" });
  });

  it("reports progress while it generates", () => {
    let calls = 0;
    handleRequest({ id: 9, seed: 1, ropes: 4 }, () => calls++);
    expect(calls).toBeGreaterThan(100);
  });
});
