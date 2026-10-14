import type { FieldMetadata } from "./FieldMetadata";
import { hydrateFieldMetadata } from "./FieldMetadata";

/**
 * Per-view column — a viewField row joined to its fieldMetadata. The
 * RecordTable renders one header/cell per RecordField.
 */
export type RecordField = {
  viewFieldId: string;
  fieldMetadataId: string;
  position: number;
  size: number;
  isVisible: boolean;
  aggregateOperation?: AggregateOperation | null;
  viewFieldGroupId?: string | null;
  field: FieldMetadata;
};

export type AggregateOperation =
  | "sum"
  | "avg"
  | "count"
  | "countEmpty"
  | "countNotEmpty"
  | "countUniqueValues"
  | "percentageEmpty"
  | "percentageNotEmpty"
  | "min"
  | "max";

export type ViewFilter = {
  id?: string;
  fieldMetadataId: string;
  operator: ViewFilterOperator;
  value: unknown;
  viewFilterGroupId?: string | null;
  positionInViewFilterGroup?: number | null;
  subFieldName?: string | null;
};

export type ViewFilterOperator =
  | "eq"
  | "neq"
  | "contains"
  | "notContains"
  | "startsWith"
  | "endsWith"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "in"
  | "notIn"
  | "isEmpty"
  | "isNotEmpty"
  | "isTrue"
  | "isFalse"
  /** Date range. The value is a `DateRangeValue` (`{ preset }` or
   * `{ start, end }`); presets resolve against the organisation's calendar
   * every time the filter runs, so "Last 30 days" stays relative. */
  | "between";

export type ViewSortDirection = "asc" | "desc";

export type ViewSort = {
  id?: string;
  fieldMetadataId: string;
  direction: ViewSortDirection;
};

export type ViewFilterGroupLogicalOperator = "and" | "or";

export type ViewFilterGroup = {
  id: string;
  parentViewFilterGroupId?: string | null;
  logicalOperator: ViewFilterGroupLogicalOperator;
  positionInViewFilterGroup?: number | null;
};

export type ViewFieldGroup = {
  id: string;
  name: string;
  position: number;
  isVisible: boolean;
  fieldMetadataIds?: string[];
};

export type ViewGroup = {
  id: string;
  fieldValue: string;
  position: number;
  isVisible: boolean;
  /**
   * The view's group-by setting rides in `viewGroupsJson` as one entry that
   * carries this key (see `utils/groupRecords.ts`), so grouping saves, reverts
   * and dirty-checks with the rest of the view without a schema change.
   */
  groupBy?: ViewGroupBy;
};

export type ViewGroupDateGranularity = "day" | "month" | "quarter" | "year";

/**
 * Group order. "field" keeps the field's own option order (selects,
 * booleans); "label" is alphabetical (chronological for dates, numeric for
 * numbers); "count" orders by group size; "sum" by the group total of
 * `sumFieldMetadataId` (a currency or number column).
 */
export type ViewGroupSortKey = "field" | "label" | "count" | "sum";

export type ViewGroupBy = {
  fieldMetadataId: string;
  dateGranularity?: ViewGroupDateGranularity;
  sort?: ViewGroupSortKey;
  direction?: ViewSortDirection;
  sumFieldMetadataId?: string;
};

export type ViewVisibility = "personal" | "shared" | "system";
export type ViewOpenRecordIn = "drawer" | "page";
export type ViewType = "table" | "kanban" | "board" | "calendar";
export type ViewCalendarLayout = "month" | "week" | "list";

