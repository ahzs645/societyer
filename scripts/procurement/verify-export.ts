/** Local preflight. No network calls or serving mutations occur in this module. */
import { createHash } from "node:crypto";
import { readFileSync, lstatSync } from "node:fs";
import { resolve } from "node:path";
import JSZip from "jszip";

export const TABLES = ["procurementRecords", "procurementDetails", "procurementDocuments", "procurementEvidence"] as const;
export const ALL_TABLES = [...TABLES, "procurementTaxonomyTerms"] as const;
export const canonical = (value: unknown): string => JSON.stringify(value, (_key, entry) => entry && typeof entry === "object" && !Array.isArray(entry) ? Object.fromEntries(Object.entries(entry).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : entry);
const sha256 = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const compareCodePoints = (a:string,b:string) => {
  const left=Array.from(a),right=Array.from(b);
  for(let index=0;index<Math.min(left.length,right.length);index++) {
    const difference=left[index].codePointAt(0)!-right[index].codePointAt(0)!;
    if(difference) return difference;
  }
  return left.length-right.length;
};
const read = (directory: string, name: string) => {
  if (!/^[A-Za-z0-9_.-]+$/.test(name)) throw new Error("Unsafe publication path.");
  const path = resolve(directory, name), stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 512 * 1024 * 1024) throw new Error("Unsafe or oversized publication file.");
  return readFileSync(path);
};
export const archiveEligible = (activation: any): boolean => activation.coverage?.complete === true && Array.isArray(activation.coverage.sources) && activation.coverage.sources.every((source: any) => source?.complete === true);
export const rowKey = (table: string, row: any): string => table === "procurementDocuments" ? row.documentKey : table === "procurementEvidence" ? canonical([row.recordKey, row.source, JSON.parse(row.dataJson).id ?? sha256(row.dataJson)]) : row.recordKey;
const clean = (row: any) => Object.fromEntries(Object.entries(row).filter(([key]) => !["societyId", "generation", "_id", "_creationTime"].includes(key)));
const rowSchemas: Record<string, {text:string[];optionalText?:string[];numbers?:string[];optionalNumbers?:string[];booleans?:string[];nullableText?:string[]}> = {
  procurementRecords: {text:["societyId","generation","recordKey","kind","title","organization","status","date","updatedAt"],optionalText:["dateText","issuedFor","reference","supplier","currency","procurementType","searchText","analyticsJson"],optionalNumbers:["documents","listedDocuments","value"]},
  procurementDetails: {text:["societyId","generation","recordKey","dataJson"]},
  procurementDocuments: {text:["societyId","generation","recordKey","documentKey","name","mediaType","sha256","sourceUrl","status"],numbers:["bytes","parts"],booleans:["available"]},
  procurementEvidence: {text:["societyId","generation","recordKey","source","dataJson"]},
  procurementTaxonomyTerms: {text:["societyId","key","releaseId","scheme","version","code","title"],nullableText:["parentKey"]},
};
function validateRow(table:string,row:any) {
  const schema = rowSchemas[table], allowed = new Set(Object.values(schema).flat());
  if (Object.keys(row).some(key => !allowed.has(key)) || schema.text.some(key => typeof row[key] !== "string") || (schema.optionalText ?? []).some(key => row[key] !== undefined && typeof row[key] !== "string") || (schema.numbers ?? []).some(key => !Number.isSafeInteger(row[key]) || row[key] < 0) || (schema.optionalNumbers ?? []).some(key => row[key] !== undefined && (typeof row[key] !== "number" || !Number.isFinite(row[key]))) || (schema.booleans ?? []).some(key => typeof row[key] !== "boolean") || (schema.nullableText ?? []).some(key => row[key] !== null && typeof row[key] !== "string") || (table === "procurementRecords" && !["award","opportunity"].includes(row.kind))) throw new Error(`Malformed ${table} projection row.`);
}

