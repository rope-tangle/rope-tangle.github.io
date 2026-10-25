import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const builds = { current: join(root, "dist"), next: join(root, "dist-next") };
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".png": "image/png",
  ".webmanifest": "application/manifest+json",
};
const port = Number(process.argv[2] ?? 4719);

createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const build = /(?:^|;\s*)build=(next|broken)(?:;|$)/.exec(req.headers.cookie ?? "")?.[1];
  const dir = build ? builds.next : builds.current;
  if (build === "broken" && url.pathname.startsWith("/assets/main-")) {
    res.writeHead(404).end();
    return;
  }
  let path = normalize(decodeURIComponent(url.pathname));
  if (path.endsWith(sep) || path.endsWith("/")) path = join(path, "index.html");
  const file = join(dir, path);
  if (!file.startsWith(dir + sep)) {
    res.writeHead(403).end();
    return;
  }
  readFile(file).then(
    (body) => {
      res.writeHead(200, { "Content-Type": types[extname(file)] ?? "application/octet-stream", "Cache-Control": "no-cache" });
      res.end(body);
    },
    () => res.writeHead(404).end(),
  );
}).listen(port, "localhost");
