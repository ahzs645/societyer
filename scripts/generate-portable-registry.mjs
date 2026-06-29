#!/usr/bin/env node
/**
 * Derives portable-function registry entries from the Convex delegation files.
 *
 * For each convex/<module>.ts, finds every `export const <name> = query|mutation(...)`
 * whose handler delegates to a portable function via
 * `=> <fn>(toPortableQueryCtx(ctx)` / `toPortableMutationCtx(ctx)`, and resolves
 * <fn> to its shared module from that file's `../shared/functions/<mod>` imports.
 *
 * Usage:
 *   node scripts/generate-portable-registry.mjs <module> [<module> ...]
 *
 * Emits, to stdout, the import lines and definePortableQuery/Mutation entries to
 * paste into shared/functions/registry.ts. This is a one-shot authoring aid, not
 * a build step — the registry stays hand-checked-in.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const modules = process.argv.slice(2);
if (modules.length === 0) {
  console.error("usage: generate-portable-registry.mjs <module> [<module> ...]");
  process.exit(1);
}

const root = resolve(import.meta.dirname, "..");

/** Parse `import { a, b } from "../shared/functions/<mod>"` (multi/single line). */
function parseSharedImports(source) {
  const fnToModule = new Map();
  const re = /import\s*\{([^}]*)\}\s*from\s*["']\.\.\/shared\/functions\/([\w-]+)["']/g;
  let m;
  while ((m = re.exec(source)) !== null) {
    const names = m[1]
      .split(",")
      .map((s) => s.trim().split(/\s+as\s+/)[0].trim())
      .filter(Boolean);
    for (const name of names) fnToModule.set(name, m[2]);
  }
  return fnToModule;
}

/** Find delegated exports: name, kind, the portable fn it calls. */
function parseDelegations(source) {
  const out = [];
  const re = /export\s+const\s+(\w+)\s*=\s*(query|mutation)\s*\(/g;
  let m;
  while ((m = re.exec(source)) !== null) {
    const exportName = m[1];
    const kind = m[2];
    // Scan from this export to the next top-level `export const` for the delegation.
    const start = m.index;
    const nextRe = /export\s+const\s+\w+\s*=\s*(?:query|mutation|action|internalMutation|internalQuery)\s*\(/g;
    nextRe.lastIndex = re.lastIndex;
    const next = nextRe.exec(source);
    const block = source.slice(start, next ? next.index : source.length);
    const deleg = block.match(/=>\s*(\w+)\(\s*toPortable(?:Query|Mutation)Ctx\(ctx\)/);
    if (deleg) {
      out.push({ exportName, kind, fn: deleg[1] });
    }
  }
  return out;
}

const importsByModule = new Map(); // sharedModule -> Set<fn>  (for namespace imports we just need the module)
const entriesByModule = new Map(); // convexModule -> [{name, kind, fn, sharedModule}]

for (const mod of modules) {
  const source = readFileSync(resolve(root, "convex", `${mod}.ts`), "utf8");
  const fnToModule = parseSharedImports(source);
  const delegations = parseDelegations(source);
  const entries = [];
  for (const d of delegations) {
    const sharedModule = fnToModule.get(d.fn);
    if (!sharedModule) {
      console.error(`WARN ${mod}:${d.exportName} -> ${d.fn} has no shared import`);
      continue;
    }
    if (!importsByModule.has(sharedModule)) importsByModule.set(sharedModule, true);
    entries.push({ ...d, sharedModule, convexModule: mod });
  }
  entriesByModule.set(mod, entries);
}

const sharedModules = [...importsByModule.keys()].sort();
const importLines = sharedModules.map((m) => `import * as ${alias(m)} from "./${m}";`).join("\n");

function alias(sharedModule) {
  // Keep a stable, collision-free alias derived from the shared module name.
  return `${sharedModule.replace(/-/g, "_")}Fns`;
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