export async function validateExport(directory: string) {
  const activation = JSON.parse(read(directory, "activation.json").toString("utf8"));
  if (!["societyId","generation","folder","publishedAt"].every(key => typeof activation[key] === "string" && activation[key].length > 0 && activation[key].length <= 500)) throw new Error("Invalid publication scope or timestamp.");
  if (activation.profileVersion === 2 && (!activation.sourceSnapshotId || !/^[a-f0-9]{64}$/.test(activation.sourceCatalogSha256) || !/^[a-f0-9]{64}$/.test(activation.contentHash))) throw new Error("Invalid compact source provenance.");
  if (!activation.expected || canonical(Object.keys(activation.expected).sort()) !== canonical([...TABLES].sort()) || Object.values(activation.expected).some((count:any)=>!Number.isSafeInteger(count)||count<0) || !activation.counts || Object.entries(activation.counts).some(([kind,count]:[string,any])=>!["opportunity","award"].includes(kind)||!Number.isSafeInteger(count)||count<0) || Object.values(activation.counts as Record<string,number>).reduce((sum,count)=>sum+count,0)<1) throw new Error("Invalid expected table or notice counts.");
  if (!activation.coverage || typeof activation.coverage.complete !== "boolean" || !Array.isArray(activation.coverage.sources) || activation.coverage.sources.some((source:any) => !source || typeof source.source !== "string" || typeof source.complete !== "boolean")) throw new Error("Invalid coverage declaration.");
  if (activation.schemaVersion !== 1 || canonical(Object.keys(activation.tables ?? {}).sort()) !== canonical([...ALL_TABLES].sort())) throw new Error("A verified five-table inventory is required; re-export legacy publications before importing.");
  if (activation.inventoryHash !== sha256(canonical({ schemaVersion: 1, tables: activation.tables }))) throw new Error("Publication inventory hash mismatch.");
  const rows: Record<string, any[]> = {}, buffers: Record<string, Buffer> = {};
  for (const table of ALL_TABLES) {
    const entry = activation.tables[table];
    if (entry.path !== `${table}.jsonl` || ![entry.rowCount, entry.bytes].every(value => Number.isSafeInteger(value) && value >= 0) || !/^[a-f0-9]{64}$/.test(entry.sha256)) throw new Error(`Invalid table inventory: ${table}`);
    const data = read(directory, entry.path);
    if (data.length !== entry.bytes || sha256(data) !== entry.sha256) throw new Error(`Table integrity mismatch: ${table}`);
    const lines = data.toString("utf8").split(/\r?\n/);
    if (lines.at(-1) === "") lines.pop();
    rows[table] = lines.map(line => {
      if (Buffer.byteLength(line,"utf8") > 800000) throw new Error(`Projection row exceeds safe document size: ${table}`);
      const row = JSON.parse(line);
      if (!row || typeof row !== "object" || Array.isArray(row) || row.societyId !== activation.societyId || (table !== "procurementTaxonomyTerms" && row.generation !== activation.generation) || ["_id", "_creationTime", "archived", "syncKey"].some(key => key in row)) throw new Error(`Unscoped or serving-only export row: ${table}`);
      validateRow(table,row);
      if (table === "procurementEvidence") {
        const identity = JSON.parse(row.dataJson).id;
        if (identity !== null && identity !== undefined && typeof identity !== "string" && !Number.isSafeInteger(identity)) throw new Error("Invalid evidence identity.");
      }
      if (row.analyticsJson !== undefined && (Buffer.byteLength(row.analyticsJson,"utf8") > 100000 || !JSON.parse(row.analyticsJson) || typeof JSON.parse(row.analyticsJson) !== "object" || Array.isArray(JSON.parse(row.analyticsJson)))) throw new Error("Malformed analytical provenance.");
      return row;
    });
    if (rows[table].length !== entry.rowCount || ((TABLES as readonly string[]).includes(table) && activation.expected?.[table] !== entry.rowCount)) throw new Error(`Table row count mismatch: ${table}`);
    const keys = rows[table].map(row => table === "procurementTaxonomyTerms" ? canonical([row.releaseId, row.key]) : rowKey(table, row));
    if (keys.some(key => typeof key !== "string" || !key) || new Set(keys).size !== keys.length) throw new Error(`Duplicate or missing row key: ${table}`);
    buffers[table] = data;
  }
  const keys = new Set(rows.procurementRecords.map(row => row.recordKey));
  const kinds: Record<string, number> = {};
  for (const row of rows.procurementRecords) kinds[row.kind] = (kinds[row.kind] ?? 0) + 1;
  if (canonical(kinds) !== canonical(Object.fromEntries(Object.entries(activation.counts).filter(([,value]) => value)))) throw new Error("Notice kind count mismatch.");
  if (rows.procurementDetails.length !== keys.size || rows.procurementDetails.some(row => !keys.has(row.recordKey))) throw new Error("Record/detail relationship mismatch.");
  for (const table of TABLES.slice(1)) for (const row of rows[table]) {
    if (!keys.has(row.recordKey)) throw new Error(`Orphaned ${table} row.`);
    if (row.dataJson !== undefined) {
      const payload = JSON.parse(row.dataJson);
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error(`Invalid structured ${table} payload.`);
    }
  }
  const terms = new Set(rows.procurementTaxonomyTerms.map(row => canonical([row.releaseId, row.key])));
  if (activation.taxonomyCount !== undefined && activation.taxonomyCount !== terms.size) throw new Error("Taxonomy inventory mismatch.");
  for (const row of rows.procurementTaxonomyTerms) if (row.parentKey !== null && !terms.has(canonical([row.releaseId, row.parentKey]))) throw new Error("Orphaned taxonomy parent.");
  const indexes=activation.taxonomyIndexes ?? [], releases=activation.taxonomyReleases ?? [];
  if (!Array.isArray(indexes)||indexes.length>32||indexes.some((index:any)=>typeof index.releaseId!=="string"||!index.releaseId||!/^[a-f0-9]{64}$/.test(index.contentHash)||!Number.isSafeInteger(index.count)||index.count<1)||new Set(indexes.map((index:any)=>index.releaseId)).size!==indexes.length||indexes.reduce((sum:number,index:any)=>sum+index.count,0)!==terms.size||canonical([...releases].sort())!==canonical(indexes.map((index:any)=>index.releaseId).sort())) throw new Error("Invalid taxonomy release inventory.");
  if (!activation.archives?.["metadata.zip"]) throw new Error("Metadata archive inventory missing.");
  const archives: Record<string, JSZip> = {};
  for (const [name, entry] of Object.entries(activation.archives) as [string, any][]) {
    const data = read(directory, name);
    if (!name.endsWith(".zip") || data.length !== entry.bytes || sha256(data) !== entry.sha256) throw new Error(`Archive integrity mismatch: ${name}`);
    archives[name] = await JSZip.loadAsync(data, { checkCRC32: true });
  }
  const zip = archives["metadata.zip"];
  const zipFiles = Object.values(zip.files).filter(file => !file.dir).map(file => file.name).sort();
  if (canonical(zipFiles) !== canonical(TABLES.map(table => `${table}/documents.jsonl`).sort())) throw new Error("Metadata archive table inventory mismatch.");
  for (const table of TABLES) if (sha256(await zip.file(`${table}/documents.jsonl`)!.async("nodebuffer")) !== activation.tables[table].sha256) throw new Error(`Archive differs from verified table: ${table}`);
  for (const index of activation.taxonomyIndexes ?? []) {
    const selected = rows.procurementTaxonomyTerms.filter(row => row.releaseId === index.releaseId);
    const serialized = selected.map(({ societyId, ...row }) => canonical(row) + "\n").join("");
    if (selected.length !== index.count || sha256(serialized) !== index.contentHash) throw new Error("Taxonomy release inventory mismatch.");
    const archive = archives[`taxonomy-${index.contentHash}.zip`];
    const file = archive?.file("procurementTaxonomyTerms/documents.jsonl");
    if (!file || canonical((await file.async("string")).trimEnd().split("\n").map(line => JSON.parse(line))) !== canonical(selected)) throw new Error("Taxonomy archive differs from inventory.");
  }
  return { activation, rows };
}

