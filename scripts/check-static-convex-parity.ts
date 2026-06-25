// Static-mirror write parity gate.
//
// The static Convex mirror (src/lib/staticConvex.ts) re-implements the backend
// for the offline/desktop runtime. If the frontend calls a mutation/action the
// mirror does not handle, the write used to vanish silently. This gate fails
// when a frontend write is neither handled by the mirror nor classified in the
// parity ledger (src/lib/staticConvexParity.ts), so a new silent gap cannot be
// introduced. It also flags ledger entries that have since become handled (so
// the ledger cannot rot) and prints a coverage summary.

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  STATIC_OFFLINE_NOOP_WRITES,
  STATIC_PENDING_WRITES,
  isStaticGenericCrud,
} from "../src/lib/staticConvexParity.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const srcDir = path.join(repoRoot, "src");
const staticConvexPath = path.join(srcDir, "lib", "staticConvex.ts");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

// (1) Every mutation/action the frontend invokes, as "module:fn". Convex
// function references can be nested (api.dir.module.fn -> "dir/module:fn"); the
// last two path segments give the "module:fn" the static mirror dispatches on.
function collectFrontendWrites(): Map<string, string[]> {
  const refs = new Map<string, string[]>();
  const pattern = /use(?:Mutation|Action)\(\s*api((?:\.[a-zA-Z0-9_]+)+)\s*\)/g;
  for (const file of walk(srcDir)) {
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(pattern)) {
      const segments = match[1].split(".").filter(Boolean);
      if (segments.length < 2) continue;
      const name = `${segments[segments.length - 2]}:${segments[segments.length - 1]}`;
      const list = refs.get(name) ?? [];
      list.push(path.relative(repoRoot, file));
      refs.set(name, list);
    }
  }
  return refs;
}

// (2) Names the mirror handles explicitly, i.e. any "module:fn" string literal
// in staticConvex.ts (handlers are `name === "module:fn"` / switch(name) cases).
function collectExplicitlyHandled(): Set<string> {
  // The mirror is split across staticConvex.ts and its domain sibling modules
  // (e.g. staticConvexYcn.ts) that staticConvex.ts delegates to. Scan all of them.
  const mirrorFiles = [staticConvexPath, path.join(srcDir, "lib", "staticConvexYcn.ts")];
  const handled = new Set<string>();
  for (const file of mirrorFiles) {
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(/["']([a-zA-Z][a-zA-Z0-9]*:[a-zA-Z][a-zA-Z0-9]*)["']/g)) {
      handled.add(match[1]);
    }
  }
  return handled;
}

const frontendWrites = collectFrontendWrites();
const explicitlyHandled = collectExplicitlyHandled();

const isHandled = (name: string) =>
  explicitlyHandled.has(name) || isStaticGenericCrud(name);

const summary = { handled: 0, noop: 0, pending: 0 };
const unclassified: string[] = [];

for (const [name, files] of frontendWrites) {
  if (isHandled(name)) summary.handled++;
  else if (STATIC_OFFLINE_NOOP_WRITES.has(name)) summary.noop++;
  else if (STATIC_PENDING_WRITES.has(name)) summary.pending++;
  else unclassified.push(`${name}  (called from ${files[0]}${files.length > 1 ? ` +${files.length - 1} more` : ""})`);
}

// Anti-rot: a ledger entry that is now handled should be removed; an entry no
// longer called by the frontend is stale.
const ledger = [...STATIC_OFFLINE_NOOP_WRITES, ...STATIC_PENDING_WRITES];
const nowHandled = ledger.filter((name) => isHandled(name));
const stale = ledger.filter((name) => !frontendWrites.has(name) && !isHandled(name));

const errors: string[] = [];
if (unclassified.length) {
  errors.push(
    `${unclassified.length} frontend write(s) are neither handled by the static mirror nor classified in staticConvexParity.ts:\n` +
      unclassified.map((line) => `  - ${line}`).join("\n") +
      `\nAdd a handler in staticConvex.ts, or add the name to STATIC_OFFLINE_NOOP_WRITES / STATIC_PENDING_WRITES.`,
  );
}
if (nowHandled.length) {
  errors.push(
    `${nowHandled.length} ledger entr(ies) are now handled by the mirror and must be removed from staticConvexParity.ts:\n` +
      nowHandled.map((name) => `  - ${name}`).join("\n"),
  );
}

if (stale.length) {
  console.warn(
    `Warning: ${stale.length} ledger entr(ies) are no longer called by the frontend (safe to prune):\n` +
      stale.map((name) => `  - ${name}`).join("\n"),
  );
}

if (errors.length) {
  throw new Error(errors.join("\n\n"));
}

console.log(
  `Static-mirror parity ok: ${frontendWrites.size} frontend writes ` +
    `(${summary.handled} handled, ${summary.noop} intentional offline no-ops, ` +
    `${summary.pending} pending/unimplemented).`,
);
if (summary.pending) {
  console.log(
    `Note: ${summary.pending} write(s) do not yet persist offline (tracked in STATIC_PENDING_WRITES). ` +
      `They throw in dev and warn in production until a handler is added.`,
  );
}
