import type { FieldMetadata } from "../../types/FieldMetadata";
import type { HydratedView, RecordField } from "../../types/View";

/** Columns added for fields the saved view doesn't include yet. */
export const VIRTUAL_COLUMN_PREFIX = "virtual:";

export function isVirtualColumn(column: Pick<RecordField, "viewFieldId">) {
  return column.viewFieldId.startsWith(VIRTUAL_COLUMN_PREFIX);
}

/**
 * Append every object field the view has no column for, hidden. Filters and
 * sorts (including a seeded view's own filters) can then use any field, and the
 * column picker can show one. Nothing is persisted until the person shows such
 * a column and saves the view (see usePersistView).
 */
export function withHiddenObjectFields(view: HydratedView | null, fields: FieldMetadata[] | undefined): HydratedView | null {
  if (!view || !fields?.length) return view;
  const present = new Set(view.columns.map((column) => column.fieldMetadataId));
  const missing = fields.filter((field) => !present.has(String(field._id)) && !field.isHidden);
  if (!missing.length) return view;
  let position = view.columns.reduce((max, column) => Math.max(max, column.position), -1) + 1;
  const extra: RecordField[] = missing.map((field) => ({
    viewFieldId: `${VIRTUAL_COLUMN_PREFIX}${field._id}`,
    fieldMetadataId: String(field._id),
    position: position++,
    size: 160,
    isVisible: false,
    aggregateOperation: null,
    viewFieldGroupId: null,
    field,
  }));
  return { ...view, columns: [...view.columns, ...extra] };
}
