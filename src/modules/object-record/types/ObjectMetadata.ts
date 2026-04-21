import type { FieldMetadata } from "./FieldMetadata";
import { hydrateFieldMetadata } from "./FieldMetadata";

/**
 * Runtime representation of an object definition. Bundled with its fields
 * because the RecordTable always needs both.
 */
export type ObjectMetadata = {
  _id: string;
  nameSingular: string;
  namePlural: string;
  labelSingular: string;
  labelPlural: string;
  description?: string;
  icon?: string;
  iconColor?: string;
  labelIdentifierFieldName?: string;
  imageIdentifierFieldName?: string;
  isSystem: boolean;
  isActive: boolean;
  routePath?: string;
  fields: FieldMetadata[];
};

/**
 * Accepts the flat denormalized shape returned by
 * `api.objectMetadata.getFullTableSetup` — `{ ...object, fields: [...] }` —
 * as well as the legacy wrapped `{ object, fields }` shape.
 */
export function hydrateObjectMetadata(raw: any): ObjectMetadata {
  const isLegacyWrapped =
    raw && typeof raw === "object" && "object" in raw && "fields" in raw;
  const object = isLegacyWrapped ? raw.object : raw;
  const fields: any[] = isLegacyWrapped ? raw.fields : (raw.fields ?? []);
  return {
    _id: String(object._id),
    nameSingular: object.nameSingular,
    namePlural: object.namePlural,
    labelSingular: object.labelSingular,
    labelPlural: object.labelPlural,
    description: object.description,
    icon: object.icon,
    iconColor: object.iconColor,
    labelIdentifierFieldName: object.labelIdentifierFieldName,
    imageIdentifierFieldName: object.imageIdentifierFieldName,
    isSystem: !!object.isSystem,
    isActive: object.isActive !== false,
    routePath: object.routePath,
    fields: fields.map(hydrateFieldMetadata),
  };
}
