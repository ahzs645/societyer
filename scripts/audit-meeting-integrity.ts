#!/usr/bin/env node
/** Offline only: do not add environment loading, clients, auth or repair calls. */
import { lstat, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { auditMeetingIntegrity } from "./lib/meetingIntegrityAudit";
import { integrityScopeTemplate, loadIntegrityInput, type IntegrityInput } from "./lib/meetingIntegrityInput";

const HELP = `Read-only Societyer meeting integrity audit (no network or database access).

node --import tsx scripts/audit-meeting-integrity.ts --input <file.zip|file.json|directory> [options]

  --output <file.json>          Write a new report file (default: stdout).
  --complete-snapshot           Assert an unmodified, completed Convex snapshot;
                                applies only to present tables, never missing ones.
  --scope-manifest <file.json>  Use a hash-bound completeness declaration instead.
  --write-scope-template <file> Write a new manifest template, without upgrading
                                unknown/partial coverage to complete.
  --society-id <id>             Inspect this workspace; foreign targets stay available
                                for detecting observed cross-workspace references.
  --component <archive-prefix> Select an exact Convex component prefix (default root).
  --verify-files                Check bundled Societyer file-manifest SHA-256 hashes.
  --max-record-mib <number>     Maximum total expanded record bytes (default 512).
  --max-rows <number>           Maximum supplied records (default 1000000).
  --max-files <number>          Maximum input entries (default 50000).
  --max-findings <number>       Maximum detailed findings (default 10000; counts stay full).
  --help                       Show this help.

Exit 0: no issues within declared scope; 1: confirmed errors in the export;
     2: invalid input/arguments or changed input; 3: review/coverage remains unresolved.
Existing files are never overwritten; outputs must be outside an input directory.
See docs/meeting-integrity-audit.md for scope, formats and historical-record limits.
`;

function parseArgs(argv: string[]) {
  const flags = new Set(["--complete-snapshot", "--verify-files", "--help"]);
  const valued = new Set(["--input", "--output", "--scope-manifest", "--write-scope-template", "--society-id", "--component", "--max-record-mib", "--max-rows", "--max-files", "--max-findings"]);
  const args = new Map<string, string | true>();
  for (let index = 0; index < argv.length; index++) {
    const key = argv[index];
    if (args.has(key)) throw new Error("An option was supplied more than once.");
    if (flags.has(key)) args.set(key, true);
    else if (valued.has(key)) {
      const value = argv[++index];
      if (value === undefined || !value || value.startsWith("--")) throw new Error("A command option is missing its value.");
      args.set(key, value);
    } else throw new Error("Unknown command option; use --help.");
  }
  return args;
}

async function newOutputPath(value: string, input: IntegrityInput, scopePath?: string) {
  const requested = path.resolve(value);
  const resolved = path.join(await realpath(path.dirname(requested)), path.basename(requested));
  const relative = path.relative(input.inputPath, resolved);
  if (resolved === input.inputPath || (input.inputIsDirectory && relative !== ".." && !relative.startsWith(".." + path.sep) && !path.isAbsolute(relative))) throw new Error("Output must be outside the input; no records were modified.");
  if (scopePath && resolved === await realpath(scopePath)) throw new Error("Output must not overwrite the scope declaration.");
  try { await lstat(resolved); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return resolved; throw error; }
  throw new Error("Output already exists; choose a new file. No files were overwritten.");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.has("--help")) { process.stdout.write(HELP); return; }
  const value = (key: string) => args.get(key) as string | undefined;
  const positive = (key: string) => {
    const raw = value(key);
    if (raw === undefined) return undefined;
    const count = Number(raw);
    if (!Number.isSafeInteger(count) || count < 1) throw new Error("Numeric options must be positive safe integers.");
    return count;
  };
  const inputPath = value("--input");
  if (!inputPath) throw new Error("--input is required; use --help.");
  const maxRecordMiB = positive("--max-record-mib");
  const input = await loadIntegrityInput(inputPath, {
    completeSnapshot: args.has("--complete-snapshot"), scopeManifest: value("--scope-manifest"),
    component: value("--component"), verifyFiles: args.has("--verify-files"),
    maxRecordBytes: maxRecordMiB === undefined ? undefined : maxRecordMiB * 1024 * 1024,
    maxRows: positive("--max-rows"), maxFiles: positive("--max-files"),
  });
  const output = value("--output") ? await newOutputPath(value("--output")!, input, value("--scope-manifest")) : undefined;
  const template = value("--write-scope-template") ? await newOutputPath(value("--write-scope-template")!, input, value("--scope-manifest")) : undefined;
  if (output && template && output === template) throw new Error("Report and scope template must use different output files.");
  const report = auditMeetingIntegrity(input, { societyId: value("--society-id"), maxFindings: positive("--max-findings") });
  if (!await input.verifyUnchanged()) throw new Error("Input changed during the audit. No report was accepted; repeat on an immutable copy.");
  const json = JSON.stringify({ ...report, inputUnchanged: true }, null, 2) + "\n";
  if (template) await writeFile(template, JSON.stringify(integrityScopeTemplate(input), null, 2) + "\n", { flag: "wx", mode: 0o600 });
  if (output) await writeFile(output, json, { flag: "wx", mode: 0o600 });
  else process.stdout.write(json);
  process.stderr.write(`Offline audit: ${report.outcome}; ${report.totals.inspectedRows} rows inspected, ${report.totals.findings} findings, ${report.totals.incompleteTables} incompletely covered tables. Input SHA-256 unchanged.\n`);
  process.exitCode = report.outcome === "issues-found-in-export" ? 1 : report.outcome === "no-issues-found-within-declared-scope" ? 0 : 3;
}

main().catch(error => {
  // Parser and format errors omit record content; filesystem errors omit paths.
  const message = error?.code && typeof error.code === "string" ? `Filesystem operation failed (${error.code}).` : error instanceof Error ? error.message : "Audit failed.";
  process.stderr.write(`Offline audit stopped: ${message}\n`);
  process.exitCode = 2;
});
