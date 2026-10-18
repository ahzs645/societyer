/**
 * Installs the Zoer procurement review plugin bundle (contract §4) into this
 * app: copies dist/societyer-review/{index.js,style.css,source.json} into
 * public/plugins/bc-bid-monitor/ and pins their hashes in
 * src/features/procurementReview/lib/artifactPin.ts, which the page loads by.
 *
 *   tsx scripts/sync-procurement-review.ts [--from <dist/societyer-review>]
 *   tsx scripts/sync-procurement-review.ts --check   # installed files match the pin
 *
 * --from defaults to $ZOER_REVIEW_DIST, else files/dist/societyer-review beside the main Societyer
 * checkout (found through git, so it also works from a linked worktree)
 * beside this repository (the Zoer plugin checkout's `bun run societyer:build`).
 */
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const target = join(root, "public", "plugins", "bc-bid-monitor");
const pinPath = join(root, "src", "features", "procurementReview", "lib", "artifactPin.ts");
const FILES = ["index.js", "style.css"] as const;
const SHA256 = /^[a-f0-9]{64}$/;

const argument = (name: string) => {
  const index = process.argv.indexOf(`--${name}`);
  return index > 0 ? process.argv[index + 1] : undefined;
};
const fail = (message: string): never => {
  console.error(`sync-procurement-review: ${message}`);
  process.exit(1);
};
const digest = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");

type SourceInfo = { pluginId: string; pluginVersion: string; commit?: string; dirty?: boolean; builtAt?: string; sha256: Record<string, string> };

function readSource(directory: string): SourceInfo {
  const path = join(directory, "source.json");
  if (!existsSync(path)) fail(`No source.json in ${directory}. Build the bundle first (bun run societyer:build in the Zoer plugin checkout) or pass --from.`);
  let value: unknown;
  try { value = JSON.parse(readFileSync(path, "utf8")); } catch { fail(`${path} isn't valid JSON.`); }
  const source = value as Partial<SourceInfo> | null;
  if (!source || source.pluginId !== "bc-bid-monitor") fail("source.json is not for the bc-bid-monitor plugin.");
  if (typeof source!.pluginVersion !== "string" || !source!.pluginVersion) fail("source.json has no pluginVersion.");
  for (const file of FILES) {
    if (!SHA256.test(String(source!.sha256?.[file] ?? ""))) fail(`source.json has no sha256 for ${file}.`);
  }
  return source as SourceInfo;
}

function verify(directory: string, source: SourceInfo) {
  for (const file of FILES) {
    const path = join(directory, file);
    if (!existsSync(path)) fail(`${path} is missing.`);
    if (digest(path) !== source.sha256[file]) fail(`${path} doesn't match the sha256 in source.json.`);
  }
}

function pinSource(source: SourceInfo) {
  const pin = {
    pluginId: "bc-bid-monitor",
    pluginVersion: source.pluginVersion,
    ...(typeof source.commit === "string" ? { commit: source.commit } : {}),
    ...(typeof source.builtAt === "string" ? { builtAt: source.builtAt } : {}),
    sha256: { "index.js": source.sha256["index.js"], "style.css": source.sha256["style.css"] },
  };
  return [
    "// Written by scripts/sync-procurement-review.ts from the bundle's source.json. Do not edit by hand.",
    `import type { ReviewArtifactPin } from "./artifact";`,
    "",
    `export const REVIEW_ARTIFACT_PIN: ReviewArtifactPin | null = ${JSON.stringify(pin, null, 2)};`,
    "",
  ].join("\n");
}

if (process.argv.includes("--check")) {
  const pin = readFileSync(pinPath, "utf8");
  if (/REVIEW_ARTIFACT_PIN: ReviewArtifactPin \| null = null;/.test(pin)) {
    console.log("sync-procurement-review: no bundle is pinned; the page reports the plugin as not installed.");
    process.exit(0);
  }
  const source = readSource(target);
  verify(target, source);
  if (pin !== pinSource(source)) fail("artifactPin.ts doesn't match the installed source.json. Re-run the sync.");
  console.log(`sync-procurement-review: installed bundle ${source.pluginVersion} matches its pin.`);
  process.exit(0);
}

/** The main checkout's directory: a linked worktree shares its `.git`, so `../files` resolves the same from either. */
function mainCheckout(): string {
  try {
    return dirname(execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: root, encoding: "utf8" }).trim());
  } catch {
    return root;
  }
}

const from = resolve(argument("from") ?? process.env.ZOER_REVIEW_DIST ?? join(mainCheckout(), "..", "files", "dist", "societyer-review"));
const source = readSource(from);
verify(from, source);
if (source.dirty) console.warn("sync-procurement-review: the bundle was built from a dirty Zoer checkout.");
mkdirSync(target, { recursive: true });
for (const file of [...FILES, "source.json"]) copyFileSync(join(from, file), join(target, file));
writeFileSync(pinPath, pinSource(source));
console.log(`sync-procurement-review: installed bc-bid-monitor ${source.pluginVersion}${source.commit ? ` (${source.commit.slice(0, 12)})` : ""} into public/plugins/bc-bid-monitor/ and pinned it.`);
