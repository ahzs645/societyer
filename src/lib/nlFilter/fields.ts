import { FIELD_TYPES, type RecordField } from "../../platform/record-engine/types";
import type { NlField, NlContext } from "./types";
import { splitIdentifier } from "./text";

/**
 * The parser's view of a table: labels, types, options and currency units of
 * each column. Built from the RecordTable's columns (hidden ones included, so
 * "with no receipt" works even when the column is folded away).
 */
export function nlFieldsFromColumns(columns: RecordField[], options: { labelIdentifierFieldName?: string } = {}): NlField[] {
  return columns.map((column) => {
    const field = column.field;
    const config = field.config ?? {};
    const rawOptions = Array.isArray(config.options) ? config.options : [];
    return {
      id: column.fieldMetadataId,
      name: field.name,
      label: field.label,
      type: field.fieldType,
      options: rawOptions.length
        ? rawOptions.map((option: { value: unknown; label?: unknown }) => ({ value: String(option.value), label: String(option.label ?? option.value) }))
        : undefined,
      isCents: field.fieldType === FIELD_TYPES.CURRENCY ? Boolean(config.isCents) : undefined,
      currencyCode: typeof config.currencyCode === "string" ? config.currencyCode : undefined,
      trueLabel: typeof config.trueLabel === "string" ? config.trueLabel : undefined,
      falseLabel: typeof config.falseLabel === "string" ? config.falseLabel : undefined,
      relationTarget: typeof config.targetObjectNamePlural === "string" ? config.targetObjectNamePlural : undefined,
      isLabelIdentifier: options.labelIdentifierFieldName ? field.name === options.labelIdentifierFieldName : undefined,
      isVisible: column.isVisible,
    };
  });
}

const NAME_NOISE = new Set(["id", "ids", "iso", "cents", "at", "is", "has", "json", "label"]);

/**
 * Lower-cased phrases that refer to a field: its label, its identifier split
 * into words without suffix noise ("amountCents" → "amount"), and plurals.
 * A label equal to the table's own noun ("Task" on Tasks) is skipped so the
 * noun doesn't read as a field reference.
 */
