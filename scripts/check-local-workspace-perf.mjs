#!/usr/bin/env node
/**
 * PERF GATE: cold loads of the local (IndexedDB) runtime on a large SYNTHETIC
 * workspace (scripts/perf/synthetic-workspace.mjs, no real data).
 *
 *   1. generate the synthetic backup (~200 MB at --scale 1, like a large
 *      transposed society: 10k documents with extracted text, minutes with
 *      verbatim source copies, thousands of occurrences and evidence rows);
 *   2. restore it through Settings → Restore into a fresh browser profile and
 *      wait for the post-restore projection warm-up;
 *   3. cold-load every gated route in a fresh browser process and assert the
 *      page is interactive under --max-ready-ms and the JS heap (at ready,
 *      before and after a forced GC) stays under --max-heap-mb.
 *
 * Needs a running local-runtime server, ideally a production build:
 *   VITE_RUNTIME_MODE=local-indexeddb npx vite build --outDir /tmp/perf-dist
 *   VITE_RUNTIME_MODE=local-indexeddb npx vite preview --outDir /tmp/perf-dist --port 4412 --strictPort
 *   npm run test:local-workspace-perf -- --base http://127.0.0.1:4412
 *
 * Options: --scale 1 --max-ready-ms 3000 --max-heap-mb 200 --runs 1
 *          --profile <dir> (default: fresh temp dir) --keep-profile --out <json>
 */
import { chromium } from "../node_modules/playwright/index.mjs";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildSyntheticWorkspace, summarizeWorkspace } from "./perf/synthetic-workspace.mjs";
import { measureRoute } from "./perf/measure-local-workspace.mjs";

function option(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const base = option("base", process.env.SOCIETYER_PERF_BASE ?? "http://127.0.0.1:4412");
const scale = Number(option("scale", "1"));
const maxReadyMs = Number(option("max-ready-ms", "3000"));
const maxHeapMb = Number(option("max-heap-mb", "200"));
const runs = Number(option("runs", "1"));
const out = option("out", undefined);
const keepProfile = process.argv.includes("--keep-profile");
const workDir = mkdtempSync(path.join(tmpdir(), "societyer-perf-"));
const profile = option("profile", path.join(workDir, "profile"));

const ROUTES = [
  "/app",
  "/app/meetings",
  "/app/meetings/meetings_syn_0",
  "/app/documents",
  "/app/imports",
  "/app/people-directory",
  "/app/tasks",
  "/app/members",
];

async function restore(backupPath) {
  const ctx = await chromium.launchPersistentContext(profile, {
    headless: true,
    executablePath: "/opt/pw-browsers/chromium",
    viewport: { width: 1440, height: 900 },
  });
  try {
    const page = ctx.pages()[0] ?? (await ctx.newPage());
    const started = Date.now();
    await page.goto(`${base}/app/settings?tab=runtime`, { waitUntil: "domcontentloaded" });
    const input = page.locator('input[type=file][accept*="zip"]').first();
    await input.waitFor({ state: "attached", timeout: 120_000 });
    await input.setInputFiles(backupPath);
    await page.getByRole("button", { name: /^Restore$/ }).last().click({ timeout: 120_000 });
    await page.getByText(/Backup restored|Restore failed/).first().waitFor({ timeout: 900_000 });
    const outcome = await page.getByText(/Backup restored|Restore failed/).first().locator("..").innerText();
    if (/failed/i.test(outcome)) throw new Error(`Restore failed: ${outcome}`);
    const restoreMs = Date.now() - started;
    // Let the background projection warm-up finish so the gated loads measure
    // a restored workspace, not a half-built memo.
    await page
      .waitForFunction(() => globalThis.__SOCIETYER_PROJECTION_WARMUP__ === "done", null, { timeout: 300_000, polling: 500 })
      .catch(() => console.warn("projection warm-up did not report completion"));
    return { restoreMs, warmedMs: Date.now() - started };
  } finally {
    await ctx.close();
  }
}

const failures = [];
const results = [];
try {
  const snapshot = buildSyntheticWorkspace({ scale });
  const summary = summarizeWorkspace(snapshot);
  console.log(`synthetic workspace: ${summary.rows} rows, ~${summary.megabytes} MB`);
  const backupPath = path.join(workDir, "synthetic-backup.json");
  writeFileSync(backupPath, JSON.stringify(snapshot));
  const restored = await restore(backupPath);
  console.log(`restored in ${(restored.restoreMs / 1000).toFixed(1)} s (warm-up done at ${(restored.warmedMs / 1000).toFixed(1)} s)`);

  for (let run = 0; run < runs; run++) {
    for (const route of ROUTES) {
      const result = await measureRoute({ base, profile, route, timeoutMs: 60_000 });
      delete result.discovered;
      results.push({ ...result, run });
      const heap = Math.max(result.heapUsedMB ?? Infinity, result.heapUsedAfterGcMB ?? Infinity);
      const ok = !result.failure && result.readyMs !== null && result.readyMs <= maxReadyMs && heap <= maxHeapMb;
      console.log(
        `${ok ? "✓" : "✗"} ${route.padEnd(32)} ready=${result.readyMs ?? "-"}ms heap=${result.heapUsedMB ?? "-"}MB (after GC ${result.heapUsedAfterGcMB ?? "-"}MB)${result.failure ? ` ${result.failure}` : ""}`,
      );
      if (result.errors?.length) console.log(`    page errors: ${result.errors.join(" | ")}`);
      if (!ok) failures.push(route);
    }
  }
  if (out) writeFileSync(out, JSON.stringify({ base, scale, maxReadyMs, maxHeapMb, summary, restored, results }, null, 2));
} finally {
  if (!keepProfile) rmSync(workDir, { recursive: true, force: true });
}

if (failures.length) {
  console.error(`\nLocal workspace perf gate FAILED for: ${[...new Set(failures)].join(", ")} (limits: ${maxReadyMs} ms, ${maxHeapMb} MB)`);
  process.exit(1);
}
console.log(`\nLocal workspace perf gate passed: every route interactive under ${maxReadyMs} ms with JS heap under ${maxHeapMb} MB.`);
process.exit(0);
