/**
 * One-shot importer for a YCN BC-corporate-records Access database (`.accdb`).
 *
 * Extracts the `DB_GLOB_*` tables with `mdb-export`, decodes YCN float dates, and
 * builds a Societyer import bundle (see shared/ycnAccessImport.ts). The bundle is
 * either written to disk (`--out`) or pushed to `importSessions.createFromBundle`
 * so it flows through the normal staged review → promote pipeline.
 *
 * Mirrors the existing `import-ote-*.mjs` offline-import scripts.
 *
 * Requirements: `mdbtools` on PATH (provides `mdb-tables` / `mdb-export`).
 *
 * Usage:
 *   # offline — just produce the bundle JSON for inspection / fixtures
 *   tsx scripts/import-ycn-access.ts --db path/to/DBS.accdb --out bundle.json
 *
 *   # push into a workspace (needs VITE_CONVEX_URL / CONVEX_URL in .env.local)
 *   tsx scripts/import-ycn-access.ts --db path/to/DBS.accdb --society <societyId>
 */

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  buildBundleFromAccessTables,
  countBundleRecords,
  type YcnRow,
  type YcnTables,
} from "../shared/ycnAccessImport";

interface CliArgs {
  db?: string;
  out?: string;
  society?: string;
  name?: string;
  includeSuperseded: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { includeSuperseded: false };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const next = () => argv[(i += 1)];
    if (flag === "--db") args.db = next();
    else if (flag === "--out") args.out = next();
    else if (flag === "--society") args.society = next();
    else if (flag === "--name") args.name = next();
    else if (flag === "--include-superseded") args.includeSuperseded = true;
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

/** Pull every table out of the Access DB into a name → rows map. */
export function extractTables(dbPath: string): YcnTables {
  const tableNames = execFileSync("mdb-tables", ["-1", dbPath], { encoding: "utf8" })
    .split("\n")
    .map((t) => t.trim())
    .filter(Boolean);

  const tables: YcnTables = {};
  for (const name of tableNames) {
    const csv = execFileSync("mdb-export", [dbPath, name], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
    tables[name] = parseCsv(csv);
  }
  return tables;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.db) {
    throw new Error("Missing --db <path to .accdb>");
  }

  const tables = extractTables(args.db);
  const bundle = buildBundleFromAccessTables(tables, {
    name: args.name || `YCN import — ${path.basename(args.db)}`,
    includeSuperseded: args.includeSuperseded,
  });

  const total = countBundleRecords(bundle);
  console.log(`Built bundle with ${total} record(s):`);
  console.log(`  roleHolders:               ${bundle.roleHolders.length}`);
  console.log(`  rightsClasses:             ${bundle.rightsClasses.length}`);
  console.log(`  rightsholdingTransfers:    ${bundle.rightsholdingTransfers.length}`);
  console.log(`  organizationRegistrations: ${bundle.organizationRegistrations.length}`);
  console.log(`  organizationAddresses:     ${bundle.organizationAddresses.length}`);
  console.log(`  serviceProviders:          ${bundle.serviceProviders.length}`);
  console.log(`  dividends:                 ${bundle.dividends.length}`);
  console.log(`  nameHistory:               ${bundle.nameHistory.length}`);
  console.log(`  constatingEvents:          ${bundle.constatingEvents.length}`);
  console.log(`  significantIndividualSteps:${bundle.significantIndividualSteps.length}`);
  console.log(`  assets:                    ${bundle.assets.length}`);
  console.log(`  shareCertificates:         ${bundle.shareCertificates.length}`);

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
  const sessionId = await client.mutation(anyApi.importSessions.createFromBundle, {
    societyId: args.society,
    name: bundle.metadata.name,
    bundle,
  });
  console.log(`\nCreated import session ${sessionId} — review and promote in the app.`);
}

// Only run when invoked directly (not when imported by the check script).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
