#!/usr/bin/env node
/**
 * Cold-load timing + JS heap for the local (IndexedDB) runtime on a restored
 * browser profile. Reproducible measurement used by WP-K (see
 * docs/implementation-notes/wp-k-performance.md) and by the synthetic perf gate
 * (scripts/check-local-workspace-perf.mjs).
 *
 * Every route is measured in a FRESH browser process on the same persistent
 * profile ("cold": no JS heap or in-memory cache carried over, IndexedDB read
 * from disk, HTTP cache kept like a normal reload).
 *
 * Usage:
 *   node scripts/perf/measure-local-workspace.mjs --base http://127.0.0.1:4412 \
 *     --profile /path/to/restored-profile [--runs 1] [--out result.json] \
 *     [--routes /app,/app/meetings,meeting-detail,/app/documents]
 *
 * "meeting-detail" resolves to the first meeting linked from /app/meetings.
 * The script never prints record contents, only timings and sizes.
 */
import { chromium } from "../../node_modules/playwright/index.mjs";
import { writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const DEFAULT_ROUTES = [
  "/app",
  "/app/meetings",
  "meeting-detail",
  "/app/documents",
  "/app/imports",
  "/app/people-directory",
  "/app/tasks",
  "/app/members",
];

export function parseArgs(argv) {
  const out = { runs: 1, routes: DEFAULT_ROUTES, timeoutMs: 90_000 };
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    const value = argv[i + 1];
    if (key === "--base") (out.base = value), i++;
    else if (key === "--profile") (out.profile = value), i++;
    else if (key === "--runs") (out.runs = Number(value)), i++;
    else if (key === "--out") (out.out = value), i++;
    else if (key === "--routes") (out.routes = value.split(",").filter(Boolean)), i++;
    else if (key === "--timeout") (out.timeoutMs = Number(value)), i++;
    else if (key === "--label") (out.label = value), i++;
    else if (key === "--meeting-path") (out.meetingPath = value), i++;
  }
  return out;
}

/**
 * The page is "ready" when it has a visible h1, nothing is aria-busy, and the
 * route-specific content marker (if any) exists, held for two polls in a row.
 */
const ROUTE_MARKERS = {
  "/app/meetings": "table tbody tr td",
  "/app/documents": "table tbody tr, .empty-state, [data-empty-state]",
  "/app/imports": "h1",
  "/app/people-directory": "table tbody tr, a[href*='/app/people-directory/']",
  "/app/tasks": "h1",
  "/app/members": "h1",
};

async function waitReady(page, marker, timeoutMs) {
  await page.waitForFunction(
    (markerSelector) => {
      const w = window;
      const h1 = document.querySelector("main h1, .page h1, h1");
      const visible = h1 && h1.getBoundingClientRect().height > 0;
      const busy = document.querySelector('[aria-busy="true"]');
      const markerOk = !markerSelector || document.querySelector(markerSelector);
      const ok = Boolean(visible && !busy && markerOk);
      w.__perfReadyStreak = ok ? (w.__perfReadyStreak ?? 0) + 1 : 0;
      return w.__perfReadyStreak >= 3;
    },
    marker ?? null,
    { polling: 100, timeout: timeoutMs },
  );
}

async function heapMetrics(page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Performance.enable");
  const before = await cdp.send("Performance.getMetrics");
  await cdp.send("HeapProfiler.collectGarbage").catch(() => undefined);
  const after = await cdp.send("Performance.getMetrics");
  const pick = (metrics, name) => metrics.metrics.find((m) => m.name === name)?.value ?? null;
  await cdp.detach().catch(() => undefined);
  return {
    heapUsedMB: round(pick(before, "JSHeapUsedSize") / 1e6),
    heapUsedAfterGcMB: round(pick(after, "JSHeapUsedSize") / 1e6),
    heapTotalMB: round(pick(after, "JSHeapTotalSize") / 1e6),
    nodes: pick(after, "Nodes"),
    scriptDurationS: round(pick(after, "ScriptDuration")),
    taskDurationS: round(pick(after, "TaskDuration")),
  };
}

