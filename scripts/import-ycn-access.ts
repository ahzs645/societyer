/**
 * One-shot importer for a YCN BC-corporate-records Access database (`.accdb`).
 *
 * Extracts the `DB_GLOB_*` tables with `mdb-export`, decodes YCN float dates, and
 * builds a Societyer import bundle for ONE entity (see shared/ycnAccessImport.ts).
 * A YCN database usually holds several companies; each one is imported into its
 * own Societyer organization, never merged.
 *
 * Requirements: `mdbtools` on PATH (provides `mdb-tables` / `mdb-export`).
 *
 * Usage:
 *   # list the entities in the database
 *   tsx scripts/import-ycn-access.ts --db path/to/DBS.accdb --list-entities
 *
 *   # offline — produce one entity's bundle JSON (with the share reconciliation report)
 *   tsx scripts/import-ycn-access.ts --db path/to/DBS.accdb --entity <ENT_ID> --out bundle.json
 *
 *   # push into an organization (needs VITE_CONVEX_URL / CONVEX_URL in .env.local)
 *   tsx scripts/import-ycn-access.ts --db path/to/DBS.accdb --entity <ENT_ID> --society <societyId>
 *
 * Options:
 *   --cancellation-kind redemption|cancellation  ledger kind for a certificate
 *       cancelled with nothing replacing it (default redemption; review either way)
 *   --reference-date YYYY-MM-DD  "today" for current/former status and birth years
 */

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  buildBundleFromAccessTables,
  countBundleRecords,
  linkDirectoryPeople,
  listYcnEntities,
  stagedBundle,
  YCN_STAGED_KEYS,
  type YcnImportBundle,
  type YcnRow,
  type YcnTables,
} from "../shared/ycnAccessImport";
import { dedupeKey } from "../shared/peopleDirectory";

interface CliArgs {
  db?: string;
  out?: string;
  society?: string;
  name?: string;
  entity?: string;
  listEntities: boolean;
  cancellationKind?: "redemption" | "cancellation";
  referenceDate?: string;
}

export function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { listEntities: false };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const next = () => argv[(i += 1)];
    if (flag === "--db") args.db = next();
    else if (flag === "--out") args.out = next();
    else if (flag === "--society") args.society = next();
    else if (flag === "--name") args.name = next();
    else if (flag === "--entity") args.entity = next();
    else if (flag === "--list-entities") args.listEntities = true;
    else if (flag === "--reference-date") args.referenceDate = next();
    else if (flag === "--cancellation-kind") {
      const kind = next();
      if (kind !== "redemption" && kind !== "cancellation") throw new Error("--cancellation-kind must be redemption or cancellation");
      args.cancellationKind = kind;
    } else if (flag === "--include-superseded") {
      throw new Error("--include-superseded is no longer supported: superseded YCN rows are an audit trail, not live register rows.");
    } else {
      throw new Error(`Unknown option ${flag}`);
    }
  }
  return args;
}

/** Parse one chunk of `mdb-export` CSV (quoted fields, doubled-quote escaping). */
export function parseCsv(text: string): YcnRow[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (ch !== "\r") {
      field += ch;
    }
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  if (rows.length === 0) return [];
  const header = rows[0];
  return rows
    .slice(1)
    .filter((cells) => cells.some((c) => c !== ""))
    .map((cells) => {
      const obj: YcnRow = {};
      header.forEach((name, idx) => {
        obj[name] = cells[idx] ?? "";
      });
      return obj;
    });
}

/**
 * Pull every table out of the Access DB into a name → rows map. Dates are
 * exported with 4-digit years so birth dates are never guessed from 2 digits.
 */
export function extractTables(dbPath: string): YcnTables {
  const tableNames = execFileSync("mdb-tables", ["-1", dbPath], { encoding: "utf8" })
    .split("\n")
    .map((t) => t.trim())
    .filter(Boolean);

  const tables: YcnTables = {};
  for (const name of tableNames) {
    const csv = execFileSync("mdb-export", ["-D", "%Y-%m-%d", "-T", "%Y-%m-%d %H:%M:%S", dbPath, name], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      // mdb-export warns on stderr about the Access decimal type (SHARE_CAPTL.VOTING).
      stdio: ["ignore", "pipe", "ignore"],
    });
    tables[name] = parseCsv(csv);
  }
  return tables;
}

