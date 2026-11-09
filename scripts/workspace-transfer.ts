/**
 * Moves one workspace from a Convex export ZIP into a destination deployment
 * that already holds other workspaces, without touching their data.
 * Runbook: docs/shared-workspaces/migration-and-cutover.md#workspace-transfer
 *
 *   plan     --export <zip> --society <sourceSocietyId> [--out plan.json]
 *   apply    --export <zip> --society <id> --url <destination> --admin-key-env <VAR> --run <label> --source <label> [--note <text>]
 *   verify   --export <zip> --society <id> --url <destination> --admin-key-env <VAR> --run <label> [--out report.json]
 *   bind     --url <destination> --admin-key-env <VAR> --run <label> --mapping <csv> [--reason <text>]
 *   finalize --url <destination> --admin-key-env <VAR> --run <label> [--drop-public-slug]
 *   abort    --url <destination> --admin-key-env <VAR> --run <label>
 *   status   --url <destination> --admin-key-env <VAR> --run <label>
 *
 * The admin key is read only from the named environment variable and never printed.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { ConvexHttpClient } from "convex/browser";
import type { Value } from "convex/values";
import {
  abortTransfer, applyTransfer, bindMemberships, finalizeTransfer, parseBindCsv, planTransfer, transferStatus, verifyTransfer,
  type TransferDestination, type TransferPlanReport,
} from "./lib/workspaceTransfer";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    export: { type: "string" }, society: { type: "string" }, out: { type: "string" },
    url: { type: "string" }, "admin-key-env": { type: "string" }, run: { type: "string" },
    source: { type: "string" }, note: { type: "string" }, mapping: { type: "string" }, reason: { type: "string" },
    "drop-public-slug": { type: "boolean" },
  },
});
const command = positionals[0];
const log = (line: string) => console.log(line);

function need(name: keyof typeof values): string {
  const value = values[name];
  if (typeof value !== "string" || !value.trim()) throw new Error(`--${name} is required for ${command}.`);
  return value.trim();
}

function destination(): TransferDestination {
  const url = need("url");
  if (!/^https?:\/\/[^/\s]+\/?$/.test(url)) throw new Error("--url must be the destination's Convex URL (https://<name>.convex.cloud).");
  const envName = need("admin-key-env");
  if (!/^[A-Z_][A-Z0-9_]*$/.test(envName)) throw new Error("--admin-key-env takes an environment variable NAME, not a key.");
  const adminKey = process.env[envName];
  if (!adminKey) throw new Error(`Environment variable ${envName} is empty.`);
  const client = new ConvexHttpClient(url, { logger: false });
  // @internal in the installed SDK (absent from its declarations); `npx convex run`
  // uses the same pair (node_modules/convex/src/cli/lib/run.ts) to call internal functions.
  const admin = client as ConvexHttpClient & {
    setAdminAuth(token: string): void;
    function(name: string, component: undefined, args: Record<string, Value>): Promise<Value>;
  };
  admin.setAdminAuth(adminKey);
  const call = (name: string, args: Record<string, unknown>) => admin.function(name, undefined, args as Record<string, Value>);
  return {
    query: call,
    mutation: call,
    async uploadFile(runId, bytes, contentType) {
      const uploadUrl = await call("workspaceTransfer:generateUploadUrl", { runId });
      if (typeof uploadUrl !== "string") throw new Error("The destination returned no upload URL.");
      const response = await fetch(uploadUrl, { method: "POST", headers: { "Content-Type": contentType ?? "application/octet-stream" }, body: bytes });
      const body: unknown = await response.json().catch(() => null);
      const storageId = (body as { storageId?: unknown } | null)?.storageId;
      if (!response.ok || typeof storageId !== "string") throw new Error(`File upload failed (HTTP ${response.status}).`);
      return storageId;
    },
  };
}

function printPlan(report: TransferPlanReport) {
  log(`Workspace ${report.sourceSocietyName || "(unnamed)"} (${report.sourceSocietyId})`);
  log(`  ${report.rows} rows in ${Object.keys(report.tables).length} tables, ${report.files.count} files (${report.files.bytes} bytes), ${report.layers} insert layers`);
  log(`  export ${report.exportDigest.slice(0, 16)}…  plan ${report.planDigest.slice(0, 16)}…`);
  for (const finding of report.findings) {
    const where = [finding.table, finding.path].filter(Boolean).join(".");
    log(`  [${finding.severity}] ${finding.code}${where ? ` ${where}` : ""} ×${finding.count}: ${finding.message}${finding.samples.length ? ` e.g. ${finding.samples.slice(0, 3).join("; ")}` : ""}`);
  }
  log(report.ok ? "Plan OK: no blocking findings." : "Plan BLOCKED: resolve the blocking findings above.");
}

async function main() {
  switch (command) {
    case "plan": {
      const state = await planTransfer(need("export"), need("society"));
      printPlan(state.report);
      if (values.out) writeFileSync(values.out, `${JSON.stringify(state.report, null, 2)}\n`);
      await state.archive.close();
      return state.report.ok ? 0 : 1;
    }
    case "apply": {
      const dest = destination();
      const state = await planTransfer(need("export"), need("society"));
      printPlan(state.report);
      if (!state.report.ok) return 1;
      const result = await applyTransfer(state, dest, { label: need("run"), sourceDeployment: need("source"), ...(values.note ? { note: values.note } : {}), log });
      log(`Applied run ${need("run")}: ${result.inserted} rows inserted, ${result.files} files, ${result.rewritten} rows rewritten. Next: verify.`);
      await state.archive.close();
      return 0;
    }
    case "verify": {
      const dest = destination();
      const state = await planTransfer(need("export"), need("society"));
      const report = await verifyTransfer(state, dest, need("run"), log);
      for (const issue of [...report.serverIssues, ...report.problems]) log(`  ✗ ${issue}`);
      log(`files ${report.files.verified}/${report.files.planned}; totals ${JSON.stringify(report.totals.destination)}`);
      if (values.out) writeFileSync(values.out, `${JSON.stringify(report, null, 2)}\n`);
      log(report.ok ? "Verify PASSED. Next: finalize." : "Verify FAILED.");
      await state.archive.close();
      return report.ok ? 0 : 1;
    }
    case "bind": {
      const results = await bindMemberships(destination(), need("run"), parseBindCsv(readFileSync(need("mapping"), "utf8")), values.reason);
      for (const result of results) log(`  line ${result.line} ${result.who}: ${result.ok ? "✓" : "✗"} ${result.message}`);
      return results.every((result) => result.ok) ? 0 : 1;
    }
    case "finalize": {
      const result = await finalizeTransfer(destination(), need("run"), values["drop-public-slug"] === true);
      log(`Finalized: workspace ${String(result.societyId)} is open${result.publicSlug ? ` (public slug ${String(result.publicSlug)})` : ""}. Next: bind memberships.`);
      return 0;
    }
    case "abort": {
      const deleted = await abortTransfer(destination(), need("run"), log);
      log(`Aborted: ${deleted} rows and files removed.`);
      return 0;
    }
    case "status": {
      const run = await transferStatus(destination(), need("run"));
      log(JSON.stringify(run, null, 2));
      return 0;
    }
    default:
      log("Usage: workspace-transfer <plan|apply|verify|bind|finalize|abort|status> … (see the header of scripts/workspace-transfer.ts)");
      return 2;
  }
}

main().then((code) => process.exit(code), (error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
