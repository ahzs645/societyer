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
  ADDRESS: "ADDRESS",
  FULL_NAME: "FULL_NAME",
  RICH_TEXT: "RICH_TEXT",
  RAW_JSON: "RAW_JSON",
  EMAILS: "EMAILS",
  PHONES: "PHONES",
  LINKS: "LINKS",
  FILES: "FILES",
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

/**
 * Semantic tone. Matches the `$chip-tones` palette in `_record-table.scss`
 * and the `TagColor` union in `src/components/Tag.tsx`. Keep the three
 * in sync whenever a new color is added.
 */
export type SelectOptionColor =
  | "blue"
  | "green"
  | "red"
  | "amber"
  | "purple"
  | "teal"
  | "gray"
  | "pink"
  | "violet";

export type SelectOption = {
  value: string;
  label: string;
  color?: SelectOptionColor;
  /** Optional lucide icon name. Rendered as a small leading glyph inside
   * the Tag (both in the table cell and the inline-edit menu). */
  icon?: string;
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

export type AddressValue = {
  addressStreet1?: string | null;
  addressStreet2?: string | null;
  addressCity?: string | null;
  addressState?: string | null;
  addressPostcode?: string | null;
  addressCountry?: string | null;
};

export type FullNameValue = {
  firstName?: string | null;
  lastName?: string | null;
  middleName?: string | null;
  honorificPrefix?: string | null;
  honorificSuffix?: string | null;
};

export type EmailsValue = {
  primaryEmail?: string | null;
  additionalEmails?: string[];
};

export type PhoneValue = {
  number: string;
  countryCode?: string | null;
  callingCode?: string | null;
};

export type PhonesValue = {
  primaryPhoneNumber?: string | null;
  primaryPhoneCountryCode?: string | null;
  primaryPhoneCallingCode?: string | null;
  additionalPhones?: PhoneValue[];
};

export type LinkValue = { url: string; label?: string | null };

export type LinksValue = {
  primaryLinkUrl?: string | null;
  primaryLinkLabel?: string | null;
  secondaryLinks?: LinkValue[];
};

export type FileValue = {
  fileId: string;
  name: string;
  label?: string | null;
  url?: string | null;
  mimeType?: string | null;
};
