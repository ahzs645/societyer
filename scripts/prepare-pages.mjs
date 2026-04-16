import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const distDir = resolve(process.cwd(), "dist");
const indexHtml = resolve(distDir, "index.html");

if (!existsSync(indexHtml)) {
  throw new Error(`Expected build output at ${indexHtml}`);
}

copyFileSync(indexHtml, resolve(distDir, "404.html"));
mkdirSync(resolve(distDir, "demo"), { recursive: true });
copyFileSync(indexHtml, resolve(distDir, "demo/index.html"));
writeFileSync(resolve(distDir, ".nojekyll"), "");
