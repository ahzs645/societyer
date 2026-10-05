import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { gzipSync } from "node:zlib";

const argumentsList = process.argv.slice(2);
const argument = (name, fallback) => {
  const index = argumentsList.indexOf(name);
  return index < 0 ? fallback : argumentsList[index + 1];
};
const buildDirectory = resolve(argument("--build-dir", "dist"));
const outputPath = argument("--output", undefined);
const baselineDirectory = argument("--baseline", undefined);

async function measure(directory) {
  const manifest = JSON.parse(await readFile(resolve(directory, ".vite/manifest.json"), "utf8"));
  const named = (name) => Object.keys(manifest).find((key) => manifest[key].name === name);
  const required = (name) => {
    const key = named(name);
    if (!key) throw new Error(`Build manifest is missing ${name}.`);
    return key;
  };
  const appShell = named("Layout");
  const appEntries = ["index.html", ...(appShell ? [appShell] : [])];
  const entries = {
    bootstrap: ["index.html"],
    landing: ["index.html", required("Landing")],
    betterAuthDashboard: [...appEntries, required("Dashboard"), required("convex"), required("authClient")],
    clerkDashboard: [...appEntries, required("Dashboard"), required("convex"), required("ClerkAuthProvider")],
    localDashboard: [...appEntries, required("Dashboard"), required("localDataClient")],
  };
  const sizes = new Map();
  async function size(file) {
    if (!sizes.has(file)) {
      const bytes = await readFile(resolve(directory, file));
      sizes.set(file, { rawBytes: bytes.length, gzipBytes: gzipSync(bytes, { level: 9 }).length });
    }
    return sizes.get(file);
  }
  const scenarios = {};
  for (const [label, roots] of Object.entries(entries)) {
    const visited = new Set();
    function visit(key) {
      if (visited.has(key)) return;
      if (!manifest[key]) throw new Error(`Build manifest has a broken import: ${key}`);
      visited.add(key);
      for (const dependency of manifest[key].imports ?? []) visit(dependency);
    }
    roots.forEach(visit);
    const files = [...new Set([...visited].flatMap((key) => [manifest[key].file, ...(manifest[key].css ?? [])]))].sort();
    let rawBytes = 0;
    let gzipBytes = 0;
    for (const file of files) {
      const measured = await size(file);
      rawBytes += measured.rawBytes;
      gzipBytes += measured.gzipBytes;
    }
    scenarios[label] = { rawBytes, gzipBytes, assetCount: files.length, assets: files };
  }
  const chunks = [];
  for (const value of Object.values(manifest)) {
    if (!value.file.endsWith(".js")) continue;
    chunks.push({ name: value.name, asset: value.file, ...(await size(value.file)) });
  }
  chunks.sort((left, right) => right.gzipBytes - left.gzipBytes);
  return { scenarios, largestJavaScriptChunks: chunks.slice(0, 12) };
}

const current = await measure(buildDirectory);
const baseline = baselineDirectory ? await measure(resolve(baselineDirectory)) : undefined;
const budgets = { bootstrap: 400_000, landing: 425_000, betterAuthDashboard: 550_000, clerkDashboard: 625_000, localDashboard: 900_000 };
const comparison = baseline ? Object.fromEntries(Object.keys(current.scenarios).map((key) => [key, {
  beforeGzipBytes: baseline.scenarios[key].gzipBytes,
  afterGzipBytes: current.scenarios[key].gzipBytes,
  reductionPercent: Number(((1 - current.scenarios[key].gzipBytes / baseline.scenarios[key].gzipBytes) * 100).toFixed(2)),
}])) : undefined;
const failures = Object.entries(budgets).filter(([key, budget]) => current.scenarios[key].gzipBytes > budget)
  .map(([key, budget]) => `${key}: ${current.scenarios[key].gzipBytes} gzip bytes exceeds ${budget}`);
const report = {
  measuredAt: new Date().toISOString(),
  method: "Deduplicated transitive static-import closure per scenario, including JavaScript and CSS. gzip level 9 per asset; excludes HTML, fonts, WASM, external provider scripts, and optional dynamic feature chunks. This is build transfer size, not a network or Lighthouse timing score.",
  budgetsGzipBytes: budgets,
  current,
  ...(baseline ? { baseline, comparison } : {}),
  failures,
};
if (outputPath) {
  const destination = resolve(outputPath);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, `${JSON.stringify(report, null, 2)}\n`);
}
for (const [key, measured] of Object.entries(current.scenarios)) {
  console.log(`${key}: ${measured.gzipBytes} gzip bytes (${measured.assetCount} transitive JS/CSS assets)`);
}
if (comparison) console.log(JSON.stringify(comparison, null, 2));
if (failures.length) throw new Error(`Frontend bundle budget failed:\n${failures.join("\n")}`);
console.log("Frontend bundle budgets passed.");
