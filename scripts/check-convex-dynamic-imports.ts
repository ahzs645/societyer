/**
 * Convex queries and mutations run in its default isolate runtime, which
 * rejects dynamic `import()` at call time ("dynamic module import
 * unsupported"). The deploy still succeeds, so a lazy import ships as a
 * function that always fails. Only `"use node"` action files may use them.
 *
 * Bundles every isolate-runtime Convex module the way the Convex CLI does
 * (esbuild, ESM, code splitting) and fails on any dynamic import reachable
 * from one of them, including imports inside `shared/` code.
 */
import { build } from "esbuild";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const convexDir = join(root, "convex");

function convexModules(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "_generated" || name === "node_modules" ? [] : convexModules(path);
    return /\.(ts|tsx|js)$/.test(name) && !/\.(d|test)\.ts$/.test(name) ? [path] : [];
  });
}

const usesNode = (file: string) => /^\s*(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*["']use node["']/.test(readFileSync(file, "utf8"));
const entryPoints = convexModules(convexDir).filter((file) => !usesNode(file));

const result = await build({
  entryPoints,
  bundle: true,
  splitting: true,
  format: "esm",
  platform: "neutral",
  target: "esnext",
  outdir: join(root, "tmp/convex-dynamic-import-check"),
  write: false,
  metafile: true,
  packages: "external",
  logLevel: "silent",
  loader: { ".json": "json" },
  conditions: ["convex", "module"],
});

const violations = Object.entries(result.metafile.inputs).flatMap(([file, input]) =>
  input.imports
    .filter((entry) => entry.kind === "dynamic-import" && !entry.external)
    .map((entry) => `${relative(root, join(root, file))} → import("${entry.original ?? entry.path}")`),
);

if (violations.length) {
  console.error(`Dynamic imports reachable from Convex queries/mutations (they fail at runtime with "dynamic module import unsupported"):\n  ${violations.join("\n  ")}\nUse a static import, or move the code into a "use node" action.`);
  process.exit(1);
}
console.log(`Convex dynamic-import check passed: ${entryPoints.length} isolate-runtime modules, no reachable dynamic imports.`);
