// Minimal ambient decls for the Node builtins the test helpers use. Not
// `@types/node`: `tsconfig.json` also covers `src`, which runs in a browser.
declare module "node:child_process" {
  export function spawnSync(
    file: string,
    args: readonly string[],
    options?: { encoding?: "utf8"; timeout?: number },
  ): {
    status: number | null;
    signal: string | null;
    stdout: string | null;
    stderr: string | null;
  };
}

declare module "node:process" {
  const process: {
    readonly pid: number;
    readonly ppid: number;
    readonly execPath: string;
    readonly env: Record<string, string | undefined>;
    kill(pid: number, signal?: string | number): true;
  };
  export default process;
}

declare module "node:timers" {
  export function setInterval(callback: () => void, ms: number): { unref(): void };
}

declare module "node:worker_threads" {
  export class Worker {
    constructor(source: string, options: { eval: true; execArgv?: string[]; workerData?: unknown });
    postMessage(value: unknown, transferList: readonly unknown[]): void;
    unref(): void;
  }
}
