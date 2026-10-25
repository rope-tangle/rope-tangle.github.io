import { describeRegisterFailure, type RegisterEnv } from "../src/pwa/register-failure";

const env = (over: Partial<RegisterEnv> = {}): RegisterEnv => ({
  readRegister: () => Array.prototype.push,
  standalone: false,
  visibilityState: "visible",
  ...over,
});

describe("register failure description", () => {
  it("describes an Error with a native register function in a browser tab", () => {
    expect(describeRegisterFailure(new TypeError("Failed to register a ServiceWorker at https://x.test/sw.js"), env())).toEqual({
      reason: "Failed to register a ServiceWorker at <url>",
      valueType: "TypeError",
      name: "TypeError",
      registerFunction: "native",
      displayMode: "browser",
      visibilityState: "visible",
    });
  });

  it("names a replaced register function and an installed app", () => {
    const d = describeRegisterFailure("nope", env({ readRegister: () => () => undefined, standalone: true, visibilityState: "hidden" }));
    expect(d).toMatchObject({ reason: "nope", valueType: "string", name: "string", registerFunction: "replaced", displayMode: "standalone", visibilityState: "hidden" });
  });

  it("calls the register function unavailable when reading it throws", () => {
    const unreadable = () => {
      throw new Error("denied");
    };
    expect(describeRegisterFailure(null, env({ readRegister: unreadable }))).toMatchObject({ valueType: "null", name: "null", registerFunction: "unavailable" });
  });

  it("names a plain object by its constructor", () => {
    expect(describeRegisterFailure(new Event("error"), env())).toMatchObject({ valueType: "Event", name: "object" });
  });
});
