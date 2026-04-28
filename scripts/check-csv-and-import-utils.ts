import assert from "node:assert/strict";
import { cleanCsvCell, escapeCsvCell, parseCsv, rowsToCsv } from "../src/lib/csv";
import {
  buildRecordFromImportedRow,
  normalizeImportedValue,
  suggestImportMappings,
  validateImportedRows,
} from "../src/lib/importMapping";

assert.equal(escapeCsvCell("=IMPORTXML(\"https://example.com\")"), "\"\u200c=IMPORTXML(\"\"https://example.com\"\")\"");
assert.equal(escapeCsvCell("plain"), "plain");
assert.equal(cleanCsvCell("\u200c=1+1"), "=1+1");
assert.deepEqual(parseCsv(rowsToCsv([["Name", "Formula"], ["A", "+1"]]))[1], ["A", "\u200c+1"]);

const result = suggestImportMappings({
  headers: ["First Name", "LastName", "member email", "Status"],
  fields: [
    { id: "firstName", label: "First name" },
    { id: "lastName", label: "Last name" },
    { id: "email", label: "Email" },
    { id: "membershipStatus", label: "Membership status" },
  ],
});

assert.equal(result.mapping[0], "firstName");
assert.equal(result.mapping[1], "lastName");
assert.equal(result.mapping[2], "email");
assert.equal(result.mapping[3], "membershipStatus");
assert.ok(result.suggestionsByColumn[3].some((suggestion) => suggestion.fieldId === "membershipStatus"));
assert.equal(result.suggestionsByColumn[0][0].confidence, "exact");

const duplicate = suggestImportMappings({
  headers: ["Email", "E-mail"],
  fields: [{ id: "email", label: "Email" }],
});
assert.equal(duplicate.mapping[0], "email");
assert.equal(duplicate.mapping[1], "");

const validation = validateImportedRows({
  rows: [{ status: "Unknown", amount: "abc" }],
  fields: [
    { id: "status", label: "Status", type: "select", options: [{ value: "Active", label: "Active" }] },
    { id: "amount", label: "Amount", type: "number" },
  ],
  maxRows: 10,
});
assert.ok(validation.some((issue) => issue.level === "warn" && issue.fieldId === "status"));
assert.ok(validation.some((issue) => issue.level === "error" && issue.fieldId === "amount"));

assert.deepEqual(
  buildRecordFromImportedRow({
    row: { amount: "12.50", tags: "Board; AGM", status: "Active", street: "123 Main" },
    fields: [
      { id: "amount", label: "Amount", type: "number" },
      { id: "tags", label: "Tags", type: "multiSelect" },
      { id: "status", label: "Status", type: "select", options: [{ value: "active", label: "Active" }] },
      { id: "street", label: "Street", targetPath: "address.street" },
    ],
  }),
  { amount: 12.5, tags: ["Board", "AGM"], status: "active", address: { street: "123 Main" } },
);
assert.equal(normalizeImportedValue("yes", { type: "boolean" }), true);

console.log("csv and import utility checks passed");
