import assert from "node:assert/strict";
import { FIELD_TYPES, type FieldType } from "../src/platform/record-engine/types/FieldType";
import type { FieldMetadata, RecordField } from "../src/platform/record-engine/types";
import { aggregateRecordValues, getAvailableAggregateOperationsForFieldType } from "../src/platform/record-engine/record-table/utils/aggregateOperations";
import { filterAndSortRecords } from "../src/platform/record-engine/record-table/utils/filterAndSortRecords";
import { deserializeViewFiltersFromUrl, serializeViewFiltersToUrl } from "../src/platform/record-engine/record-table/utils/viewFilterGroups";
import { adaptLegacyDataTableView } from "../src/platform/record-engine/record-table/utils/legacyDataTableView";
import { hydrateHydratedView } from "../src/platform/record-engine/types";

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

console.log("record table utility checks passed");
