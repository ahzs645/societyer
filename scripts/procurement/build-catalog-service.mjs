import { build } from "esbuild";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
await build({ absWorkingDir: root, entryPoints: Object.fromEntries(["main", "activation-worker", "analysis-worker", "qualification-worker"].map(name => [name, `server/procurement-catalog/${name}.ts`])), outdir: "dist-procurement-catalog", outExtension: { ".js": ".mjs" }, bundle: true, platform: "node", format: "esm", target: "node22", packages: "bundle", external: ["node:*"], banner: { js: 'import { createRequire as catalogCreateRequire } from "node:module"; const require = catalogCreateRequire(import.meta.url);' }, sourcemap: true });
