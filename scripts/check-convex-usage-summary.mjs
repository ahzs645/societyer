import assert from "node:assert/strict";
import { createUsageSummary } from "./summarize-convex-usage.mjs";

const summary = createUsageSummary();
const first = {
  kind: "Completion", identifier: "minutes:getByMeeting", udfType: "Query",
  executionId: "one", timestamp: 100, executionTime: 0.02, cachedResult: false,
  usageStats: { databaseReadBytes: 1000, databaseReadDocuments: 4 }, returnBytes: 300,
  logLines: ["private notes must not appear"], identity: "private-user@example.invalid",
};
summary.add(JSON.stringify(first));
summary.add(JSON.stringify(first));
summary.add(JSON.stringify({ ...first, executionId: "two", timestamp: 101, executionTime: 0.04, cachedResult: true, usageStats: { databaseReadBytes: 0 } }));
summary.add(JSON.stringify({ kind: "Progress", identifier: "minutes:getByMeeting", logLines: ["sensitive progress"] }));
summary.add(JSON.stringify({ kind: "Completion", identifier: "minutes:update", udfType: "Mutation", executionId: "three", timestamp: 102, error: "private-person error", willRetry: true, occInfo: { documentId: "private-document" } }));
summary.add(JSON.stringify({ kind: "Completion", identifier: "minutes:update", udfType: "Mutation", executionId: "three", timestamp: 103, executionTime: 0.01 }));
summary.add("not-json cli warning");
summary.add("null");
summary.add(JSON.stringify({ kind: "Completion", identifier: 2, udfType: "Query" }));
const result = summary.finish();
assert.equal(result.totals.completions, 4);
assert.equal(result.totals.failedCompletions, 1);
assert.equal(result.input.duplicateCompletions, 1);
assert.equal(result.input.invalidLines, 2);
assert.equal(result.input.ignoredEvents, 2);
assert.equal(result.window.firstCompletionAt, "1970-01-01T00:01:40.000Z");
const query = result.functions.find(row => row.type === "Query");
assert.equal(query.queryCacheHitRate, 0.5);
assert.equal(query.p50Ms, 20);
assert.equal(query.p95Ms, 40);
assert.equal(query.usageTotals.databaseReadBytes, 1000);
assert.equal(query.usageSamples.databaseReadBytes, 2);
assert.equal(query.usageSamples.databaseReadDocuments, 1);
assert.equal(query.usageTotals.databaseWriteBytes, undefined);
const mutation = result.functions.find(row => row.type === "Mutation");
assert.equal(mutation.completions, 2, "a retry with a new completion timestamp remains a separate event");
assert.equal(mutation.willRetryCompletions, 1);
assert.equal(mutation.occCompletions, 1);
assert.equal(mutation.returnBytes, null);
assert.equal(mutation.durationSamples, 1);
assert.doesNotMatch(JSON.stringify(result), /private-person|private-user|private-document|private notes|sensitive progress/);
const empty = createUsageSummary().finish();
assert.equal(empty.totals.completions, 0);
assert.equal(empty.window.firstCompletionAt, null);
console.log("Convex usage summary passed: completion-only counts, retries/deduplication, seconds-to-ms percentiles, metric coverage, invalid input, and private-log redaction.");
