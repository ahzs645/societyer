/** Fields that hold part of a person's name; the whole name reads better. */
const PERSON_NAME_PARTS = new Set(["firstName", "lastName"]);

/** A string or number field as trimmed text; anything else is "". */
export function recordText(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

/** "Ada Lovelace" for records named by first/last name fields, else undefined. */
export function recordPersonName(record: Record<string, unknown> | null | undefined): string | undefined {
  if (!record) return undefined;
  return [recordText(record.firstName), recordText(record.lastName)].filter(Boolean).join(" ") || undefined;
}

/**
 * The record's name as plain text: its identifier field, except that people
 * identified by a first or last name field read by their whole name.
 */
export function recordTitleText(
  record: Record<string, unknown> | null | undefined,
  identifierFieldName: string | undefined,
): string | undefined {
  if (!record) return undefined;
  if (identifierFieldName && PERSON_NAME_PARTS.has(identifierFieldName)) {
    const person = recordPersonName(record);
    if (person) return person;
  }
  return (identifierFieldName ? recordText(record[identifierFieldName]) : "") || undefined;
}
