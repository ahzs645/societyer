import assert from "node:assert/strict";
import { FIELD_TYPES, type FieldType } from "../src/modules/object-record/types/FieldType";
import type { FieldMetadata, RecordField } from "../src/modules/object-record/types";
import { aggregateRecordValues, getAvailableAggregateOperationsForFieldType } from "../src/modules/object-record/record-table/utils/aggregateOperations";
import { filterAndSortRecords } from "../src/modules/object-record/record-table/utils/filterAndSortRecords";
import { deserializeViewFiltersFromUrl, serializeViewFiltersToUrl } from "../src/modules/object-record/record-table/utils/viewFilterGroups";

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

console.log("record table utility checks passed");
