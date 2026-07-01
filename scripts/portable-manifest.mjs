#!/usr/bin/env node
/**
 * PORTABLE FUNCTION MANIFEST — generated map of the Convex ⇄ portable boundary.
 *
 * The portable registry (shared/functions/registry.ts) is hand-checked-in, and
 * the architecture doc used to assert a hand-counted total ("796 functions",
 * which had already drifted to "773" elsewhere). This script replaces that prose
 * with a GENERATED, CI-CHECKED artifact.
 *
 * It statically scans every top-level convex/<module>.ts, classifies each
 * exported Convex function into one of four buckets, cross-checks the portable
 * buckets against the registry, and writes shared/functions/portable-manifest.json.
 *
 *   portable          query/mutation whose handler delegates to a shared function
 *                     via `toPortable{Query,Mutation}Ctx(ctx)` — runs unchanged on
 *                     hosted Convex and the local runtimes. MUST be registered.
 *   capability-backed same, but through `toPortable...Ctx(ctx, buildConvexCapabilities(ctx))`
 *                     — portable core, host-injected side effects. MUST be registered.
 *   server-only       action / internal{Query,Mutation,Action}, or a plain
 *                     query/mutation explicitly listed in EXPLICIT_SERVER_ONLY —
 *                     cannot run on a local store (scheduler, node providers, …).
 *   static-fallback   a plain query/mutation not (yet) delegating to a portable
 *                     handler — still served by the hand-written static mirror.
 *
 * Modes:
 *   node scripts/portable-manifest.mjs            # regenerate the manifest (write)
 *   node scripts/portable-manifest.mjs --check    # CI gate: fail on drift OR a
 *                                                 # stale checked-in manifest
 *   node scripts/portable-manifest.mjs --report   # print the summary, write nothing
 *
 * Drift the --check gate fails on:
 *   (A) a portable / capability-backed Convex export MISSING from the registry
 *       (it would silently 404 on the local runtimes), and
 *   (B) a registry entry ORPHANED — no Convex export delegates to it any more
 *       (a rename/revert the registry never caught up with).
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, basename } from "node:path";

const root = resolve(import.meta.dirname, "..");
const convexDir = resolve(root, "convex");
const manifestPath = resolve(root, "shared/functions/portable-manifest.json");
const registryPath = resolve(root, "shared/functions/registry.ts");

const args = new Set(process.argv.slice(2));
const mode = args.has("--check") ? "check" : args.has("--report") ? "report" : "write";

/**
 * Exports that delegate to a portable handler but are intentionally NOT part of
 * the local runtime surface, so they are classified server-only and NOT required
 * in the registry. Today: the bulk seed / demo-data maintenance mutations
 * (docs/portable-functions-architecture.md calls seed maintenance server-only).
 * The exclusion is per-function, not per-module — e.g. the same seed module's
 * `ensureForSociety` IS registered and portable. Keep this list small and
 * reviewed. Format: "module:exportName".
 */
const EXPLICIT_SERVER_ONLY = new Set([
  "seed:run",
  "seed:reset",
  "seedRecordTableMetadata:run",
  "seedRecordTableMetadata:runForSociety",
  "seedRecordTableMetadata:wipe",
]);

const KINDS = ["query", "mutation", "action", "internalQuery", "internalMutation", "internalAction"];
// Longer names first so the alternation prefers `internalMutation` over `mutation`.
const KIND_ALT = "internalMutation|internalQuery|internalAction|mutation|query|action";
const SERVER_ONLY_KINDS = new Set(["action", "internalQuery", "internalMutation", "internalAction"]);

/**
 * Split a module source into per-export blocks: { exportName, kind, block }.
 * Handles both `export const x = mutation({...})` and the cast form
 * `export const x = (query as any)({...})` used in a couple of modules.
 */
function splitExports(source) {
  const head = new RegExp(
    `export\\s+const\\s+(\\w+)\\s*=\\s*\\(?\\s*(${KIND_ALT})\\b(?:\\s+as\\s+\\w+)?\\s*\\)?\\s*\\(`,
    "g",
  );
  const boundaries = [];
  let m;
  while ((m = head.exec(source)) !== null) {
    boundaries.push({ exportName: m[1], kind: m[2], index: m.index });
  }
  return boundaries.map((b, i) => ({
    exportName: b.exportName,
    kind: b.kind,
    block: source.slice(b.index, i + 1 < boundaries.length ? boundaries[i + 1].index : source.length),
  }));
}

