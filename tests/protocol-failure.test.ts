import { RealizeFailed } from "../src/realize/errors";
import { handleRequest } from "../src/generate/protocol";

vi.mock("../src/generate/generate", () => ({
  generateBoard: () => {
    throw new RealizeFailed("no agreeing board in 10 tries from seed 1");
  },
}));

describe("generation protocol failures", () => {
  it("answers a generator that gives up with the no-board kind", () => {
    expect(handleRequest({ id: 3, seed: 1, ropes: 4 })).toEqual({
      id: 3,
      ok: false,
      error: "no agreeing board in 10 tries from seed 1",
      kind: "no-board",
    });
  });
});
