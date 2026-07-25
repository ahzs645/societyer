import type { FieldType } from "./FieldType";

/**
 * Runtime representation of a field definition. Mirrors the shape of a
 * `fieldMetadata` Convex row, but with `configJson` pre-parsed and `_id`
 * widened to a plain string so components don't need to know Convex's
 * generic Id type.
 */
export type FieldMetadata = {
  _id: string;
  objectMetadataId: string;
  name: string;
  label: string;
  description?: string;
  icon?: string;
  fieldType: FieldType;
  config: Record<string, any>;
  defaultValue: unknown;
  isSystem: boolean;
  isHidden: boolean;
  isNullable: boolean;
  /** True for computed / server-managed columns (timestamps, IDs,
   *  joined data). The cell still renders, but inline editing is
   *  suppressed. */
  isReadOnly: boolean;
  position: number;
};

/**
 * Normalize a raw Convex row into a FieldMetadata object. Handles the
 * configJson/defaultValueJson parsing + widens Id types. Callers of
 * Convex queries should pipe rows through this before handing them to
 * the table.
 */
export function hydrateFieldMetadata(raw: any): FieldMetadata {
  return {
    _id: String(raw._id),
    objectMetadataId: String(raw.objectMetadataId),
    name: raw.name,
    label: raw.label,
    description: raw.description,
    icon: raw.icon,
    fieldType: raw.fieldType,
    config: raw.configJson ? safeParse(raw.configJson) : {},
    defaultValue: raw.defaultValueJson ? safeParse(raw.defaultValueJson) : undefined,
    isSystem: !!raw.isSystem,
    isHidden: !!raw.isHidden,
    isNullable: !!raw.isNullable,
    isReadOnly: !!raw.isReadOnly,
    position: Number(raw.position ?? 0),
  };
}

function safeParse(json: string) {
  try {
    return JSON.parse(json);
  } catch {
    return {};
  }
}
