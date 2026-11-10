/** Derived, workspace-scoped serving artifact. Never a Zoer project database. */
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { readFileSync, mkdirSync, existsSync, chmodSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { ALL_TABLES, canonical, validateExport } from "../../scripts/procurement/verify-export";

export const CATALOG_SCHEMA_VERSION = 1;
export type CatalogTable = typeof ALL_TABLES[number];
export type CatalogRow = Record<string, any>;
export const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const tableNames: Record<CatalogTable, string> = {
  procurementRecords: "notices", procurementDetails: "details", procurementDocuments: "documents",
  procurementEvidence: "evidence", procurementTaxonomyTerms: "taxonomy_terms",
};
export function rowKey(table: CatalogTable, row: CatalogRow): string {
  if (table === "procurementDocuments") return row.documentKey;
  if (table === "procurementEvidence") {
    const id = JSON.parse(row.dataJson).id;
    return canonical([row.recordKey, row.source, id ?? hash(row.dataJson)]);
  }
  return table === "procurementTaxonomyTerms" ? canonical([row.releaseId, row.key]) : row.recordKey;
}
/** Retain the exact source number/string encoding, but remove per-publication scope.
 * Export rows are flat records with nested content encoded in dataJson/analyticsJson.
 * This lets unchanged rows stay on the same SQLite pages across generations.
 */
function scopeTemplate(line: string, table: CatalogTable): string {
  for (const field of table === "procurementTaxonomyTerms" ? ["societyId"] : ["societyId", "generation"]) {
    const pattern = new RegExp(`([,{]\\s*"${field}"\\s*:)\\s*"(?:[^"\\\\]|\\\\.)*"`, "g");
    let count = 0;
    line = line.replace(pattern, (_match, prefix) => { count++; return prefix + "null"; });
    if (count !== 1) throw new Error("Export scope must appear exactly once.");
  }
  return line;
}
function scopedLine(template: string, table: CatalogTable, meta: CatalogRow): string {
  let value = template.replace(/([,{]\s*"societyId"\s*:)null/, (_match, prefix) => prefix + JSON.stringify(meta.societyId));
  if (table !== "procurementTaxonomyTerms") value = value.replace(/([,{]\s*"generation"\s*:)null/, (_match, prefix) => prefix + JSON.stringify(meta.generation));
  return value;
}
export function sqliteSelfTest() {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("CREATE VIRTUAL TABLE words USING fts5(text, tokenize='unicode61'); CREATE VIRTUAL TABLE fragments USING fts5(text, tokenize='trigram');");
    return String(db.prepare("SELECT sqlite_version() AS version").get()!.version);
  } finally { db.close(); }
}
function schema(db: DatabaseSync) {
  db.exec(`PRAGMA journal_mode=DELETE; PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL;
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS source_entries (table_name TEXT NOT NULL, key TEXT NOT NULL, ordinal INTEGER NOT NULL,
      PRIMARY KEY(table_name,key), UNIQUE(table_name,ordinal));
    CREATE VIRTUAL TABLE IF NOT EXISTS notice_text USING fts5(record_key UNINDEXED, title, body, tokenize='unicode61');
    CREATE VIRTUAL TABLE IF NOT EXISTS notice_substrings USING fts5(record_key UNINDEXED, title, tokenize='trigram');`);
  for (const name of Object.values(tableNames)) db.exec(`CREATE TABLE IF NOT EXISTS ${name} (
    key TEXT PRIMARY KEY, record_key TEXT NOT NULL, source TEXT NOT NULL, source_json TEXT NOT NULL,
    row_hash TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1);
    CREATE INDEX IF NOT EXISTS ${name}_record ON ${name}(record_key,active);`);
}
export function openCatalog(path: string, readOnly = true): DatabaseSync {
  const db = new DatabaseSync(resolve(path), { readOnly });
  db.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
  return db;
}
export function catalogMeta(db: DatabaseSync): CatalogRow {
  const row = db.prepare("SELECT value FROM meta WHERE key='publication'").get();
  if (!row) throw new Error("Catalog has no verified publication.");
  const meta = JSON.parse(String(row.value));
  if (meta.catalogSchemaVersion !== CATALOG_SCHEMA_VERSION) throw new Error("Unsupported catalog schema; rebuild to a new file.");
  return meta;
}
export function readRows(db: DatabaseSync, table: CatalogTable, recordKey?: string, includeInactive = false): CatalogRow[] {
  const name = tableNames[table];
  const rows = db.prepare(`SELECT source_json FROM ${name} WHERE ${includeInactive ? "1" : "active=1"}${recordKey === undefined ? "" : " AND record_key=?"} ORDER BY key`).all(...(recordKey === undefined ? [] : [recordKey]));
  const meta = catalogMeta(db);
  return rows.map(row => JSON.parse(scopedLine(String(row.source_json), table, meta)));
}
export function readRow(db: DatabaseSync, table: CatalogTable, key: string): { row: CatalogRow; removed: boolean } | null {
  const row = db.prepare(`SELECT source_json,active FROM ${tableNames[table]} WHERE key=?`).get(key);
  return row ? { row: JSON.parse(scopedLine(String(row.source_json), table, catalogMeta(db))), removed: row.active !== 1 } : null;
}
export function boundedReviews(db: DatabaseSync, recordKey?: string) {
  const meta = catalogMeta(db), rows: CatalogRow[] = []; let bytes = 0, truncated = false;
  const query = db.prepare(`SELECT source_json FROM evidence WHERE active=1${recordKey === undefined ? "" : " AND record_key=?"} ORDER BY key LIMIT 5001`);
  for (const row of query.iterate(...(recordKey === undefined ? [] : [recordKey]))) {
    bytes += Buffer.byteLength(String(row.source_json));
    if (rows.length >= 5000 || bytes > 3_000_000) { truncated = true; break; }
    rows.push(JSON.parse(scopedLine(String(row.source_json), "procurementEvidence", meta)));
  }
  return { rows, truncated };
}
export function verifyCatalog(db: DatabaseSync): CatalogRow {
  const integrity = db.prepare("PRAGMA integrity_check").all();
  if (integrity.length !== 1 || Object.values(integrity[0])[0] !== "ok") throw new Error("Catalog SQLite integrity check failed.");
  const meta = catalogMeta(db);
  if (hash(canonical({ schemaVersion: 1, tables: meta.tables })) !== meta.inventoryHash) throw new Error("Catalog inventory binding differs.");
  for (const table of ALL_TABLES) {
    const digest = createHash("sha256"); let count = 0, bytes = 0;
    const rows = db.prepare(`SELECT r.source_json FROM source_entries e JOIN ${tableNames[table]} r ON r.key=e.key WHERE e.table_name=? ORDER BY e.ordinal`).iterate(table);
    for (const row of rows) { const line = scopedLine(String(row.source_json), table, meta) + "\n"; digest.update(line); bytes += Buffer.byteLength(line); count++; }
    const expected = meta.tables[table];
    if (!expected || count !== expected.rowCount || bytes !== expected.bytes || digest.digest("hex") !== expected.sha256) throw new Error(`Catalog table failed its original export inventory: ${table}`);
  }
  return meta;
}
function indexedText(row: CatalogRow) {
  const stack: unknown[] = [JSON.parse(row.dataJson)], strings: string[] = [];
  while (stack.length) {
    const value = stack.pop();
    if (typeof value === "string") strings.push(value);
    else if (Array.isArray(value)) stack.push(...value);
    else if (value && typeof value === "object") stack.push(...Object.values(value));
  }
  return strings.join(" ").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
}
export async function buildCatalog(exportDirectory: string, output: string) {
  const { activation } = await validateExport(exportDirectory, { skipAnalytics: true });
  const path = resolve(output); mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  if (existsSync(path)) {
    const existing = openCatalog(path);
    try { const meta = catalogMeta(existing); if (meta.societyId !== activation.societyId || meta.folder !== activation.folder) throw new Error("An origin file cannot be rebound to another workspace or folder."); }
    finally { existing.close(); }
  }
  const db = openCatalog(path, false);
  chmodSync(path, 0o600);
  let changed = 0, archived = 0;
  try {
    schema(db);
    const prior = db.prepare("SELECT value FROM meta WHERE key='publication'").get();
    if (prior) {
      const meta = catalogMeta(db);
      if (meta.societyId !== activation.societyId || meta.folder !== activation.folder) throw new Error("An origin file cannot be rebound to another workspace or folder.");
    }
    const complete = activation.coverage.complete && activation.coverage.sources.every((source: any) => source.complete);
    db.exec("BEGIN IMMEDIATE");
    const changedNotices = new Set<string>();
    for (const table of ALL_TABLES) {
      const name = tableNames[table];
      const rows = readFileSync(resolve(exportDirectory, `${table}.jsonl`), "utf8").split("\n"); if (rows.at(-1) === "") rows.pop();
      const seen = new Set<string>();
      const existingOrder = db.prepare("SELECT key,ordinal FROM source_entries WHERE table_name=?").all(table);
      // Order metadata is small and separate from payload pages. Keep it untouched
      // when the key order is the same, avoiding an otherwise full-table rewrite.
      const order = rows.map(line => rowKey(table, JSON.parse(line)));
      if (existingOrder.length !== order.length || existingOrder.some(row => order[Number(row.ordinal)] !== row.key)) {
        db.prepare("DELETE FROM source_entries WHERE table_name=?").run(table);
        const insert = db.prepare("INSERT INTO source_entries(table_name,key,ordinal) VALUES(?,?,?)");
        order.forEach((key, ordinal) => insert.run(table, key, ordinal));
      }
      const upsert = db.prepare(`INSERT INTO ${name}(key,record_key,source,source_json,row_hash,active) VALUES(?,?,?,?,?,1)
        ON CONFLICT(key) DO UPDATE SET record_key=excluded.record_key,source=excluded.source,source_json=excluded.source_json,row_hash=excluded.row_hash,active=1
        WHERE row_hash!=excluded.row_hash OR active!=1`);
      for (const line of rows) {
        const row = JSON.parse(line), key = rowKey(table, row), template = scopeTemplate(line, table);
        seen.add(key);
        const result = upsert.run(key, row.recordKey ?? "", row.source ?? "", template, hash(template));
        if (Number(result.changes)) { changed++; if (table === "procurementRecords" || table === "procurementDetails") changedNotices.add(row.recordKey); }
      }
      if (complete) for (const row of db.prepare(`SELECT key,record_key FROM ${name} WHERE active=1`).all()) if (!seen.has(String(row.key))) {
        db.prepare(`UPDATE ${name} SET active=0 WHERE key=?`).run(row.key); archived++;
        if (table === "procurementRecords") changedNotices.add(String(row.record_key));
      }
    }
    const meta = { ...activation, catalogSchemaVersion: CATALOG_SCHEMA_VERSION };
    db.prepare("INSERT INTO meta(key,value) VALUES('publication',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE value!=excluded.value").run(canonical(meta));
    for (const key of changedNotices) {
      // FTS columns are not B-tree indexes. Use the stable notices rowid rather
      // than scanning all prior FTS records for every changed notice.
      const rowid = db.prepare("SELECT rowid FROM notices WHERE key=?").get(key)!.rowid;
      db.prepare("DELETE FROM notice_text WHERE rowid=?").run(rowid);
      db.prepare("DELETE FROM notice_substrings WHERE rowid=?").run(rowid);
      const notice = readRow(db, "procurementRecords", key), detail = readRow(db, "procurementDetails", key);
      if (notice && !notice.removed) {
        db.prepare("INSERT INTO notice_text(rowid,record_key,title,body) VALUES(?,?,?,?)").run(rowid, key, notice.row.title, detail ? indexedText(detail.row) : "");
        db.prepare("INSERT INTO notice_substrings(rowid,record_key,title) VALUES(?,?,?)").run(rowid, key, notice.row.title);
      }
    }
    verifyCatalog(db);
    db.exec("COMMIT");
    return { path, publicationId: activation.publicationId, generation: activation.generation, inventoryHash: activation.inventoryHash, changedRows: changed, archivedRows: archived };
  } catch (error) { if (db.isTransaction) db.exec("ROLLBACK"); throw error; }
  finally { db.close(); }
}
