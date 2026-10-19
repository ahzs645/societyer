import assert from "node:assert/strict";
import { FIELD_TYPES, type FieldType } from "../src/platform/record-engine/types/FieldType";
import type { FieldMetadata, RecordField } from "../src/platform/record-engine/types";
import { aggregateRecordValues, getAvailableAggregateOperationsForFieldType } from "../src/platform/record-engine/record-table/utils/aggregateOperations";
import { filterAndSortRecords } from "../src/platform/record-engine/record-table/utils/filterAndSortRecords";
import { deserializeViewFiltersFromUrl, serializeViewFiltersToUrl } from "../src/platform/record-engine/record-table/utils/viewFilterGroups";
import { adaptLegacyDataTableView } from "../src/platform/record-engine/record-table/utils/legacyDataTableView";
import { hydrateHydratedView } from "../src/platform/record-engine/types";
import { filterRecords } from "../src/platform/record-engine/record-table/utils/filterRecords";
import { sortRecords } from "../src/platform/record-engine/record-table/utils/sortRecords";
import { distinctFieldValues, searchDistinctValues, supportsValuePicker } from "../src/platform/record-engine/record-table/utils/distinctFieldValues";
import {
  chooseRecordTableDisplay,
  describePage,
  getViewDisplay,
  pageItems,
  resolveRecordTableDisplay,
  withViewDisplay,
} from "../src/platform/record-engine/record-table/utils/viewDisplay";
import { withViewGroupBy, getViewGroupBy } from "../src/platform/record-engine/record-table/utils/groupRecords";
import { buildRowModel, pageRowModel } from "../src/platform/record-engine/record-table/hooks/useRecordTableRowModel";
import { createRecordTableStore } from "../src/platform/record-engine/record-table/state/recordTableStore";

function field(id: string, name: string, fieldType: FieldType): RecordField {
  const metadata: FieldMetadata = {
    _id: id,
    objectMetadataId: "object",
    name,
    label: name,
    fieldType,
    config: {},
    defaultValue: undefined,
    isSystem: false,
    isHidden: false,
    isNullable: true,
    isReadOnly: false,
    position: 0,
  };
  return {
    viewFieldId: `view-${id}`,
    fieldMetadataId: id,
    position: 0,
    size: 160,
    isVisible: true,
    field: metadata,
  };
}

const columns = [
  field("name", "name", FIELD_TYPES.TEXT),
  field("joinedAt", "joinedAt", FIELD_TYPES.DATE),
  field("dues", "dues", FIELD_TYPES.CURRENCY),
  field("active", "active", FIELD_TYPES.BOOLEAN),
  field("tags", "tags", FIELD_TYPES.MULTI_SELECT),
  field("committee", "committee", FIELD_TYPES.RELATION),
];

const records = [
  { _id: "1", name: "Alex", joinedAt: "2024-01-10", dues: 10, active: true, tags: ["board"], committee: { label: "Finance" } },
  { _id: "2", name: "Blair", joinedAt: "2023-06-01", dues: null, active: false, tags: ["volunteer"], committee: { label: "Governance" } },
  { _id: "3", name: "Casey", joinedAt: "2025-02-01", dues: 5, active: "false", tags: ["board", "finance"], committee: { label: "Finance" } },
];

assert.deepEqual(
  filterAndSortRecords({
    records,
    columns,
    filters: [{ fieldMetadataId: "tags", operator: "contains", value: "board" }],
    sorts: [{ fieldMetadataId: "dues", direction: "asc" }],
  }).map((record) => record._id),
  ["3", "1"],
);

assert.deepEqual(
  filterAndSortRecords({
    records,
    columns,
    filters: [{ fieldMetadataId: "active", operator: "isFalse", value: null }],
    sorts: [{ fieldMetadataId: "joinedAt", direction: "desc" }],
  }).map((record) => record._id),
  ["3", "2"],
);

assert.deepEqual(
  filterAndSortRecords({
    records,
    columns,
    filters: [{ fieldMetadataId: "committee", operator: "eq", value: "Finance" }],
    sorts: [{ fieldMetadataId: "name", direction: "asc" }],
    searchTerm: "case",
  }).map((record) => record._id),
  ["3"],
);

