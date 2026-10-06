#!/usr/bin/env node
/**
 * Derives portable-function registry entries from the Convex delegation files.
 *
 * Uses the same TypeScript syntax parser as the manifest gate, including
 * authorization wrappers, imported aliases/namespaces and dynamic imports.
 * Server-only/internal handlers are never emitted.
 *
 * Usage:
 *   node scripts/generate-portable-registry.mjs <module> [<module> ...]
 *
 * Emits, to stdout, the import lines and definePortableQuery/Mutation entries to
 * paste into shared/functions/registry.ts. This is a one-shot authoring aid, not
 * a build step — the registry stays hand-checked-in. The checked-in registry is
 * then enforced against the Convex delegations by scripts/portable-manifest.mjs
 * (`npm run test:portable-manifest`), which fails CI on any drift.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { scanModule } from "./portable-convex-scan.mjs";

const modules = process.argv.slice(2);
if (modules.length === 0) {
  console.error("usage: generate-portable-registry.mjs <module> [<module> ...]");
  process.exit(1);
}

const root = resolve(import.meta.dirname, "..");

/** Names + namespace-imported modules already present in the registry. */
function readExistingRegistry() {
  const names = new Set();
  const nsModules = new Map();
  try {
    const src = readFileSync(resolve(root, "shared/functions/registry.ts"), "utf8");
    for (const m of src.matchAll(/name:\s*"([^"]+)"/g)) names.add(m[1]);
    for (const m of src.matchAll(/import\s*\*\s*as\s+(\w+)\s+from\s+["']\.\/([\w-]+)["']/g)) nsModules.set(m[2], m[1]);
  } catch {
    /* first run: no registry yet */
  }
  return { names, nsModules };
}
const existing = readExistingRegistry();

const importsByModule = new Map(); // sharedModule -> Set<fn>  (for namespace imports we just need the module)
const entriesByModule = new Map(); // convexModule -> [{name, kind, fn, sharedModule}]

for (const mod of modules) {
  const source = readFileSync(resolve(root, "convex", `${mod}.ts`), "utf8");
  const entries = [];
  for (const d of scanModule(source, mod)) {
    if (!["portable", "capability-backed"].includes(d.classification) || existing.names.has(d.name)) continue;
    const handlers = new Map(d.delegates.map((h) => [`${h.sharedModule}:${h.fn}`, h]));
    if (handlers.size !== 1) throw new Error(`${d.name}: review multiple delegated handlers manually`);
    const { fn, sharedModule } = [...handlers.values()][0];
    if (!existing.nsModules.has(sharedModule)) importsByModule.set(sharedModule, true);
    entries.push({ exportName: d.export, kind: d.kind, fn, sharedModule, convexModule: mod });
  }
  entriesByModule.set(mod, entries);
}

const sharedModules = [...importsByModule.keys()].sort();
const importLines = sharedModules.map((m) => `import * as ${alias(m)} from "./${m}";`).join("\n");

function alias(sharedModule) {
  // Keep a stable, collision-free alias derived from the shared module name.
  return existing.nsModules.get(sharedModule) ?? `${sharedModule.replace(/-/g, "_")}Fns`;
}

let body = "";
for (const mod of modules) {
  const entries = entriesByModule.get(mod) ?? [];
  if (entries.length === 0) continue;
  body += `\n  // ${mod}\n`;
  for (const e of entries) {
    const define = e.kind === "query" ? "definePortableQuery" : "definePortableMutation";
    body += `  ${define}({ name: "${e.convexModule}:${e.exportName}", handler: ${alias(e.sharedModule)}.${e.fn} }),\n`;
  }
}

console.log("// ==== IMPORTS ====");
console.log(importLines);
console.log("// ==== ENTRIES ====");
console.log(body);
console.error(
  `\nGenerated ${[...entriesByModule.values()].reduce((n, e) => n + e.length, 0)} entries across ${modules.length} modules.`,
);
