#!/usr/bin/env node
/**
 * Aggregate `convex logs --jsonl` locally. No network or credentials required.
 * The report deliberately excludes identities, arguments, log messages and
 * error text. A captured log window is not a monthly bill or a user count.
 */
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const RESOURCE_FIELDS = [
  "databaseIoReadBytes", "databaseIoWriteBytes", "databaseReadBytes",
  "databaseReadDocuments", "databaseWriteBytes", "networkEgressBytes",
  "storageReadBytes", "storageWriteBytes", "textIndexQueryBytes",
  "textIndexWriteQueryBytes", "vectorIndexReadBytes", "vectorIndexWriteBytes",
];
const finite = value => typeof value === "number" && Number.isFinite(value) && value >= 0;
const iso = seconds => seconds === null ? null : new Date(seconds * 1000).toISOString();

export function createUsageSummary() {
  const functions = new Map();
  const seen = new Set();
  let lines = 0, invalidLines = 0, ignoredEvents = 0, duplicates = 0;
  let startedAt = null, endedAt = null;

  return {
    add(line) {
      if (!String(line).trim()) return;
      lines += 1;
      let event;
      try { event = JSON.parse(line); }
      catch { invalidLines += 1; return; }
      if (!event || event.kind !== "Completion") { ignoredEvents += 1; return; }
      if (typeof event.identifier !== "string" || !["Query", "Mutation", "Action", "HttpAction"].includes(event.udfType)) {
        invalidLines += 1; return;
      }
      const component = typeof event.componentPath === "string" ? event.componentPath : "";
      // Retries can share an execution ID. Include the completion timestamp so
      // only repeated copies of the same event are dropped.
      if (typeof event.executionId === "string" && finite(event.timestamp)) {
        const key = JSON.stringify([component, event.identifier, event.executionId, event.timestamp]);
        if (seen.has(key)) { duplicates += 1; return; }
        seen.add(key);
      }
      if (finite(event.timestamp) && event.timestamp < 8.64e12) {
        startedAt = startedAt === null ? event.timestamp : Math.min(startedAt, event.timestamp);
        endedAt = endedAt === null ? event.timestamp : Math.max(endedAt, event.timestamp);
      }
      const key = JSON.stringify([component, event.identifier, event.udfType]);
      let row = functions.get(key);
      if (!row) {
        row = {
          component: component || null, function: event.identifier, type: event.udfType,
          completions: 0, failedCompletions: 0, cachedCompletions: 0, cacheSamples: 0,
          willRetryCompletions: 0, occCompletions: 0, durations: [],
          usageTotals: {}, usageSamples: {}, returnBytes: 0, returnByteSamples: 0,
        };
        functions.set(key, row);
      }
      row.completions += 1;
      if (event.error !== null && event.error !== undefined && event.error !== "") row.failedCompletions += 1;
      if (event.cachedResult === true) row.cachedCompletions += 1;
      if (typeof event.cachedResult === "boolean") row.cacheSamples += 1;
      if (event.willRetry === true) row.willRetryCompletions += 1;
      if (event.occInfo) row.occCompletions += 1;
      if (finite(event.executionTime)) row.durations.push(event.executionTime * 1000);
      if (finite(event.returnBytes)) { row.returnBytes += event.returnBytes; row.returnByteSamples += 1; }
      for (const field of RESOURCE_FIELDS) {
        const value = event.usageStats?.[field];
        if (!finite(value)) continue;
        row.usageTotals[field] = (row.usageTotals[field] ?? 0) + value;
        row.usageSamples[field] = (row.usageSamples[field] ?? 0) + 1;
      }
    },
    finish() {
      const rows = [...functions.values()].map(row => {
        const { durations, returnBytes, returnByteSamples, ...rest } = row;
        durations.sort((a, b) => a - b);
        const percentile = q => durations.length ? durations[Math.max(0, Math.ceil(durations.length * q) - 1)] : null;
        return {
          ...rest,
          failureRate: row.failedCompletions / row.completions,
          queryCacheHitRate: row.type === "Query" && row.cacheSamples ? row.cachedCompletions / row.cacheSamples : null,
          durationSamples: durations.length, p50Ms: percentile(0.5), p95Ms: percentile(0.95),
          maxMs: durations.at(-1) ?? null,
          totalExecutionMs: durations.length ? durations.reduce((a, b) => a + b, 0) : null,
          returnBytes: returnByteSamples ? returnBytes : null, returnByteSamples,
        };
      }).sort((a, b) =>
        (b.usageTotals.databaseReadBytes ?? 0) - (a.usageTotals.databaseReadBytes ?? 0) || b.completions - a.completions || a.function.localeCompare(b.function));
      return {
        kind: "societyer.convex-log-usage-summary", version: 1,
        scope: "Only the supplied completion events; not billing totals, monthly projections, unique users, or page views.",
        window: { firstCompletionAt: iso(startedAt), lastCompletionAt: iso(endedAt) },
        input: { lines, invalidLines, ignoredEvents, duplicateCompletions: duplicates },
        totals: {
          functions: rows.length,
          completions: rows.reduce((sum, row) => sum + row.completions, 0),
          failedCompletions: rows.reduce((sum, row) => sum + row.failedCompletions, 0),
        },
        metricCoverage: "usageSamples reports coverage for each metric; missing metrics are absent, never assumed zero. CLI completion records can omit cached subscriber deliveries; use the dashboard for billing and total cache-hit reporting.",
        functions: rows,
      };
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const source = process.argv[2];
  if (source === "--help" || process.argv.length > 3) {
    console.log("Usage: node scripts/summarize-convex-usage.mjs [logs.jsonl|-]\nReads a Convex CLI JSONL export or stdin; writes aggregate JSON without raw messages or identities.");
    process.exitCode = process.argv.length > 3 ? 1 : 0;
  } else {
    try {
      const summary = createUsageSummary();
      const input = !source || source === "-" ? process.stdin : createReadStream(source, { encoding: "utf8" });
      for await (const line of createInterface({ input, crlfDelay: Infinity })) summary.add(line);
      console.log(JSON.stringify(summary.finish(), null, 2));
    } catch {
      console.error("Could not read the log export. Check the local file path and permissions.");
      process.exitCode = 1;
    }
  }
}