assert.deepEqual(
  filterAndSortRecords({
    records,
    columns,
    filters: [],
    sorts: [{ fieldMetadataId: "dues", direction: "desc" }],
  }).map((record) => record._id),
  ["1", "3", "2"],
);

assert.deepEqual(
  filterAndSortRecords({
    records,
    columns,
    filters: [
      { id: "f1", fieldMetadataId: "tags", operator: "contains", value: "board", viewFilterGroupId: "root" },
      { id: "f2", fieldMetadataId: "active", operator: "isFalse", value: null, viewFilterGroupId: "root" },
    ],
    filterGroups: [{ id: "root", logicalOperator: "and" }],
    sorts: [{ fieldMetadataId: "name", direction: "asc" }],
  }).map((record) => record._id),
  ["3"],
);

const urlFilters = serializeViewFiltersToUrl({
  filters: [{ fieldMetadataId: "name", operator: "contains", value: "alex" }],
});
assert.deepEqual(deserializeViewFiltersFromUrl(urlFilters).filters[0], {
  fieldMetadataId: "name",
  operator: "contains",
  value: "alex",
});

assert.ok(getAvailableAggregateOperationsForFieldType(FIELD_TYPES.CURRENCY).includes("percentageNotEmpty"));
assert.equal(
  aggregateRecordValues({
    column: { ...columns[2], aggregateOperation: "countEmpty" },
    records,
  }),
  "1 empty",
);

// A shared view saved by the retired DataTable (column-id filters, a
// { columnId, dir } sort, column state JSON and no view columns) opens as the
// RecordTable equivalent instead of an unfiltered, columnless view.
{
  const legacyFields = [field("f-title", "title", FIELD_TYPES.TEXT), field("f-status", "status", FIELD_TYPES.SELECT), field("f-due", "dueDate", FIELD_TYPES.DATE)].map((column) => column.field);
  const legacyRaw = {
    view: {
      _id: "legacy",
      objectMetadataId: "object",
      name: "Open AGM tasks",
      filtersJson: JSON.stringify([
        { fieldId: "status", operator: "is_not", value: "Done" },
        { fieldId: "__any__", operator: "contains", value: "AGM" },
        { fieldId: "missing", operator: "is", value: "x" },
      ]),
      sortsJson: JSON.stringify([{ columnId: "dueDate", dir: "asc" }]),
      isShared: true,
    },
    columns: [],
  };
  const adapted = adaptLegacyDataTableView(
    hydrateHydratedView(legacyRaw),
    legacyFields,
    JSON.stringify({ hiddenColumns: ["status"], columnWidths: { title: 320 }, columnOrder: ["dueDate"] }),
  )!;
  assert.deepEqual(adapted.view.filters, [{ fieldMetadataId: "f-status", operator: "neq", value: "Done" }], "legacy filters map to fields and RecordTable operators; unknown columns drop");
  assert.equal(adapted.view.searchTerm, "AGM", "any-field text becomes the view search");
  assert.deepEqual(adapted.view.sorts, [{ fieldMetadataId: "f-due", direction: "asc" }], "legacy sort maps to its field");
  assert.deepEqual(adapted.columns.map((column) => [column.field.name, column.isVisible, column.size]), [["dueDate", true, 160], ["title", true, 320], ["status", false, 160]], "column state gives order, widths and hidden columns");
  assert.ok(adapted.columns.every((column) => column.viewFieldId.startsWith("virtual:")), "synthesized columns persist only when the view is saved");
  const modern = hydrateHydratedView({ view: { ...legacyRaw.view, filtersJson: JSON.stringify([{ fieldMetadataId: "f-status", operator: "eq", value: "Open" }]), sortsJson: undefined }, columns: [{ viewField: { _id: "vf", fieldMetadataId: "f-title" }, field: legacyFields[0] }] });
  assert.equal(adaptLegacyDataTableView(modern, legacyFields, "{}"), modern, "RecordTable views pass through untouched");
}

