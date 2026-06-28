import assert from "node:assert/strict";
import { parseBankCsv, toCents, splitCsvLine, normalizeDate } from "../src/lib/bankCsv";

// --- toCents ---
assert.equal(toCents("12.34"), 1234, "plain decimal");
assert.equal(toCents("$1,234.50"), 123450, "currency + thousands separator");
assert.equal(toCents("(45.00)"), -4500, "parenthesised negative");
assert.equal(toCents("-9.99"), -999, "leading-minus negative");
assert.equal(toCents(""), null, "empty -> null");
assert.equal(toCents("n/a"), null, "non-numeric -> null");
assert.equal(toCents("100"), 10000, "integer dollars");

// --- splitCsvLine ---
assert.deepEqual(splitCsvLine("a,b,c"), ["a", "b", "c"], "simple split");
assert.deepEqual(
  splitCsvLine('"Smith, John","12.00","memo"'),
  ["Smith, John", "12.00", "memo"],
  "quoted field with comma",
);
assert.deepEqual(splitCsvLine('"He said ""hi"""'), ['He said "hi"'], "escaped quotes");

// --- normalizeDate ---
assert.equal(normalizeDate("2026-06-28"), "2026-06-28", "iso passthrough");
assert.equal(normalizeDate("not a date"), "not a date", "unparseable passthrough");

// --- parseBankCsv: single signed amount column ---
const signed = parseBankCsv(
  ["Date,Description,Amount", "2026-01-02,Coffee,-4.50", "2026-01-03,Donation,\"1,000.00\""].join("\n"),
);
assert.equal(signed.length, 2, "two signed rows");
assert.equal(signed[0].amountCents, -450, "expense negative");
assert.equal(signed[1].amountCents, 100000, "income positive with quotes");
assert.equal(signed[0].description, "Coffee", "description parsed");

// --- parseBankCsv: separate debit/credit columns ---
const dc = parseBankCsv(
  ["Date,Memo,Debit,Credit", "2026-02-01,Rent,500.00,", "2026-02-02,Grant,,2500.00"].join("\n"),
);
assert.equal(dc[0].amountCents, -50000, "debit -> negative");
assert.equal(dc[1].amountCents, 250000, "credit -> positive");

// --- parseBankCsv: missing description falls back, dedupe of blank lines ---
const fallback = parseBankCsv(["date,amount", "2026-03-01,10.00", "", "  "].join("\n"));
assert.equal(fallback.length, 1, "blank lines skipped");
assert.equal(fallback[0].description, "Imported transaction", "description fallback");

// --- parseBankCsv: no date column throws ---
assert.throws(() => parseBankCsv("foo,bar\n1,2"), /date column/, "missing date column throws");

console.log("bank CSV parser checks passed");