/** Runs in the page: meeting path of the largest persisted minutes record. */
async function pickHeaviestMeetingPath() {
  const open = (name) =>
    new Promise((resolve, reject) => {
      const request = indexedDB.open(name);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  const databases = (await indexedDB.databases()).filter((db) => db.name?.startsWith("societyer"));
  let best = null;
  for (const info of databases) {
    const db = await open(info.name);
    if (!db.objectStoreNames.contains("records")) {
      db.close();
      continue;
    }
    const stores = ["records", ...(db.objectStoreNames.contains("recordFields") ? ["recordFields"] : [])];
    const sizes = new Map();
    const meetingOf = new Map();
    const fieldSizes = new Map();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(stores, "readonly");
      const request = tx.objectStore("records").index("table").openCursor(IDBKeyRange.only("minutes"));
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        const value = cursor.value;
        if (!value.deletedAtISO && value.value?.meetingId) {
          meetingOf.set(value.key, value.value.meetingId);
          sizes.set(value.key, JSON.stringify(value.value).length);
        }
        cursor.continue();
      };
      if (stores.includes("recordFields")) {
        const fields = tx.objectStore("recordFields").openCursor();
        fields.onsuccess = () => {
          const cursor = fields.result;
          if (!cursor) return;
          if (String(cursor.value.key).startsWith("minutes:")) fieldSizes.set(cursor.value.key, JSON.stringify(cursor.value.fields ?? {}).length);
          cursor.continue();
        };
      }
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    for (const [key, size] of fieldSizes) if (sizes.has(key)) sizes.set(key, sizes.get(key) + size);
    for (const [key, size] of sizes) if (!best || size > best.size) best = { size, meetingId: meetingOf.get(key) };
    db.close();
  }
  return best ? `/app/meetings/${best.meetingId}` : undefined;
}

function withTimeout(promise, ms, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

function round(value) {
  return value == null ? null : Math.round(value * 100) / 100;
}

async function frameLatency(page) {
  const started = Date.now();
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0))));
  return Date.now() - started;
}

export async function measureRoute({ base, profile, route, timeoutMs, resolvedPath }) {
  const ctx = await chromium.launchPersistentContext(profile, {
    headless: true,
    executablePath: "/opt/pw-browsers/chromium",
    viewport: { width: 1440, height: 900 },
    args: ["--enable-precise-memory-info", "--js-flags=--expose-gc"],
  });
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error.message).slice(0, 200)));
  let crashed = false;
  page.on("crash", () => (crashed = true));
  const path = resolvedPath ?? route;
  const started = Date.now();
  let readyMs = null;
  let failure = null;
  try {
    await page.goto(base + path, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    await waitReady(page, ROUTE_MARKERS[route] ?? null, timeoutMs);
    readyMs = Date.now() - started;
  } catch (error) {
    failure = crashed ? "crashed" : String(error?.message ?? error).split("\n")[0].slice(0, 200);
  }
  let metrics = {};
  let latencyMs = null;
  if (!crashed) {
    try {
      latencyMs = await withTimeout(frameLatency(page), 60_000, "frame latency");
      metrics = await withTimeout(heapMetrics(page), 60_000, "heap metrics");
    } catch (error) {
      failure ??= String(error?.message ?? error).split("\n")[0].slice(0, 200);
    }
  }
  let discovered;
  if (route === "/app/meetings" && !failure) {
    // Pick the meeting of the largest minutes record straight from IndexedDB:
    // the heaviest detail page is the interesting one, and it is independent
    // of how the list renders.
    discovered = await withTimeout(page.evaluate(pickHeaviestMeetingPath), 60_000, "meeting lookup").catch(() => undefined);
  }
  await withTimeout(ctx.close(), 30_000, "close").catch(() => {
    // A crashed renderer can wedge the CDP connection; make sure the browser
    // holding this profile dies so the next cold launch can open it.
    try {
      execFileSync("pkill", ["-9", "-f", `--user-data-dir=${profile}`]);
    } catch {
      /* nothing left to kill */
    }
  });
  return { route, path, readyMs, latencyMs, ...metrics, failure, errors: errors.slice(0, 3), discovered };
}

export async function measureAll(options) {
  const results = [];
  let meetingDetailPath = options.meetingPath;
  for (let run = 0; run < options.runs; run++) {
    for (const route of options.routes) {
      let resolvedPath;
      if (route === "meeting-detail") {
        if (!meetingDetailPath) {
          const probe = await measureRoute({ ...options, route: "/app/meetings" });
          meetingDetailPath = probe.discovered;
        }
        if (!meetingDetailPath) {
          results.push({ route, run, failure: "no meeting link found" });
          continue;
        }
        resolvedPath = meetingDetailPath;
      }
      const result = await measureRoute({ ...options, route, resolvedPath });
      if (result.discovered && !meetingDetailPath) meetingDetailPath = result.discovered;
      delete result.discovered;
      results.push({ ...result, run });
      options.onResult?.(results);
      console.log(
        `${route.padEnd(24)} ready=${result.readyMs ?? "-"}ms heap=${result.heapUsedMB ?? "-"}MB (after GC ${result.heapUsedAfterGcMB ?? "-"}MB) nodes=${result.nodes ?? "-"} ${result.failure ? "FAIL " + result.failure : ""}`,
      );
    }
  }
  return results;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const options = parseArgs(process.argv.slice(2));
  if (!options.base || !options.profile) {
    console.error("usage: measure-local-workspace.mjs --base <url> --profile <dir> [--runs n] [--out file] [--routes a,b]");
    process.exit(2);
  }
  const save = (results) => {
    if (options.out) writeFileSync(options.out, JSON.stringify({ label: options.label, base: options.base, measuredAtISO: new Date().toISOString(), results }, null, 2));
  };
  const results = await measureAll({ ...options, onResult: save });
  save(results);
  process.exit(0);
}