// --- Sorting by field type ---------------------------------------------------
{
  const statusOptions = { options: [{ value: "z_open", label: "Open" }, { value: "a_closed", label: "Closed" }, { value: "m_draft", label: "Awaiting review" }] };
  const typed = [
    field("t-name", "name", FIELD_TYPES.TEXT),
    field("t-amount", "amount", FIELD_TYPES.NUMBER),
    field("t-closes", "closes", FIELD_TYPES.DATE),
    field("t-when", "when", FIELD_TYPES.DATE_TIME),
    { ...field("t-status", "status", FIELD_TYPES.SELECT), field: { ...field("t-status", "status", FIELD_TYPES.SELECT).field, config: statusOptions } },
    field("t-buyer", "buyerId", FIELD_TYPES.RELATION),
    field("t-flag", "flag", FIELD_TYPES.BOOLEAN),
  ];
  const rows = [
    { _id: "a", name: "item 10", amount: "9", closes: "2026-03-01", when: "2026-01-02T10:00:00Z", status: "z_open", buyerId: "id-3", buyerIdLabel: "zeta Works", flag: true },
    { _id: "b", name: "Item 2", amount: 10, closes: "2025-12-31", when: "2026-01-02T09:00:00Z", status: "a_closed", buyerId: "id-1", buyerIdLabel: "Alpha Co", flag: false },
    { _id: "c", name: "", amount: null, closes: null, when: "", status: null, buyerId: null, flag: null },
    { _id: "d", name: "item 1", amount: 100, closes: "2026-01-15", when: "2026-01-01T23:00:00Z", status: "m_draft", buyerId: "id-2", buyerIdLabel: "beta Ltd", flag: true },
  ];
  const order = (fieldMetadataId: string, direction: "asc" | "desc") =>
    sortRecords({ records: rows, columns: typed, sorts: [{ fieldMetadataId, direction }] }).map((row) => row._id);
  assert.deepEqual(order("t-name", "asc"), ["d", "b", "a", "c"], "text sorts case-insensitively in natural order, empty last");
  assert.deepEqual(order("t-name", "desc"), ["a", "b", "d", "c"], "descending text keeps empties last");
  assert.deepEqual(order("t-amount", "asc"), ["a", "b", "d", "c"], "numbers sort numerically (\"9\" before 10), empty last");
  assert.deepEqual(order("t-amount", "desc"), ["d", "b", "a", "c"], "descending numbers keep empties last");
  assert.deepEqual(order("t-closes", "asc"), ["b", "d", "a", "c"], "dates sort chronologically");
  assert.deepEqual(order("t-closes", "desc"), ["a", "d", "b", "c"], "descending dates keep empties last");
  assert.deepEqual(order("t-when", "asc"), ["d", "b", "a", "c"], "timestamps sort by instant");
  assert.deepEqual(order("t-status", "asc"), ["d", "b", "a", "c"], "options sort by the label shown, not the stored key");
  assert.deepEqual(order("t-buyer", "asc"), ["b", "d", "a", "c"], "relations sort by display name, not id");
  assert.deepEqual(order("t-flag", "asc"), ["b", "a", "d", "c"], "booleans sort no before yes, ties stable, empty last");
  const accented = ["Zoë", "zeta", "Émile", "eagle", "Item 10", "item 9"].map((name, index) => ({ _id: String(index), name }));
  assert.deepEqual(
    sortRecords({ records: accented, columns: typed, sorts: [{ fieldMetadataId: "t-name", direction: "asc" }] }).map((row) => row.name),
    ["eagle", "Émile", "item 9", "Item 10", "zeta", "Zoë"],
    "accented text sorts by the collator (é with e), still natural and case-insensitive",
  );
  assert.deepEqual(
    sortRecords({ records: rows, columns: typed, sorts: [{ fieldMetadataId: "t-flag", direction: "desc" }, { fieldMetadataId: "t-amount", direction: "asc" }] }).map((row) => row._id),
    ["a", "d", "b", "c"],
    "a second rule breaks the first rule's ties",
  );

  // Filters read labels the way people see them.
  const filter = (filters: Parameters<typeof filterRecords>[0]["filters"], searchTerm?: string) =>
    filterRecords({ records: rows, columns: typed, filters, searchTerm }).map((row) => row._id);
  assert.deepEqual(filter([{ fieldMetadataId: "t-status", operator: "eq", value: "Awaiting review" }]), ["d"], "an option filter matches a typed label");
  assert.deepEqual(filter([{ fieldMetadataId: "t-status", operator: "contains", value: "review" }]), ["d"], "contains on an option matches its label");
  assert.deepEqual(filter([{ fieldMetadataId: "t-buyer", operator: "in", value: ["alpha co", "Zeta Works"] }]), ["a", "b"], "relation 'is any of' matches display names");
  assert.deepEqual(filter([{ fieldMetadataId: "t-buyer", operator: "eq", value: "id-2" }]), ["d"], "relation 'is' still matches ids");
  assert.deepEqual(filter([{ fieldMetadataId: "t-name", operator: "in", value: ["ITEM 2", "item 1"] }]), ["b", "d"], "text 'is any of' ignores case");
  assert.deepEqual(filter([{ fieldMetadataId: "t-name", operator: "notIn", value: ["item 2"] }]), ["a", "c", "d"], "text 'is none of'");
  assert.deepEqual(filter([{ fieldMetadataId: "t-amount", operator: "lt", value: 50 }]), ["a", "b"], "an empty number is not 'less than' anything");
  assert.deepEqual(filter([], "awaiting"), ["d"], "search finds option labels");
  assert.deepEqual(filter([], "beta"), ["d"], "search finds relation names");
  assert.deepEqual(filter([], "m_draft"), ["d"], "search still finds stored option keys");
}

