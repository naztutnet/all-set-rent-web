import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

const port = Number(process.env.PORT || 4173);
const root = process.cwd();
const types = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".mjs": "text/javascript", ".svg": "image/svg+xml" };

createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, `http://${request.headers.host}`).pathname);
    let file = path.join(root, pathname === "/" ? "index.html" : pathname);
    const info = await stat(file);
    if (info.isDirectory()) file = path.join(file, "index.html");
    response.writeHead(200, { "Content-Type": `${types[path.extname(file)] || "application/octet-stream"}; charset=utf-8` });
    response.end(await readFile(file));
  } catch {
    response.writeHead(404);
    response.end("Not found");
  }
}).listen(port, () => console.log(`ALL SET RENT: http://localhost:${port}`));
