import { describeValueType, errorName, sanitizeReason } from "../analytics/errors";
import type { PwaRegisterFailedData } from "../analytics/umami";

export interface RegisterEnv {
  readRegister: () => unknown;
  standalone: boolean;
  visibilityState: string;
}

function describeRegisterFunction(readRegister: () => unknown): PwaRegisterFailedData["registerFunction"] {
  let register: unknown;
  try {
    register = readRegister();
  } catch {
    return "unavailable";
  }
  return typeof register === "function" && Function.prototype.toString.call(register).includes("[native code]") ? "native" : "replaced";
}

export function describeRegisterFailure(error: unknown, env: RegisterEnv): PwaRegisterFailedData {
  return {
    reason: sanitizeReason(error),
    valueType: describeValueType(error),
    name: errorName(error),
    registerFunction: describeRegisterFunction(env.readRegister),
    displayMode: env.standalone ? "standalone" : "browser",
    visibilityState: env.visibilityState,
  };
}