/** Identifiers imported from `../shared/functions/<mod>` (named imports). */
function sharedFunctionImports(source) {
  const names = new Set();
  const re = /import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*["']\.\.\/shared\/functions\/[\w-]+["']/g;
  let m;
  while ((m = re.exec(source)) !== null) {
    for (const raw of m[1].split(",")) {
      const id = raw.trim().split(/\s+as\s+/).pop()?.trim();
      if (id) names.add(id);
    }
  }
  return names;
}

/**
 * Detect a portable delegation anywhere in an export block. A Convex export is
 * portable when its handler delegates to a shared function. Three delegation
 * shapes appear in convex/:
 *   fn(toPortable{Query,Mutation}Ctx(ctx), ...)                     — portable
 *   fn(toPortable...Ctx(ctx, buildConvexCapabilities(ctx)), ...)    — capability-backed
 *   fn(withStorageCaps(ctx), ...)   // withStorageCaps == the caps form — capability-backed
 *   sharedFn()                      // pure, no ctx (catalog queries) — portable
 * Capabilities are threaded in via `buildConvexCapabilities(ctx)` or a
 * `with…Caps(ctx)` ctx wrapper. Returns { capability } or null.
 */
function detectDelegation(block, sharedNames) {
  const capability =
    /buildConvexCapabilities\(\s*ctx/.test(block) || /with\w*Caps\(\s*ctx/.test(block);
  if (/toPortable(?:Query|Mutation)Ctx\(\s*ctx/.test(block) || /with\w*Caps\(\s*ctx/.test(block)) {
    return { capability };
  }
  // Pure delegation: a call to a shared-imported `*Portable` handler with no ctx.
  for (const id of sharedNames) {
    if (id.endsWith("Portable") && new RegExp(`\\b${id}\\(`).test(block)) {
      return { capability };
    }
  }
  return null;
}

/** Scan all top-level convex modules into a flat, classified function list. */
function scanConvex() {
  const functions = [];
  const files = readdirSync(convexDir)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".d.ts"))
    .sort();
  for (const file of files) {
    const module = basename(file, ".ts");
    const source = readFileSync(resolve(convexDir, file), "utf8");
    const sharedNames = sharedFunctionImports(source);
    for (const { exportName, kind, block } of splitExports(source)) {
      const name = `${module}:${exportName}`;
      const deleg = detectDelegation(block, sharedNames);
      let classification;
      if (EXPLICIT_SERVER_ONLY.has(name)) {
        // Intentionally off the local surface even though it delegates.
        classification = "server-only";
      } else if (deleg) {
        classification = deleg.capability ? "capability-backed" : "portable";
      } else if (SERVER_ONLY_KINDS.has(kind)) {
        classification = "server-only";
      } else {
        classification = "static-fallback";
      }
      functions.push({ name, module, export: exportName, kind, classification });
    }
  }
  functions.sort((a, b) => a.name.localeCompare(b.name));
  return functions;
}

/** The set of `module:export` names registered in registry.ts. */
function readRegistryNames() {
  const src = readFileSync(registryPath, "utf8");
  const names = new Set();
  for (const m of src.matchAll(/name:\s*"([^"]+)"/g)) names.add(m[1]);
  return names;
}

function buildManifest() {
  const functions = scanConvex();
  const registered = readRegistryNames();

  const buckets = { portable: [], "capability-backed": [], "server-only": [], "static-fallback": [] };
  for (const fn of functions) buckets[fn.classification].push(fn.name);

  // Portable buckets must be registered; the registry must not reference names
  // no convex export delegates to any more.
  const portableNames = new Set([...buckets.portable, ...buckets["capability-backed"]]);
  const missingFromRegistry = [...portableNames].filter((n) => !registered.has(n)).sort();
  const orphanedInRegistry = [...registered].filter((n) => !portableNames.has(n)).sort();

  const totals = {
    convexFunctions: functions.length,
    portable: buckets.portable.length,
    capabilityBacked: buckets["capability-backed"].length,
    serverOnly: buckets["server-only"].length,
    staticFallback: buckets["static-fallback"].length,
    registered: registered.size,
  };

  return {
    manifest: {
      $comment:
        "GENERATED by scripts/portable-manifest.mjs — do not edit by hand. Run `npm run manifest:portable`.",
      totals,
      functions,
    },
    drift: { missingFromRegistry, orphanedInRegistry },
  };
}

function summarize(totals) {
  return [
    `  portable:          ${totals.portable}`,
    `  capability-backed: ${totals.capabilityBacked}`,
    `  server-only:       ${totals.serverOnly}`,
    `  static-fallback:   ${totals.staticFallback}`,
    `  ─────────────────────────`,
    `  convex functions:  ${totals.convexFunctions}`,
    `  registry entries:  ${totals.registered}`,
  ].join("\n");
}

const { manifest, drift } = buildManifest();
const serialized = JSON.stringify(manifest, null, 2) + "\n";

if (mode === "report") {
  console.log(summarize(manifest.totals));
  console.log(
    `\ndrift: ${drift.missingFromRegistry.length} missing from registry, ` +
      `${drift.orphanedInRegistry.length} orphaned in registry`,
  );
  process.exit(0);
}

if (mode === "write") {
  writeFileSync(manifestPath, serialized);
  console.log(`Wrote ${manifestPath}`);
  console.log(summarize(manifest.totals));
  process.exit(0);
}

// mode === "check"
const errors = [];

if (drift.missingFromRegistry.length) {
  errors.push(
    `${drift.missingFromRegistry.length} Convex function(s) delegate to a portable handler but are NOT in registry.ts ` +
      `(they will 404 on the local runtimes):\n` +
      drift.missingFromRegistry.map((n) => `  - ${n}`).join("\n") +
      `\nAdd them (see scripts/generate-portable-registry.mjs) and re-run \`npm run manifest:portable\`.`,
  );
}
if (drift.orphanedInRegistry.length) {
  errors.push(
    `${drift.orphanedInRegistry.length} registry entr(ies) have no matching portable Convex delegation ` +
      `(a rename/revert the registry never caught up with):\n` +
      drift.orphanedInRegistry.map((n) => `  - ${n}`).join("\n") +
      `\nRemove them from registry.ts or restore the Convex delegation, then re-run \`npm run manifest:portable\`.`,
  );
}

let checkedIn = null;
try {
  checkedIn = readFileSync(manifestPath, "utf8");
} catch {
  errors.push(`portable-manifest.json is missing. Run \`npm run manifest:portable\`.`);
}
if (checkedIn !== null && checkedIn !== serialized) {
  errors.push(
    `portable-manifest.json is stale: the checked-in manifest does not match the Convex source.\n` +
      `Run \`npm run manifest:portable\` and commit the result.`,
  );
}

if (errors.length) {
  console.error("Portable manifest check FAILED:\n\n" + errors.join("\n\n"));
  process.exit(1);
}

console.log("Portable manifest ok — registry in sync with Convex delegations.");
console.log(summarize(manifest.totals));
