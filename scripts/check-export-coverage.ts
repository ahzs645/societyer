import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const schemaPath = path.join(root, "convex/schema.ts");
const tablesDir = path.join(root, "convex/tables");
const exportsPath = path.join(root, "convex/exports.ts");

// The schema is modularized: schema.ts spreads table groups from convex/tables/*.ts.
// Scan all of them so table coverage reflects the full data model.
const schemaSources = [readFileSync(schemaPath, "utf8")];
if (existsSync(tablesDir)) {
  for (const file of readdirSync(tablesDir)) {
    if (file.endsWith(".ts")) schemaSources.push(readFileSync(path.join(tablesDir, file), "utf8"));
  }
}
const exportsSource = readFileSync(exportsPath, "utf8");

const schemaTables = schemaSources.flatMap((src) =>
  Array.from(src.matchAll(/^  ([A-Za-z0-9_]+): defineTable/gm)).map((match) => match[1]),
);
const exportList = exportsSource.match(/export const EXPORTABLE_TABLES = \[([\s\S]*?)\] as const;/);
if (!exportList) {
  throw new Error("Could not find EXPORTABLE_TABLES in convex/exports.ts.");
}

const exportTables = Array.from(exportList[1].matchAll(/"([^"]+)"/g)).map((match) => match[1]);
// Authorization capabilities, synchronization receipts and derived projections
// cannot be restored as business records. Native meetings/agendas/minutes remain
// exportable; device-authored pending work uses the offline recovery export.
const NON_WORKSPACE_EXPORT_TABLES = new Set([
  "documentUploadHandles", "externalIdentities", "powersync_checkpoints",
  "offlineMeetingAggregates", "offlineMeetingReceipts", "offlineMeetingDownloads", "offlineMeetingScopes",
]);
const forbidden = exportTables.filter(table => NON_WORKSPACE_EXPORT_TABLES.has(table));
if (forbidden.length) throw new Error(`Internal authorization/synchronization tables must not be exported: ${forbidden.join(", ")}.`);
const staleExclusions = [...NON_WORKSPACE_EXPORT_TABLES].filter(table => !schemaTables.includes(table));
if (staleExclusions.length) throw new Error(`Export exclusions no longer exist in the schema: ${staleExclusions.join(", ")}.`);
const missing = schemaTables.filter((table) => !exportTables.includes(table) && !NON_WORKSPACE_EXPORT_TABLES.has(table));
const extra = exportTables.filter((table) => !schemaTables.includes(table));
const duplicates = exportTables.filter((table, index) => exportTables.indexOf(table) !== index);

if (missing.length || extra.length || duplicates.length) {
  const parts = [
    missing.length ? `missing: ${missing.join(", ")}` : "",
    extra.length ? `extra: ${extra.join(", ")}` : "",
    duplicates.length ? `duplicates: ${Array.from(new Set(duplicates)).join(", ")}` : "",
  ].filter(Boolean);
  throw new Error(`Export table coverage does not match schema (${parts.join("; ")}).`);
}

console.log(`Export coverage ok: ${exportTables.length} business tables covered; ${NON_WORKSPACE_EXPORT_TABLES.size} internal authorization/synchronization tables excluded.`);