// --- Distinct values for the free-text filter picker ---------------------------
{
  const buyer = field("p-buyer", "buyer", FIELD_TYPES.TEXT);
  const tags = field("p-tags", "tags", FIELD_TYPES.ARRAY);
  const rows = [
    { buyer: "City of Prince George", tags: ["roads", "roads", "snow"] },
    { buyer: "city of prince george", tags: ["roads"] },
    { buyer: "BC Hydro", tags: [] },
    { buyer: "  ", tags: null },
    { buyer: "Northern Health", tags: ["health"] },
    { buyer: "BC Hydro", tags: ["snow"] },
    { buyer: "BC Hydro" },
  ];
  const values = distinctFieldValues(rows, buyer.field);
  assert.deepEqual(values.map((value) => [value.label, value.count]), [["BC Hydro", 3], ["City of Prince George", 2], ["Northern Health", 1]], "most common first, case-folded, blanks skipped");
  assert.deepEqual(distinctFieldValues(rows, tags.field).map((value) => [value.label, value.count]), [["roads", 2], ["snow", 2], ["health", 1]], "list entries count once per record");
  const many = Array.from({ length: 5000 }, (_, index) => ({ buyer: `Buyer ${index % 2500}` }));
  const manyValues = distinctFieldValues(many, buyer.field);
  assert.equal(manyValues.length, 2500);
  const { shown, matched } = searchDistinctValues(manyValues, "buyer 24", 100);
  assert.equal(shown.length, 100, "the visible list is capped");
  assert.equal(matched, 111, "the match count covers the whole list (24, 240–249, 2400–2499)");
  assert.equal(supportsValuePicker(buyer.field), true);
  assert.equal(supportsValuePicker(field("p-n", "n", FIELD_TYPES.NUMBER).field), false, "numbers keep their comparisons");
}

