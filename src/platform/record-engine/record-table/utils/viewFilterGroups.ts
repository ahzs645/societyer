import type { RecordField, ViewFilter, ViewFilterGroup } from "../../types/View";
import { applyRecordFilter } from "./filterRecords";
import type { DateRangeContext } from "../../../../lib/dateRanges";

export type SerializedViewFilters = {
  filters?: Record<string, Record<string, string | string[]>>;
  filterGroup?: SerializedViewFilterGroup;
};

export type SerializedViewFilterGroup = {
  operator: "and" | "or";
  filters?: Array<{
    field: string;
    op: ViewFilter["operator"];
    value: string;
    subField?: string;
  }>;
  groups?: SerializedViewFilterGroup[];
};

export function recordMatchesViewFilters({
  record,
  columns,
  filters,
  filterGroups,
  dateContext,
}: {
  record: any;
  columns: RecordField[];
  filters: ViewFilter[];
  filterGroups?: ViewFilterGroup[];
  dateContext?: DateRangeContext;
}) {
  const fieldById = new Map(columns.map((column) => [column.fieldMetadataId, column]));
  if (!filterGroups || filterGroups.length === 0) {
    return filters.every((filter) =>
      applyRecordFilter(record, fieldById.get(filter.fieldMetadataId), filter, dateContext),
    );
  }

  const rootGroups = filterGroups.filter((group) => !group.parentViewFilterGroupId);
  if (rootGroups.length === 0) {
    return filters.every((filter) =>
      applyRecordFilter(record, fieldById.get(filter.fieldMetadataId), filter, dateContext),
    );
  }

  return rootGroups.every((group) =>
    matchesGroup({ record, fieldById, filters, filterGroups, groupId: group.id, dateContext }),
  );
}

function matchesGroup({
  record,
  fieldById,
  filters,
  filterGroups,
  groupId,
  dateContext,
}: {
  record: any;
  fieldById: Map<string, RecordField>;
  filters: ViewFilter[];
  filterGroups: ViewFilterGroup[];
  groupId: string;
  dateContext?: DateRangeContext;
}) {
  const group = filterGroups.find((entry) => entry.id === groupId);
  if (!group) return true;

  const childResults = [
    ...filters
      .filter((filter) => filter.viewFilterGroupId === groupId)
      .sort((a, b) => (a.positionInViewFilterGroup ?? 0) - (b.positionInViewFilterGroup ?? 0))
      .map((filter) => applyRecordFilter(record, fieldById.get(filter.fieldMetadataId), filter, dateContext)),
    ...filterGroups
      .filter((child) => child.parentViewFilterGroupId === groupId)
      .sort((a, b) => (a.positionInViewFilterGroup ?? 0) - (b.positionInViewFilterGroup ?? 0))
      .map((child) =>
        matchesGroup({ record, fieldById, filters, filterGroups, groupId: child.id, dateContext }),
      ),
  ];

  if (childResults.length === 0) return true;
  return group.logicalOperator === "or"
    ? childResults.some(Boolean)
    : childResults.every(Boolean);
}

export function serializeViewFiltersToUrl({
  filters,
  filterGroups,
}: {
  filters: ViewFilter[];
  filterGroups?: ViewFilterGroup[];
}): SerializedViewFilters {
  const quickFilters = filters.filter((filter) => !filter.viewFilterGroupId);
  const serialized: SerializedViewFilters = {};
  if (quickFilters.length > 0) {
    serialized.filters = {};
    for (const filter of quickFilters) {
      serialized.filters[filter.fieldMetadataId] ??= {};
      serialized.filters[filter.fieldMetadataId][filter.operator] = Array.isArray(filter.value)
        ? filter.value.map(String)
        : String(filter.value ?? "");
    }
  }

  const root = filterGroups?.find((group) => !group.parentViewFilterGroupId);
  if (root) {
    serialized.filterGroup = serializeGroup(root, filters, filterGroups ?? []);
  }
  return serialized;
}

function serializeGroup(
  group: ViewFilterGroup,
  filters: ViewFilter[],
  groups: ViewFilterGroup[],
): SerializedViewFilterGroup {
  return {
    operator: group.logicalOperator,
    filters: filters
      .filter((filter) => filter.viewFilterGroupId === group.id)
      .map((filter) => ({
        field: filter.fieldMetadataId,
        op: filter.operator,
        value: typeof filter.value === "object" && filter.value !== null ? JSON.stringify(filter.value) : String(filter.value ?? ""),
        subField: filter.subFieldName ?? undefined,
      })),
    groups: groups
      .filter((child) => child.parentViewFilterGroupId === group.id)
      .map((child) => serializeGroup(child, filters, groups)),
  };
}

export function deserializeViewFiltersFromUrl(
  value: SerializedViewFilters,
): { filters: ViewFilter[]; filterGroups: ViewFilterGroup[] } {
  const filters: ViewFilter[] = [];
  const filterGroups: ViewFilterGroup[] = [];

  for (const [fieldMetadataId, operators] of Object.entries(value.filters ?? {})) {
    for (const [operator, filterValue] of Object.entries(operators)) {
      filters.push({
        fieldMetadataId,
        operator: operator as ViewFilter["operator"],
        value: filterValue,
      });
    }
  }

  if (value.filterGroup) {
    inflateGroup(value.filterGroup, null, filters, filterGroups);
  }

  return { filters, filterGroups };
}

function inflateGroup(
  group: SerializedViewFilterGroup,
  parentId: string | null,
  filters: ViewFilter[],
  filterGroups: ViewFilterGroup[],
) {
  const id = `fg_${filterGroups.length + 1}`;
  filterGroups.push({
    id,
    parentViewFilterGroupId: parentId,
    logicalOperator: group.operator,
    positionInViewFilterGroup: filterGroups.length,
  });
  group.filters?.forEach((filter, index) => {
    filters.push({
      id: `f_${filters.length + 1}`,
      fieldMetadataId: filter.field,
      operator: filter.op,
      value: filter.value,
      subFieldName: filter.subField,
      viewFilterGroupId: id,
      positionInViewFilterGroup: index,
    });
  });
  group.groups?.forEach((child) => inflateGroup(child, id, filters, filterGroups));
}