export function fieldAliases(field: NlField, context?: Pick<NlContext, "objectLabelPlural" | "objectLabelSingular">): string[] {
  const nouns = new Set([context?.objectLabelPlural, context?.objectLabelSingular].filter(Boolean).map((noun) => noun!.toLowerCase()));
  const aliases = new Set<string>();
  const add = (phrase: string) => {
    const clean = phrase.toLowerCase().replace(/[^a-z0-9 '-]/g, " ").replace(/\s+/g, " ").trim();
    if (clean.length < 2 || nouns.has(clean)) return;
    aliases.add(clean);
  };
  add(field.label);
  const nameWords = splitIdentifier(field.name).split(" ").filter((word) => !NAME_NOISE.has(word));
  if (nameWords.length) add(nameWords.join(" "));
  // "Amount (CAD)" → "amount"
  add(field.label.replace(/\(.*?\)/g, ""));
  for (const alias of [...aliases]) {
    if (!alias.endsWith("s") && !alias.includes(" ")) aliases.add(`${alias}s`);
  }
  return [...aliases].sort((a, b) => b.length - a.length);
}

export function isDateField(field: NlField) {
  return field.type === FIELD_TYPES.DATE || field.type === FIELD_TYPES.DATE_TIME;
}

export function isNumericField(field: NlField) {
  return field.type === FIELD_TYPES.CURRENCY || field.type === FIELD_TYPES.NUMBER || field.type === FIELD_TYPES.RATING;
}

export function isOptionField(field: NlField) {
  return (field.type === FIELD_TYPES.SELECT || field.type === FIELD_TYPES.MULTI_SELECT) && (field.options?.length ?? 0) > 0;
}

export function isTextLikeField(field: NlField) {
  return (
    field.type === FIELD_TYPES.TEXT ||
    field.type === FIELD_TYPES.EMAIL ||
    field.type === FIELD_TYPES.PHONE ||
    field.type === FIELD_TYPES.LINK ||
    field.type === FIELD_TYPES.RICH_TEXT ||
    field.type === FIELD_TYPES.ARRAY ||
    field.type === FIELD_TYPES.FULL_NAME ||
    field.type === FIELD_TYPES.RELATION
  );
}

const byVisibility = (a: NlField, b: NlField) => Number(b.isVisible !== false) - Number(a.isVisible !== false);

/** The date column a bare "this year" means: "Date", then the first visible date. */
export function defaultDateField(fields: NlField[]): NlField | undefined {
  const dates = fields.filter(isDateField).sort(byVisibility);
  return (
    dates.find((field) => /^(date|transaction date|posted|posted on)$/i.test(field.label) || field.name === "date") ??
    dates.find((field) => field.isVisible !== false && !/created|updated|modified/i.test(field.name)) ??
    dates[0]
  );
}

/** The money column a bare "over 1.5k" means. Plain numbers must be named. */
export function defaultAmountField(fields: NlField[]): NlField | undefined {
  const money = fields.filter((field) => field.type === FIELD_TYPES.CURRENCY).sort(byVisibility);
  return money.find((field) => /amount|total|value/i.test(`${field.name} ${field.label}`)) ?? money[0];
}

/** A select that records money direction (Type: Income / Expense…). */
export function directionField(fields: NlField[]): { field: NlField; in?: string; out?: string } | undefined {
  for (const field of fields) {
    if (!isOptionField(field) || !/direction|type|kind|flow/i.test(`${field.name} ${field.label}`)) continue;
    const find = (pattern: RegExp) => field.options!.find((option) => pattern.test(option.label) || pattern.test(option.value))?.value;
    const inValue = find(/^(in|income|credit|deposit|inflow|revenue|money in)$/i);
    const outValue = find(/^(out|expense|debit|withdrawal|outflow|payment|spend|money out)$/i);
    if (inValue || outValue) return { field, in: inValue, out: outValue };
  }
  return undefined;
}

const NAME_FIELD = /^(name|full ?name|display ?name|title|first ?name|last ?name|legal ?name|surname|given ?name)$/i;

/** Columns "named Patel" searches: the record's name column, or first + last name. */
export function nameFields(fields: NlField[]): NlField[] {
  const text = fields.filter((field) => field.type === FIELD_TYPES.TEXT || field.type === FIELD_TYPES.FULL_NAME);
  const identifier = text.find((field) => field.isLabelIdentifier && NAME_FIELD.test(splitIdentifier(field.name)));
  if (identifier) return [identifier];
  const full = text.find((field) => /^(full ?name|name|display ?name|legal ?name)$/i.test(splitIdentifier(field.name)) || /^(full name|name)$/i.test(field.label));
  if (full) return [full];
  const parts = text.filter((field) => /first ?name|last ?name|surname|given ?name/i.test(splitIdentifier(field.name)));
  if (parts.length) return parts;
  const titled = text.find((field) => NAME_FIELD.test(field.label) || NAME_FIELD.test(splitIdentifier(field.name)));
  if (titled) return [titled];
  const labelled = text.find((field) => field.isLabelIdentifier);
  return labelled ? [labelled] : [];
}

/** Columns "assigned to Sam" searches. */
export function peopleFields(fields: NlField[]): NlField[] {
  return fields.filter(
    (field) =>
      (field.type === FIELD_TYPES.TEXT || field.type === FIELD_TYPES.RELATION || field.type === FIELD_TYPES.FULL_NAME) &&
      (/assignee|assigned|owner|responsible|person|people|lead|reviewer|approver/i.test(`${field.name} ${field.label}`) ||
        (field.type === FIELD_TYPES.RELATION && /users|people|members|directors/i.test(field.relationTarget ?? ""))),
  );
}

/** Columns "from Coastal Hydro" / "to Jane" search: the other party, else the record's description. */
export function counterpartyFields(fields: NlField[]): NlField[] {
  const text = fields.filter((field) => field.type === FIELD_TYPES.TEXT || field.type === FIELD_TYPES.RELATION);
  const party = text.filter((field) => /counterparty|payee|payer|vendor|merchant|recipient|supplier|customer|donor|party|contact|organization|organisation|company/i.test(`${field.name} ${field.label}`));
  if (party.length) return party;
  const description = text.find((field) => /description|memo|details|narrative/i.test(`${field.name} ${field.label}`));
  if (description) return [description];
  const identifier = text.find((field) => field.isLabelIdentifier);
  return identifier ? [identifier] : [];
}
