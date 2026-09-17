import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const dist = path.join(root, "dist");

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

for (const file of ["index.html", "styles.css"]) {
  if (!existsSync(path.join(root, file))) throw new Error(`Missing ${file}`);
  await cp(path.join(root, file), path.join(dist, file));
}

await cp(path.join(root, "src"), path.join(dist, "src"), { recursive: true });
await cp(path.join(root, "assets"), path.join(dist, "assets"), { recursive: true });

const html = await readFile(path.join(dist, "index.html"), "utf8");
const required = ["id=\"catalog\"", "id=\"kits\"", "id=\"long-term\"", "id=\"payment\""];
for (const marker of required) {
  if (!html.includes(marker)) throw new Error(`Required section missing: ${marker}`);
}

const manifest = {
  builtAt: new Date().toISOString(),
  entry: "index.html",
  backendIntegration: "adapter-ready",
};
await writeFile(path.join(dist, "build-manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log("Build complete: dist/");
