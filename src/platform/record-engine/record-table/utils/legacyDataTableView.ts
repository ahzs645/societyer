import type { FieldMetadata } from "../../types/FieldMetadata";
import { FIELD_TYPES } from "../../types/FieldType";
import type { HydratedView, RecordField, ViewFilter, ViewFilterOperator, ViewSort } from "../../types/View";
import { VIRTUAL_COLUMN_PREFIX } from "./hiddenObjectFields";

/**
 * Shared views saved by the retired DataTable live in the same `views` table
 * RecordTable reads, but in the DataTable's shape: filters keyed by column id
 * (`{ fieldId, operator: "is_not", value }`, `"__any__"` for any-field text),
 * a `{ columnId, dir }` sort, and hidden columns / widths / order in
 * `columnStateJson` with no viewField rows. Read such a view as the RecordTable
 * equivalent so it still opens with its slice of records and its columns:
 * column ids are matched to field names. Conditions that cannot be expressed
 * are dropped (the view then shows more, never fewer, records). Saving the view
 * from the table rewrites it in the RecordTable shape.
 */

type LegacyFilter = { fieldId?: unknown; operator?: unknown; value?: unknown };
type LegacySort = { columnId?: unknown; dir?: unknown };
type LegacyColumnState = { hiddenColumns?: unknown; columnWidths?: unknown; columnOrder?: unknown };

const OPERATORS: Record<string, ViewFilterOperator> = {
  contains: "contains",
  equals: "eq",
  is: "eq",
  is_not: "neq",
  starts_with: "startsWith",
  lt: "lt",
  before: "lt",
  gt: "gt",
  after: "gt",
};

const EXACT_MATCH_TYPES = new Set<string>([FIELD_TYPES.SELECT, FIELD_TYPES.MULTI_SELECT, FIELD_TYPES.BOOLEAN]);

function isLegacyFilter(entry: unknown): entry is LegacyFilter {
  return !!entry && typeof entry === "object" && !("fieldMetadataId" in entry) && "fieldId" in entry;
}

function isLegacySort(entry: unknown): entry is LegacySort {
  return !!entry && typeof entry === "object" && !("fieldMetadataId" in entry) && "columnId" in entry;
}

function parseColumnState(raw: unknown): LegacyColumnState | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

export function adaptLegacyDataTableView(
  hydrated: HydratedView | null,
  fields: FieldMetadata[] | undefined,
  columnStateJson?: unknown,
): HydratedView | null {
  if (!hydrated || !fields?.length) return hydrated;
  const view = hydrated.view;
  const legacyFilters = (view.filters as unknown[]).filter(isLegacyFilter);
  const legacySorts = (view.sorts as unknown[]).filter(isLegacySort);
  const columnState = hydrated.columns.length === 0 ? parseColumnState(columnStateJson) ?? {} : null;
  if (!legacyFilters.length && !legacySorts.length && !columnState) return hydrated;

  const byName = new Map(fields.map((field) => [field.name.toLowerCase(), field]));
  const fieldFor = (id: unknown) => (typeof id === "string" ? byName.get(id.toLowerCase()) : undefined);

  let searchTerm = view.searchTerm;
  const filters: ViewFilter[] = [];
  for (const entry of view.filters as unknown[]) {
    if (!isLegacyFilter(entry)) {
      filters.push(entry as ViewFilter);
      continue;
    }
    const value = typeof entry.value === "string" ? entry.value.trim() : entry.value;
    if (value === "" || value == null) continue;
    if (entry.fieldId === "__any__") {
      if (!searchTerm && typeof value === "string") searchTerm = value;
      continue;
    }
    const field = fieldFor(entry.fieldId);
    if (!field) continue;
    const operator = typeof entry.operator === "string"
      ? OPERATORS[entry.operator]
      : EXACT_MATCH_TYPES.has(field.fieldType) ? "eq" : "contains";
    if (!operator) continue;
    filters.push({ fieldMetadataId: String(field._id), operator, value });
  }

  const sorts: ViewSort[] = [];
  for (const entry of view.sorts as unknown[]) {
    if (!isLegacySort(entry)) {
      sorts.push(entry as ViewSort);
      continue;
    }
    const field = fieldFor(entry.columnId);
    if (field) sorts.push({ fieldMetadataId: String(field._id), direction: entry.dir === "desc" ? "desc" : "asc" });
  }

  let columns = hydrated.columns;
  if (columnState) {
    // A DataTable view has no column rows: show the object's fields, minus
    // the ones it hid, in its saved order and widths.
    const hidden = new Set(stringList(columnState.hiddenColumns).map((id) => id.toLowerCase()));
    const order = stringList(columnState.columnOrder).map((id) => id.toLowerCase());
    const widths = columnState.columnWidths && typeof columnState.columnWidths === "object" && !Array.isArray(columnState.columnWidths)
      ? Object.fromEntries(Object.entries(columnState.columnWidths as Record<string, unknown>).map(([key, size]) => [key.toLowerCase(), size]))
      : {};
    const rank = (field: FieldMetadata) => {
      const index = order.indexOf(field.name.toLowerCase());
      return index === -1 ? order.length + fields.indexOf(field) : index;
    };
    columns = fields
      .filter((field) => !field.isHidden)
      .slice()
      .sort((a, b) => rank(a) - rank(b))
      .map((field, position): RecordField => {
        const size = widths[field.name.toLowerCase()];
        return {
          viewFieldId: `${VIRTUAL_COLUMN_PREFIX}${field._id}`,
          fieldMetadataId: String(field._id),
          position,
          size: typeof size === "number" && size > 0 ? size : 160,
          isVisible: !hidden.has(field.name.toLowerCase()),
          aggregateOperation: null,
          viewFieldGroupId: null,
          field,
        };
      });
  }

  return { view: { ...view, filters, sorts, searchTerm }, columns };
}