/** A summary of the bundle for the console: counts and issue codes, no personal particulars. */
export function describeBundle(bundle: YcnImportBundle): string[] {
  const lines = [`Entity ${bundle.metadata.ycnEntityId}: ${countBundleRecords(bundle)} staged record(s)`];
  for (const key of YCN_STAGED_KEYS) lines.push(`  ${key.padEnd(27)}${bundle[key].length}`);
  lines.push(`  ${"directoryPeople".padEnd(27)}${bundle.directoryPeople.length} (this entity's roster; applied directly)`);
  lines.push(`  ${"societySettings".padEnd(27)}${bundle.societySettings ? "present" : "none"} (applied directly)`);
  const share = bundle.report.shareConversion;
  lines.push(
    `Share register: ${share.movements} ledger movement(s), ${share.certificates} certificate(s); `
      + `reconciled at ${share.reconciledDates.length} event date(s), ${share.checkedPoints} holder/class/date point(s), `
      + `${share.mismatches} mismatch(es) — ${share.clean ? "clean, staged as posted" : "NOT clean, staged for review"}.`,
  );
  const codes = new Map<string, number>();
  for (const issue of share.issues) codes.set(`${issue.severity}:${issue.code}`, (codes.get(`${issue.severity}:${issue.code}`) ?? 0) + 1);
  for (const [code, count] of codes) lines.push(`  ${code} × ${count}`);
  if (bundle.report.warnings.length) lines.push(`${bundle.report.warnings.length} other warning(s); see the bundle's report.`);
  return lines;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.db) {
    throw new Error("Missing --db <path to .accdb>");
  }

  const tables = extractTables(args.db);
  if (args.listEntities) {
    for (const entity of listYcnEntities(tables)) {
      const counts = Object.entries(entity.rowCounts).map(([table, n]) => `${table.replace(/^DB_GLOB_/, "")}=${n}`).join(" ");
      console.log(`${entity.entityId}\t${entity.name ?? "(no name)"}\t${counts}`);
    }
    return;
  }

  const bundle = buildBundleFromAccessTables(tables, {
    name: args.name,
    entityId: args.entity,
    referenceDate: args.referenceDate,
    cancellationKind: args.cancellationKind,
  });
  for (const line of describeBundle(bundle)) console.log(line);

  if (args.out) {
    writeFileSync(args.out, JSON.stringify(bundle, null, 2));
    console.log(`\nWrote bundle → ${args.out}`);
    return;
  }

  if (!args.society) {
    throw new Error("Provide either --out <file> or --society <societyId>");
  }

  // Lazy-load Convex deps only when actually pushing, so the offline path needs
  // no server config.
  const { ConvexHttpClient } = await import("convex/browser");
  const { anyApi } = await import("convex/server");
  const { config } = await import("dotenv");
  config({ path: path.join(process.cwd(), ".env.local") });

  const url =
    process.env.VITE_CONVEX_URL ??
    process.env.CONVEX_SELF_HOSTED_URL ??
    process.env.CONVEX_URL;
  if (!url) throw new Error("Missing VITE_CONVEX_URL / CONVEX_SELF_HOSTED_URL / CONVEX_URL");

  const client = new ConvexHttpClient(url);

  // 1. Directory people first (this entity's roster only), reusing a matching person,
  //    so the staged directors, officers and shareholders can link to them.
  const existing = (await client.query(anyApi.peopleDirectory.list, { societyId: args.society })) as Array<{ _id: string; fullName: string; dob?: string }>;
  const byKey = new Map(existing.map((person) => [dedupeKey(person), person._id]));
  const directoryIds = new Map<string, string>();
  const nowISO = new Date().toISOString();
  for (const person of bundle.directoryPeople) {
    const { globalId, dobNeedsReview: _review, ...fields } = person as Record<string, any>;
    const id = byKey.get(dedupeKey({ fullName: fields.fullName, dob: fields.dob }));
    const savedId = await client.mutation(anyApi.peopleDirectory.upsert, { ...fields, ...(id ? { id } : {}), societyId: args.society, nowISO });
    if (globalId) directoryIds.set(globalId, String(savedId));
  }
  const linked = linkDirectoryPeople(bundle, directoryIds);
  console.log(`Upserted ${bundle.directoryPeople.length} directory person(s); linked ${linked} role holder(s).`);

  // 2. The staged registers.
  const sessionId = await client.mutation(anyApi.importSessions.createFromBundle, {
    societyId: args.society,
    name: bundle.metadata.name,
    bundle: stagedBundle(bundle),
  });
  console.log(`Created import session ${sessionId} — review and promote in the app.`);

  // 3. Settings patch the organization directly.
  if (bundle.societySettings) {
    await client.mutation(anyApi.society.updateComplianceSettings, {
      societyId: args.society,
      ...bundle.societySettings,
    });
    console.log("Applied YCN Corporation_Settings (AGM, fiscal year end, contacts, locations, people picker, responsible lawyer).");
  }
}

// Only run when invoked directly (not when imported by the check script).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