export async function validateDelta(directory: string, baselineDirectory: string, target: Awaited<ReturnType<typeof validateExport>>) {
  if (resolve(directory) === resolve(baselineDirectory)) throw new Error("Keep the previous successful export separately.");
  const baseline = await validateExport(baselineDirectory);
  const delta = JSON.parse(read(directory, "delta-manifest.json").toString("utf8"));
  const old = baseline.activation, current = target.activation;
  if (delta.formatVersion !== 2 || old.profileVersion !== 2 || current.profileVersion !== 2 || old.societyId !== current.societyId || old.folder !== current.folder || delta.societyId !== current.societyId || delta.folder !== current.folder || delta.baseContentHash !== old.contentHash || delta.baseGeneration !== old.generation || delta.targetContentHash !== current.contentHash || delta.targetGeneration !== current.generation || delta.baseInventoryHash !== old.inventoryHash || delta.targetInventoryHash !== current.inventoryHash) throw new Error("Delta publication or baseline binding mismatch.");
  const data = read(directory, "delta.jsonl");
  if (sha256(data) !== delta.sha256) throw new Error("Delta integrity failure.");
  const lines = data.toString("utf8").split("\n"); if (lines.at(-1) === "") lines.pop();
  let offset = 0;
  const changes: Record<string, {upserts:number;archived:number}> = {};
  for (const table of TABLES) {
    const before = new Map(baseline.rows[table].map(row => [rowKey(table,row), row])), after = new Map(target.rows[table].map(row => [rowKey(table,row), row]));
    let upserts = 0, archived = 0;
    for (const key of [...new Set([...before.keys(), ...after.keys()])].sort(compareCodePoints)) {
      const prior = before.get(key) ?? null, row = after.get(key) ?? null;
      if (prior && row && canonical(clean(prior)) === canonical(clean(row))) continue;
      if (row === null && !archiveEligible(current)) throw new Error("Archival requires explicitly complete source/window coverage.");
      const expected = {table,key,recordKey:(row ?? prior).recordKey,row,before:prior};
      if (offset >= lines.length || canonical(JSON.parse(lines[offset++])) !== canonical(expected)) throw new Error("Delta differs from verified baseline/target inventories.");
      if (row === null) archived++; else upserts++;
    }
    changes[table] = {upserts,archived};
  }
  if (offset !== lines.length || offset !== delta.operations || canonical(changes) !== canonical(delta.changes)) throw new Error("Delta operation count or table changes mismatch.");
  return {delta,baseline:old};
}
