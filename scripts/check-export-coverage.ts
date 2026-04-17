import { readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const schemaPath = path.join(root, "convex/schema.ts");
const exportsPath = path.join(root, "convex/exports.ts");

const schema = readFileSync(schemaPath, "utf8");
const exportsSource = readFileSync(exportsPath, "utf8");

const schemaTables = Array.from(schema.matchAll(/^  ([A-Za-z0-9]+): defineTable/gm)).map(
  (match) => match[1],
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
