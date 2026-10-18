import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runnerImport } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const load = async (path) => (await runnerImport(`${root}${path}`)).module;
const { generateBoard } = await load("src/generate/generate.ts");
const { toSnapshot } = await load("src/engine/snapshot.ts");
const { encodeReady } = await load("src/game/records.ts");
const { ROPE_COUNTS } = await load("src/board/board.ts");

mkdirSync(`${root}src/game/bundled`, { recursive: true });
for (const ropes of ROPE_COUNTS) {
  const g = generateBoard(ropes * 1000 + 1, ropes);
  const record = encodeReady({ ropes, seed: g.seed, generationMs: 0, tries: g.tries, bundled: true, snapshot: toSnapshot(g.engine) });
  writeFileSync(`${root}src/game/bundled/ready-${ropes}.json`, `${JSON.stringify(record)}\n`);
  console.log(`ready-${ropes}.json: seed ${g.seed}, ${g.tries} tries`);
}
