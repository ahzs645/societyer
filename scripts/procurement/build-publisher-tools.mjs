/**
 * Standalone server-side publisher tools for Zoer's backend (Node 22, Python 3
 * stdlib). Endpoint mode only: the Convex CLI login transport is replaced by a
 * stub, so nothing in this bundle can read or need a CLI login, tsx or
 * node_modules. Output: dist-procurement-publisher/ with a manifest of hashes.
 */
import { build } from "esbuild";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url))), out = join(root, "dist-procurement-publisher");
const tools = ["report-source-publication", "publish-catalog-service", "precompute-analytics"];
// export-convex.py imports integrity and (with --baseline) delta, and reads review-profile.json beside itself.
const python = ["export-convex.py", "integrity.py", "delta.py", "review-profile.json"];
const noOperatorClient = {
  name: "no-operator-client",
  setup(builder) {
    builder.onResolve({ filter: /(^|\/)operator-client$/ }, args => ({ path: args.path, namespace: "no-operator-client" }));
    builder.onLoad({ filter: /.*/, namespace: "no-operator-client" }, () => ({ loader: "js", contents: 'export function createPersistentOperator() { throw new Error("These publisher tools use --publisher-endpoint and --publisher-key-file only."); }' }));
  },
};

rmSync(out, { recursive: true, force: true });
await build({
  absWorkingDir: root, entryPoints: Object.fromEntries(tools.map(name => [name, `scripts/procurement/${name}.ts`])), outdir: out, outExtension: { ".js": ".mjs" },
  bundle: true, platform: "node", format: "esm", target: "node22", packages: "bundle", external: ["node:*"], plugins: [noOperatorClient], legalComments: "none",
  banner: { js: 'import { createRequire as publisherCreateRequire } from "node:module"; const require = publisherCreateRequire(import.meta.url);' },
});
mkdirSync(join(out, "python"));
for (const name of python) copyFileSync(join(root, "scripts/procurement", name), join(out, "python", name));

const files = {};
const walk = directory => { for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : 1)) { const path = join(directory, entry.name); if (entry.isDirectory()) walk(path); else files[relative(out, path)] = createHash("sha256").update(readFileSync(path)).digest("hex"); } };
walk(out);
const manifest = { schemaVersion: 1, societyerCommit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(), builtAt: new Date().toISOString(), node: "22", files };
writeFileSync(join(out, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(JSON.stringify({ output: relative(root, out), files: Object.keys(files).length, societyerCommit: manifest.societyerCommit }));