// --- Display: continuous scroll or pages -------------------------------------
{
  const defaults = { mode: "continuous" as const, pageSize: 50 };
  const grouped = withViewGroupBy([], { fieldMetadataId: "status", sort: "label", direction: "asc" });
  const paged = chooseRecordTableDisplay(grouped, { mode: "pages", pageSize: 25 }, defaults);
  assert.deepEqual(getViewDisplay(paged), { mode: "pages", pageSize: 25 }, "the choice rides in the view's groups");
  assert.equal(getViewGroupBy(paged)?.fieldMetadataId, "status", "the group-by entry is kept");
  assert.equal(getViewGroupBy(withViewGroupBy(paged, null)), null);
  assert.deepEqual(getViewDisplay(withViewGroupBy(paged, null)), { mode: "pages", pageSize: 25 }, "clearing the group-by keeps the display");
  assert.deepEqual(chooseRecordTableDisplay(paged, defaults, defaults), grouped, "back to the default leaves no entry (not an unsaved change)");
  assert.deepEqual(resolveRecordTableDisplay([], { mode: "pages", pageSize: 100 }), { mode: "pages", pageSize: 100 }, "the scope's default applies until a view chooses");
  assert.deepEqual(resolveRecordTableDisplay(withViewDisplay([], { mode: "pages", pageSize: 9999 }), defaults), { mode: "pages", pageSize: 50 }, "a broken page size falls back");

  assert.deepEqual(describePage(1, 3752, 50), { index: 1, count: 76, size: 50, start: 50, end: 100, total: 3752 });
  assert.equal(describePage(99, 120, 50).index, 2, "a page past the end lands on the last page");
  assert.deepEqual(describePage(0, 0, 50), { index: 0, count: 1, size: 50, start: 0, end: 0, total: 0 });

  // Pages slice the sorted, filtered list (sort first, then page).
  const statusColumn = field("g-status", "status", FIELD_TYPES.TEXT);
  const nameColumn = field("g-name", "name", FIELD_TYPES.TEXT);
  const records = Array.from({ length: 7 }, (_, index) => ({ _id: `r${index}`, name: `Name ${7 - index}`, status: index < 3 ? "A" : index < 4 ? "B" : "C" }));
  const sorted = sortRecords({ records, columns: [nameColumn, statusColumn], sorts: [{ fieldMetadataId: "g-name", direction: "asc" }] });
  const flat = pageRowModel(buildRowModel({ filtered: sorted, columns: [nameColumn], groupBy: null, collapsedGroupKeys: new Set() }), 1, 3);
  assert.deepEqual(flat.items.map((item) => (item.kind === "record" ? item.record.name : "")), ["Name 4", "Name 5", "Name 6"], "page two of the sorted list");
  assert.deepEqual(flat.items.map((item) => (item.kind === "record" ? item.rowIndex : -1)), [3, 4, 5], "rows keep their place in the whole list");
  assert.equal(flat.records.length, 7, "keyboard moves and the preview panel walk the whole list");
  assert.equal(flat.itemIndexByRowIndex[4], 1);

  const groupBy = { fieldMetadataId: "g-status", sort: "label" as const, direction: "asc" as const };
  const model = buildRowModel({ filtered: records, columns: [nameColumn, statusColumn], groupBy, collapsedGroupKeys: new Set(["b"]) });
  const labels = (pageIndex: number) =>
    pageItems(model.items, describePage(pageIndex, model.records.length, 2)).map((item) => (item.kind === "group" ? `[${item.group.label}]` : item.record._id));
  assert.deepEqual(labels(0), ["[A]", "r0", "r1"]);
  assert.deepEqual(labels(1), ["[A]", "r2", "[B]", "[C]", "r4"], "a continuing group repeats its header; a folded group shows where it falls");
  assert.deepEqual(labels(2), ["[C]", "r5", "r6"]);

  // The open page goes back to the first when the list changes, not when more records arrive.
  const store = createRecordTableStore({ tableId: "t", objectMetadataId: "o" });
  store.getState().setPageIndex(3);
  store.getState().setRecords([{ _id: "x" }]);
  assert.equal(store.getState().pageIndex, 3, "more records keep the page");
  store.getState().setSorts([{ fieldMetadataId: "g-name", direction: "desc" }]);
  assert.equal(store.getState().pageIndex, 0, "a new sort starts at page one");
  store.getState().setPageIndex(2);
  store.getState().setSearchTerm("abc");
  assert.equal(store.getState().pageIndex, 0, "a new search starts at page one");
  store.getState().setPageIndex(2);
  store.setState({ filters: [{ fieldMetadataId: "g-name", operator: "contains", value: "a" }] });
  assert.equal(store.getState().pageIndex, 0, "a new filter (however it is set) starts at page one");
}

console.log("record table utility checks passed");
