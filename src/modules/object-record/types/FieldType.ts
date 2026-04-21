/**
 * Canonical list of field types understood by the RecordTable.
 *
 * Adding a new type is a 3-step process:
 *   1. Add the tag here.
 *   2. Create a `<NewTypeFieldDisplay>` component in `record-field/components/display/`.
 *   3. Register it in `record-field/components/FieldDisplay.tsx`.
 *
 * The server (`fieldMetadata.fieldType`) stores the same strings.
 */
export const FIELD_TYPES = {
  TEXT: "TEXT",
  NUMBER: "NUMBER",
  CURRENCY: "CURRENCY",
  BOOLEAN: "BOOLEAN",
  DATE: "DATE",
  DATE_TIME: "DATE_TIME",
  SELECT: "SELECT",
  MULTI_SELECT: "MULTI_SELECT",
  EMAIL: "EMAIL",
  PHONE: "PHONE",
  LINK: "LINK",
  RELATION: "RELATION",
  RATING: "RATING",
  UUID: "UUID",
  ARRAY: "ARRAY",
} as const;

export type FieldType = (typeof FIELD_TYPES)[keyof typeof FIELD_TYPES];

export function isKnownFieldType(value: string): value is FieldType {
  return (Object.values(FIELD_TYPES) as readonly string[]).includes(value);
}

/* -------------------- Per-type configuration shapes -------------------- */
// These are the schemas stored in `fieldMetadata.configJson`. Keep them
// serializable — they round-trip through JSON.

export type TextFieldConfig = { placeholder?: string };

export type NumberFieldConfig = {
  decimals?: number;
  prefix?: string;
  suffix?: string;
};

export type CurrencyFieldConfig = {
  currencyCode?: "USD" | "CAD" | "EUR" | "GBP" | string;
  /** When true, the raw value is stored in cents and divided for display. */
  isCents?: boolean;
  decimals?: number;
};

export type BooleanFieldConfig = {
  trueLabel?: string;
  falseLabel?: string;
};

export type DateFieldConfig = {
  includeTime?: boolean;
};

export type SelectOption = {
  value: string;
  label: string;
  color?: string; // semantic tone — blue | green | red | amber | purple | teal | gray
};

export type SelectFieldConfig = {
  options: SelectOption[];
};

export type RelationFieldConfig = {
  targetObjectNamePlural: string;
  /** Which field on the target record acts as its label (defaults to the
   * target object's labelIdentifierFieldName). */
  targetLabelFieldName?: string;
  kind?: "many-to-one" | "one-to-many" | "many-to-many";
};

export type RatingFieldConfig = {
  max?: number;
};

export type LinkFieldConfig = {
  labelPattern?: string; // {value} gets replaced by the URL
};
