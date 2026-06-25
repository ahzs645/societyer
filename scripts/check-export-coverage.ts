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
  Array.from(src.matchAll(/^  ([A-Za-z0-9]+): defineTable/gm)).map((match) => match[1]),
);
const exportList = exportsSource.match(/export const EXPORTABLE_TABLES = \[([\s\S]*?)\] as const;/);
if (!exportList) {
  throw new Error("Could not find EXPORTABLE_TABLES in convex/exports.ts.");
}

const exportTables = Array.from(exportList[1].matchAll(/"([^"]+)"/g)).map((match) => match[1]);
const missing = schemaTables.filter((table) => !exportTables.includes(table));
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

console.log(`Export coverage ok: ${exportTables.length} schema tables covered.`);
