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
  STATIC_UNSUPPORTED_WRITES,
  isStaticGenericCrud,
} from "../src/lib/staticConvexParity.ts";
import { inventoryFrontendWrites, inventoryExplicitDispatch } from "./lib/frontendWriteInventory";
import { PORTABLE_FUNCTION_NAMES } from "../shared/functions/registry.ts";

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

const { refs: frontendWrites, unresolved } = inventoryFrontendWrites(walk(srcDir).map((file) => ({
  fileName: path.relative(repoRoot, file), text: readFileSync(file, "utf8"),
})));
const explicitlyHandled = inventoryExplicitDispatch([
  staticConvexPath, path.join(srcDir, "lib", "staticLegacyDispatch.ts"), path.join(srcDir, "lib", "staticConvexYcn.ts"),
].map((file) => ({ fileName: file, text: readFileSync(file, "utf8") })));

// Functions ported to the portable ctx.db contract are handled by the live local
// runtime (PortableRuntime in staticConvex.ts), not the hand-written mirror.
const portableHandled = new Set(PORTABLE_FUNCTION_NAMES);

const isHandled = (name: string) =>
  explicitlyHandled.has(name) || isStaticGenericCrud(name) || portableHandled.has(name);

const summary = { handled: 0, noop: 0, pending: 0, unsupported: 0 };
const unclassified: string[] = [];

for (const [name, files] of frontendWrites) {
  if (isHandled(name)) summary.handled++;
  else if (STATIC_OFFLINE_NOOP_WRITES.has(name)) summary.noop++;
  else if (STATIC_PENDING_WRITES.has(name)) summary.pending++;
  else if (STATIC_UNSUPPORTED_WRITES.has(name)) summary.unsupported++;
  else unclassified.push(`${name}  (called from ${files[0]}${files.length > 1 ? ` +${files.length - 1} more` : ""})`);
}

// Anti-rot: a ledger entry that is now handled should be removed; an entry no
// longer called by the frontend is stale.
const ledger = [...STATIC_OFFLINE_NOOP_WRITES, ...STATIC_PENDING_WRITES, ...STATIC_UNSUPPORTED_WRITES.keys()];
const nowHandled = ledger.filter((name) => isHandled(name));
const stale = ledger.filter((name) => !frontendWrites.has(name) && !isHandled(name));

const errors: string[] = [];
if (unresolved.length) errors.push(`Unresolved frontend write hooks (do not silently omit):\n${unresolved.join("\n")}`);
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
  `Static-mirror source classification ok: ${frontendWrites.size} frontend writes ` +
    `(${summary.handled} handled, ${summary.noop} intentional offline no-ops, ` +
    `${summary.pending} pending/unimplemented, ${summary.unsupported} explicit capability rejections).`,
);
if (summary.pending) {
  console.log(
    `Note: ${summary.pending} write(s) do not yet persist offline (tracked in STATIC_PENDING_WRITES). ` +
      `They throw in dev and warn in production until a handler is added.`,
  );
}

console.log("Source classification is not a delivery guarantee. Runtime persistence and explicit unsupported-capability behavior require domain/browser tests.");
