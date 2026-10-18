/**
 * The snapshot catalog opened in wa-sqlite from memory: a read-only database
 * over the verified bytes, with a per-statement deadline. Runs in the catalog
 * worker in the browser, and under Node in the checks.
 */
import * as SQLite from "@journeyapps/wa-sqlite";
import SQLiteESMFactory from "@journeyapps/wa-sqlite/dist/wa-sqlite.mjs";
import { MemoryVFS } from "@journeyapps/wa-sqlite/src/examples/MemoryVFS.js";
import type { CatalogParameter } from "../../../../shared/procurementReview/catalogSelect";

export type SqlValue = string | number | null | Uint8Array;
export type SqlRow = Record<string, SqlValue>;

export type CatalogSql = {
  /** Every row of one statement. A `deadlineMs` interrupts it once that much time has passed. */
  all(sql: string, parameters?: readonly CatalogParameter[], options?: { deadlineMs?: number }): Promise<SqlRow[]>;
  close(): Promise<void>;
};

/** Where the wasm comes from: a URL in the browser, the file's bytes under Node. */
export type WasmSource = { locateFile: (file: string) => string } | { wasmBinary: ArrayBuffer | Uint8Array };

const FILE_NAME = "catalog.sqlite";
let vfsCount = 0;

function sqlValue(value: unknown): SqlValue {
  if (value === null || typeof value === "string" || typeof value === "number" || value instanceof Uint8Array) return value;
  if (typeof value === "bigint") return Number.isSafeInteger(Number(value)) ? Number(value) : value.toString();
  if (Array.isArray(value)) return new Uint8Array(value);
  return null;
}

export async function openCatalogDatabase(bytes: Uint8Array, wasm: WasmSource): Promise<CatalogSql> {
  const module = await SQLiteESMFactory(wasm);
  const sqlite3 = SQLite.Factory(module);
  const vfs = new MemoryVFS(`procurement-review-${++vfsCount}`, module);
  await vfs.isReady();
  sqlite3.vfs_register(vfs, false);

  // A private copy the VFS owns. The snapshot is a finished, consistent file,
  // so a WAL-mode header (bytes 18-19 = 2) is switched to rollback mode: a
  // read-only open can't create the -wal/-shm files WAL would ask for.
  const data = bytes.slice().buffer;
  const header = new Uint8Array(data, 0, Math.min(20, data.byteLength));
  if (header[18] === 2 && header[19] === 2) { header[18] = 1; header[19] = 1; }
  vfs.mapNameToFile.set(`/${FILE_NAME}`, { pathname: `/${FILE_NAME}`, flags: SQLite.SQLITE_OPEN_READONLY, size: data.byteLength, data });

  const db = await sqlite3.open_v2(FILE_NAME, SQLite.SQLITE_OPEN_READONLY, vfs.name);
  let deadline = Number.POSITIVE_INFINITY;
  sqlite3.progress_handler(db, 10_000, () => (Date.now() > deadline ? 1 : 0), null);

  return {
    async all(sql, parameters = [], options = {}) {
      deadline = options.deadlineMs === undefined ? Number.POSITIVE_INFINITY : Date.now() + options.deadlineMs;
      const rows: SqlRow[] = [];
      try {
        for await (const statement of sqlite3.statements(db, sql)) {
          if (parameters.length) sqlite3.bind_collection(statement, [...parameters]);
          const columns = sqlite3.column_names(statement);
          while ((await sqlite3.step(statement)) === SQLite.SQLITE_ROW) {
            const values = sqlite3.row(statement);
            const row: SqlRow = {};
            columns.forEach((column, index) => { row[column] = sqlValue(values[index]); });
            rows.push(row);
          }
          // One statement per call, like the reference reader.
          break;
        }
      } finally {
        deadline = Number.POSITIVE_INFINITY;
      }
      return rows;
    },
    async close() {
      await sqlite3.close(db);
      vfs.close();
    },
  };
}
