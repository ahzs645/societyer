import { readFileSync } from "node:fs";
import path from "node:path";
import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";
import { config } from "dotenv";

config({ path: path.join(process.cwd(), ".env.local") });

const api = anyApi as any;
const societyIdArg = argValue("--society-id");
const societyNameArg = argValue("--society-name");
const url =
  process.env.VITE_CONVEX_URL ??
  process.env.CONVEX_SELF_HOSTED_URL ??
  process.env.CONVEX_URL;

if (!url) {
  throw new Error("Set VITE_CONVEX_URL, CONVEX_SELF_HOSTED_URL, or CONVEX_URL before validating exports.");
}

const client = new ConvexHttpClient(url);
const societies = await client.query(api.society.list, {});
const society = societyIdArg
  ? societies.find((row: any) => row._id === societyIdArg)
  : societyNameArg
    ? societies.find((row: any) => String(row.name).toLowerCase() === societyNameArg.toLowerCase())
    : societies[0];

if (!society) {
  throw new Error(`Society not found${societyNameArg ? `: ${societyNameArg}` : ""}.`);
}

const validation = await client.query(api.exports.validateCurrentDatabase, {
  societyId: society._id,
});
if (!validation.ok) {
  throw new Error(`Export validation failed: ${(validation.issues ?? []).join("; ")}`);
}

const tables = exportTables();
const counts: Array<{ table: string; rows: number; pages: number }> = [];
let totalRows = 0;

for (const table of tables) {
  console.error(`Counting ${table}...`);
  let cursor: string | null = null;
  let rows = 0;
  let pages = 0;
  const seenCursors = new Set<string>();
  do {
    if (cursor) {
      if (seenCursors.has(cursor)) {
        throw new Error(`Pagination cursor repeated while counting ${table}.`);
      }
      seenCursors.add(cursor);
    }
    const result = await client.query(api.exports.countTablePage, {
      societyId: society._id,
      table,
      paginationOpts: { cursor, numItems: pageSizeFor(table) },
    });
    rows += Number(result.count ?? 0);
    pages += 1;
    if (pages > 10_000) {
      throw new Error(`Too many pages while counting ${table}.`);
    }
    cursor = result.isDone ? null : result.continueCursor;
  } while (cursor);
  counts.push({ table, rows, pages });
  totalRows += rows;
  console.error(`  ${rows} rows across ${pages} page${pages === 1 ? "" : "s"}`);
}

const nonEmpty = counts.filter((row) => row.rows > 0);
const largest = [...nonEmpty].sort((a, b) => b.rows - a.rows).slice(0, 12);

console.log(
  JSON.stringify(
    {
      ok: true,
      society: society.name,
      societyId: society._id,
      tables: tables.length,
      nonEmptyTables: nonEmpty.length,
      totalRows,
      largest,
    },
    null,
    2,
  ),
);

function exportTables() {
  const source = readFileSync(path.join(process.cwd(), "convex/exports.ts"), "utf8");
  const match = source.match(/export const EXPORTABLE_TABLES = \[([\s\S]*?)\] as const;/);
  if (!match) throw new Error("Could not find EXPORTABLE_TABLES in convex/exports.ts.");
  return Array.from(match[1].matchAll(/"([^"]+)"/g)).map((item) => item[1]);
}

function argValue(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function pageSizeFor(table: string) {
  return table === "documents" || table === "sourceEvidence" ? 25 : 100;
}