export type View = {
  _id: string;
  objectMetadataId: string;
  name: string;
  icon?: string;
  type: ViewType;
  kanbanFieldMetadataId?: string;
  kanbanAggregateOperation?: AggregateOperation | null;
  kanbanAggregateOperationFieldMetadataId?: string | null;
  calendarFieldMetadataId?: string;
  calendarLayout?: ViewCalendarLayout | null;
  filters: ViewFilter[];
  filterGroups: ViewFilterGroup[];
  sorts: ViewSort[];
  fieldGroups: ViewFieldGroup[];
  groups: ViewGroup[];
  searchTerm?: string;
  anyFieldFilterValue?: string;
  density: "compact" | "comfortable";
  visibility: ViewVisibility;
  openRecordIn: ViewOpenRecordIn;
  isShared: boolean;
  isSystem: boolean;
  position: number;
};

export type HydratedView = {
  view: View;
  columns: RecordField[];
};

export function hydrateView(raw: any): View {
  return {
    _id: String(raw._id),
    objectMetadataId: String(raw.objectMetadataId),
    name: raw.name,
    icon: raw.icon,
    type: normalizeViewType(raw.type),
    kanbanFieldMetadataId: raw.kanbanFieldMetadataId
      ? String(raw.kanbanFieldMetadataId)
      : undefined,
    kanbanAggregateOperation: raw.kanbanAggregateOperation ?? null,
    kanbanAggregateOperationFieldMetadataId: raw.kanbanAggregateOperationFieldMetadataId
      ? String(raw.kanbanAggregateOperationFieldMetadataId)
      : undefined,
    calendarFieldMetadataId: raw.calendarFieldMetadataId
      ? String(raw.calendarFieldMetadataId)
      : undefined,
    calendarLayout: raw.calendarLayout === "week" || raw.calendarLayout === "list" ? raw.calendarLayout : "month",
    filters: parseJsonArray<ViewFilter>(raw.filtersJson),
    filterGroups: parseJsonArray<ViewFilterGroup>(raw.viewFilterGroupsJson ?? raw.filterGroupsJson),
    sorts: parseJsonArray<ViewSort>(raw.sortsJson),
    fieldGroups: parseJsonArray<ViewFieldGroup>(raw.viewFieldGroupsJson ?? raw.fieldGroupsJson),
    groups: parseJsonArray<ViewGroup>(raw.viewGroupsJson ?? raw.groupsJson),
    searchTerm: raw.searchTerm,
    anyFieldFilterValue: raw.anyFieldFilterValue,
    density: (raw.density ?? "compact") as View["density"],
    visibility: normalizeVisibility(raw.visibility, !!raw.isShared, !!raw.isSystem),
    openRecordIn: (raw.openRecordIn ?? "drawer") as ViewOpenRecordIn,
    isShared: raw.visibility ? raw.visibility === "shared" || raw.visibility === "system" : !!raw.isShared,
    isSystem: !!raw.isSystem,
    position: Number(raw.position ?? 0),
  };
}

export function hydrateHydratedView(raw: any): HydratedView | null {
  if (!raw) return null;
  const view = hydrateView(raw.view);
  const columns: RecordField[] = (raw.columns ?? []).map((entry: any) => ({
    viewFieldId: String(entry.viewField._id),
    fieldMetadataId: String(entry.viewField.fieldMetadataId),
    position: Number(entry.viewField.position ?? 0),
    size: Number(entry.viewField.size ?? 160),
    isVisible: entry.viewField.isVisible !== false,
    aggregateOperation: entry.viewField.aggregateOperation ?? null,
    viewFieldGroupId: entry.viewField.viewFieldGroupId ? String(entry.viewField.viewFieldGroupId) : null,
    field: hydrateFieldMetadata(entry.field),
  }));
  return { view, columns };
}

function parseJsonArray<T>(raw: string | undefined): T[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function normalizeViewType(value: unknown): ViewType {
  return value === "kanban" || value === "board" || value === "calendar" || value === "table"
    ? value
    : "table";
}

function normalizeVisibility(
  value: unknown,
  isShared: boolean,
  isSystem: boolean,
): ViewVisibility {
  if (value === "personal" || value === "shared" || value === "system") return value;
  if (isSystem) return "system";
  if (isShared) return "shared";
  return "personal";
}
