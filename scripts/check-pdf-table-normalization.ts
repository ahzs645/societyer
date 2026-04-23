import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  buildPdfTableImportBundle,
  normalizePdfTableStructures,
} from "../convex/lib/pdfTableNormalization";

const fixturePath = path.join(
  process.cwd(),
  "fixtures/pdf-ingestion/unbc-key-access-request.inspection.json",
);
const fixture = JSON.parse(await readFile(fixturePath, "utf8"));

const normalizedTables = normalizePdfTableStructures({
  fields: fixture.fields,
  layoutText: fixture.layoutText,
  metadata: fixture.source,
});

const table = normalizedTables.find((candidate) =>
  candidate.columns.some((column) => column.key === "building_room_number"),
);

assert.ok(table, "expected the key/access building-room table to normalize");
assert.deepEqual(
  table!.columns.map((column) => column.label),
  ["Building / Room Number", "Key Issued", "Date Issued", "Deposit"],
);
assert.equal(table!.rows.length, 5);
assert.equal(table!.rows[0].fieldNamesByColumn.building_room_number[0], "Building / Room Number");
assert.equal(table!.columns[0].bound, true);
assert.equal(table!.columns[1].bound, false);
const recordTable = table!.recordTable as any;
assert.equal(recordTable.objectMetadata.labelIdentifierFieldName, "building_room_number");

const bundle = buildPdfTableImportBundle({
  tables: normalizedTables,
  metadata: fixture.source,
  source: fixture.source,
});

assert.equal(bundle.legalTemplateDataFields.length, 4);
assert.equal(bundle.legalTemplates.length, 1);
assert.equal(bundle.sourceEvidence.length, 1);
assert.deepEqual(
  bundle.legalTemplateDataFields.map((field) => field.name),
  [
    `${table!.key}.building_room_number`,
    `${table!.key}.key_issued`,
    `${table!.key}.date_issued`,
    `${table!.key}.deposit`,
  ],
);
assert.equal(bundle.legalTemplateDataFields[2].fieldType, "date");
assert.equal(bundle.legalTemplateDataFields[3].fieldType, "currency");

console.log(
  `PDF table normalization OK: ${table!.columns.length} columns, ${table!.rows.length} rows, ${bundle.legalTemplateDataFields.length} data fields.`,
);
