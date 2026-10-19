import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { FIELD_TYPES, type FieldType } from "../src/platform/record-engine/types/FieldType";
import type { FieldMetadata, RecordField } from "../src/platform/record-engine/types";
import { filterAndSortRecords } from "../src/platform/record-engine/record-table/utils/filterAndSortRecords";
import { distinctFieldValues } from "../src/platform/record-engine/record-table/utils/distinctFieldValues";
import { buildRowModel, pageRowModel } from "../src/platform/record-engine/record-table/hooks/useRecordTableRowModel";

// Micro-benchmark: the in-memory engine over a procurement-sized list
// (25,000 awards) must filter and sort well inside a frame budget, so
// sorting, filtering, searching and paging the whole list stay instant.

const BUDGET_MS = 100;
const ROWS = 25_000;

function field(name: string, fieldType: FieldType, config: Record<string, unknown> = {}): RecordField {
  const metadata: FieldMetadata = {
    _id: `f-${name}`,
    objectMetadataId: "awards",
    name,
    label: name,
    fieldType,
    config,
    defaultValue: undefined,
    isSystem: false,
    isHidden: false,
    isNullable: true,
    isReadOnly: true,
    position: 0,
  };
  return { viewFieldId: `vf-${name}`, fieldMetadataId: metadata._id, position: 0, size: 160, isVisible: true, field: metadata };
}

const statuses = ["open", "closed", "awarded", "cancelled"];
const columns = [
  field("title", FIELD_TYPES.TEXT),
  field("buyer", FIELD_TYPES.TEXT),
  field("amount", FIELD_TYPES.CURRENCY, { isCents: true }),
  field("bids", FIELD_TYPES.NUMBER),
  field("closes", FIELD_TYPES.DATE),
  field("status", FIELD_TYPES.SELECT, { options: statuses.map((value) => ({ value, label: value[0].toUpperCase() + value.slice(1) })) }),
  field("vendorId", FIELD_TYPES.RELATION),
  field("local", FIELD_TYPES.BOOLEAN),
];

// Deterministic pseudo-random data: thousands of buyers and vendors, some gaps.
let seed = 42;
const random = () => {
  // mulberry32
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
};
const records = Array.from({ length: ROWS }, (_, index) => {
  const day = 1 + Math.floor(random() * 1500);
  const date = new Date(Date.UTC(2022, 0, day)).toISOString().slice(0, 10);
  const vendor = Math.floor(random() * 3000);
  return {
    _id: `award-${index}`,
    title: `${["Supply of", "Repair of", "Consulting for", "Snow removal at"][index % 4]} item ${Math.floor(random() * 9000)}`,
    buyer: `Buyer ${Math.floor(random() * 4000)}`,
    amount: random() < 0.05 ? null : Math.round(random() * 50_000_000),
    bids: Math.floor(random() * 12),
    closes: random() < 0.03 ? null : date,
    status: statuses[Math.floor(random() * statuses.length)],
    vendorId: `vendor-${vendor}`,
    vendorIdLabel: `Vendor ${vendor} Ltd`,
    local: random() < 0.4,
  };
});

function median(run: () => unknown, times = 7) {
  run(); // warm-up (JIT, collator)
  const samples: number[] = [];
  for (let i = 0; i < times; i += 1) {
    const start = performance.now();
    run();
    samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  return samples[Math.floor(samples.length / 2)];
}

const byId = (name: string) => `f-${name}`;
const results: Array<[string, number]> = [];
const measure = (label: string, run: () => unknown) => {
  const ms = median(run);
  results.push([label, ms]);
  assert.ok(ms < BUDGET_MS, `${label} took ${ms.toFixed(1)} ms (budget ${BUDGET_MS} ms)`);
};

let lastCount = 0;
measure("filter + sort 25,000 rows", () => {
  const out = filterAndSortRecords({
    records,
    columns,
    filters: [
      { fieldMetadataId: byId("status"), operator: "in", value: ["open", "Awarded"] },
      { fieldMetadataId: byId("amount"), operator: "gte", value: 100_000 },
      { fieldMetadataId: byId("title"), operator: "contains", value: "of" },
    ],
    sorts: [
      { fieldMetadataId: byId("buyer"), direction: "asc" },
      { fieldMetadataId: byId("closes"), direction: "desc" },
    ],
  });
  lastCount = out.length;
});
assert.ok(lastCount > 1000 && lastCount < ROWS, "the filters keep a realistic share of the rows");

measure("sort 25,000 rows by text", () =>
  filterAndSortRecords({ records, columns, filters: [], sorts: [{ fieldMetadataId: byId("title"), direction: "asc" }] }));
measure("sort 25,000 rows by amount", () =>
  filterAndSortRecords({ records, columns, filters: [], sorts: [{ fieldMetadataId: byId("amount"), direction: "desc" }] }));
measure("relation 'is any of' by name", () =>
  filterAndSortRecords({ records, columns, filters: [{ fieldMetadataId: byId("vendorId"), operator: "in", value: ["Vendor 12 Ltd", "Vendor 99 Ltd"] }], sorts: [] }));

// The quick search builds its corpus once per record, then reuses it.
const firstSearchStart = performance.now();
filterAndSortRecords({ records, columns, filters: [], sorts: [], searchTerm: "vendor 12" });
const firstSearch = performance.now() - firstSearchStart;
results.push(["search 25,000 rows (first, builds corpus)", firstSearch]);
assert.ok(firstSearch < BUDGET_MS * 3, `first search took ${firstSearch.toFixed(1)} ms`);
measure("search 25,000 rows (cached)", () => filterAndSortRecords({ records, columns, filters: [], sorts: [], searchTerm: "snow removal" }));

measure("distinct buyers (≈4,000 values)", () => {
  const values = distinctFieldValues(records, columns[1].field);
  assert.ok(values.length > 3500);
});
measure("row model + one page", () =>
  pageRowModel(buildRowModel({ filtered: records, columns, groupBy: null, collapsedGroupKeys: new Set() }), 40, 50));

for (const [label, ms] of results) console.log(`  ${label}: ${ms.toFixed(1)} ms`);
console.log(`record table performance checks passed (${ROWS.toLocaleString("en-CA")} rows, budget ${BUDGET_MS} ms)`);
