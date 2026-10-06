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
import { scanModule, LOCAL_RUNTIME_VARIANTS } from "./portable-convex-scan.mjs";

const root = resolve(import.meta.dirname, "..");
const convexDir = resolve(root, "convex");
const manifestPath = resolve(root, "shared/functions/portable-manifest.json");
const registryPath = resolve(root, "shared/functions/registry.ts");
const docsPath = resolve(root, "docs/portable-functions-architecture.md");

const args = new Set(process.argv.slice(2));
const mode = args.has("--check") ? "check" : args.has("--report") ? "report" : "write";

/** Scan all top-level convex modules into a flat, classified function list. */
function scanConvex() {
  const functions = [];
  const files = readdirSync(convexDir)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".d.ts"))
    .sort();
  for (const file of files) {
    const module = basename(file, ".ts");
    const source = readFileSync(resolve(convexDir, file), "utf8");
    for (const { delegates: _delegates, ...fn } of scanModule(source, module)) {
      functions.push(fn);
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
  for (const [name, { handler }] of LOCAL_RUNTIME_VARIANTS) {
    const entry = src.match(new RegExp(`name:\\s*"${name}"[^}]*handler:\\s*([\\w.]+)`));
    if (entry && entry[1] !== handler) throw new Error(`${name}: expected reviewed local variant ${handler}, got ${entry[1]}`);
  }
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
  const expected = new Set([...portableNames, ...functions.filter((fn) => fn.localRuntimeVariant).map((fn) => fn.name)]);
  const missingFromRegistry = [...expected].filter((n) => !registered.has(n)).sort();
  const orphanedInRegistry = [...registered].filter((n) => !expected.has(n)).sort();

  const totals = {
    convexFunctions: functions.length,
    portable: buckets.portable.length,
    capabilityBacked: buckets["capability-backed"].length,
    serverOnly: buckets["server-only"].length,
    staticFallback: buckets["static-fallback"].length,
    registered: registered.size,
    localRuntimeVariants: functions.filter((fn) => fn.localRuntimeVariant).length,
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
    `  local variants:    ${totals.localRuntimeVariants} (included in registry; hosted classification retained)`,
  ].join("\n");
}

const { manifest, drift } = buildManifest();
const serialized = JSON.stringify(manifest, null, 2) + "\n";
const countsBlock = [
  "<!-- portable-manifest-counts:start -->",
  "Generated by `node scripts/portable-manifest.mjs`; checked by `--check`.",
  "",
  "| Manifest total | Count |",
  "| --- | ---: |",
  ...Object.entries(manifest.totals).map(([name, count]) => `| \`${name}\` | ${count} |`),
  "<!-- portable-manifest-counts:end -->",
].join("\n");
const docs = readFileSync(docsPath, "utf8");
const countsPattern = /<!-- portable-manifest-counts:start -->[\s\S]*?<!-- portable-manifest-counts:end -->/;
if (!countsPattern.test(docs)) throw new Error("Architecture doc is missing the generated manifest counts markers");
const updatedDocs = docs.replace(countsPattern, countsBlock);

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
  if (updatedDocs !== docs) writeFileSync(docsPath, updatedDocs);
  console.log(`Wrote ${manifestPath}`);
  console.log(summarize(manifest.totals));
  process.exit(0);
}

// mode === "check"
const errors = [];
if (updatedDocs !== docs) errors.push("Architecture doc manifest counts are stale. Run `node scripts/portable-manifest.mjs`.");

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
