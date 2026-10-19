import { FIELD_TYPES, type FieldMetadata, type FieldType, type RecordField } from "../../types";
import { pickStatusField, resolveIdentifierFieldName } from "../hooks/useRecordTableColumns";
import { recordPersonName, recordText, recordTitleText } from "./recordTitle";

/**
 * The automatic phone card RecordTable draws for a table view when the page
 * passes no `renderPhoneCard`: which of the view's fields become the card's
 * title, badge and meta line. Pure, so it can be checked without a DOM.
 */
export type AutoPhoneCardPlan = {
  /** Field the title is read from (the column that opens the record). */
  identifierFieldName: string;
  identifier: FieldMetadata;
  /** First visible status/select-like field, drawn as the cell draws it. */
  badge?: FieldMetadata;
  /** Visible date fields, in view order; the card shows the first one set. */
  dates: FieldMetadata[];
  /** Visible short text/number fields, best first; the card fills from these. */
  shorts: FieldMetadata[];
};

/**
 * Identifier types whose value reads as a record's name. A select identifier
 * (Filings' "Kind": "Annual report") reads by its option label.
 */
const TITLE_TYPES: ReadonlySet<FieldType> = new Set([FIELD_TYPES.TEXT, FIELD_TYPES.FULL_NAME, FIELD_TYPES.EMAIL, FIELD_TYPES.SELECT]);
const DATE_TYPES: ReadonlySet<FieldType> = new Set([FIELD_TYPES.DATE, FIELD_TYPES.DATE_TIME]);
/** Short facts for the meta line, in order of preference (words before counts). */
const SHORT_TYPES: readonly FieldType[] = [FIELD_TYPES.TEXT, FIELD_TYPES.SELECT, FIELD_TYPES.RELATION, FIELD_TYPES.CURRENCY, FIELD_TYPES.NUMBER];
/** Fields that are only part of a person's name, which the title already shows. */
const NAME_PARTS = new Set(["firstName", "lastName"]);
/** Long-form text reads badly on one line: used only when nothing else is set. */
const LONG_TEXT_NAME = /description|notes?$|body|summary|content|comment/i;
/** A table whose records mostly lack a title reads worse as cards. */
const MIN_TITLED_SHARE = 0.6;
const META_LIMIT = 2;

/**
 * Plan the card from the view's visible columns, or null when the view has
 * nothing that reads as a title (the page keeps the column table).
 */
export function planAutoPhoneCard(
  columns: RecordField[],
  labelIdentifierFieldName: string | undefined,
): AutoPhoneCardPlan | null {
  const visible = columns.filter((column) => column.isVisible);
  const identifierFieldName = resolveIdentifierFieldName(visible, labelIdentifierFieldName);
  const identifier = visible.find((column) => column.field.name === identifierFieldName);
  if (!identifierFieldName || !identifier || !TITLE_TYPES.has(identifier.field.fieldType)) return null;

  const rest = visible
    .map((column) => column.field)
    .filter((field) => field.name !== identifierFieldName && !(NAME_PARTS.has(identifierFieldName) && NAME_PARTS.has(field.name)));
  const badge = pickStatusField(rest);
  const others = rest.filter((field) => field !== badge);
  const dates = others.filter((field) => DATE_TYPES.has(field.fieldType));
  const byType = SHORT_TYPES.flatMap((type) => others.filter((field) => field.fieldType === type));
  const shorts = [...byType.filter((field) => !LONG_TEXT_NAME.test(field.name)), ...byType.filter((field) => LONG_TEXT_NAME.test(field.name))];
  return { identifierFieldName, identifier: identifier.field, badge, dates, shorts };
}

/** The card title as plain text: the identifier, or a person's whole name. */
export function autoPhoneCardTitle(record: Record<string, unknown>, plan: AutoPhoneCardPlan): string | undefined {
  if (plan.identifier.fieldType === FIELD_TYPES.SELECT) {
    const value = recordText(record[plan.identifierFieldName]);
    if (!value) return undefined;
    const options = Array.isArray(plan.identifier.config?.options) ? (plan.identifier.config.options as { value?: unknown; label?: unknown }[]) : [];
    const option = options.find((entry) => String(entry.value) === value);
    return recordText(option?.label) || value;
  }
  const title = recordTitleText(record, plan.identifierFieldName);
  if (title) return title;
  const value = record[plan.identifierFieldName];
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const named = value as Record<string, unknown>;
    return recordPersonName(named) || recordText(named.label) || recordText(named.name) || undefined;
  }
  return undefined;
}

/** Whether enough of the records have a title for cards to read well. */
export function autoPhoneCardTitlesFit(records: readonly Record<string, unknown>[], plan: AutoPhoneCardPlan): boolean {
  if (records.length === 0) return true;
  const sample = records.slice(0, 200);
  const titled = sample.filter((record) => autoPhoneCardTitle(record, plan)).length;
  return titled / sample.length >= MIN_TITLED_SHARE;
}

function badgeKey(value: unknown): string {
  if (value == null || value === "") return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/**
 * Whether the badge tells the visible cards apart. A page filtered to open
 * deadlines would print "Open" on every card; the badge then repeats what
 * the filter already says, so the card leaves it out. A lone card keeps it.
 */
export function autoPhoneCardBadgeVaries(records: readonly Record<string, unknown>[], plan: AutoPhoneCardPlan): boolean {
  const badge = plan.badge;
  if (!badge || records.length < 2) return true;
  const first = badgeKey(records[0][badge.name]);
  return records.some((record) => badgeKey(record[badge.name]) !== first);
}

function isBlank(value: unknown): boolean {
  // A zero count ("Linked records 0") is not worth the card's one line.
  if (value == null || value === "" || value === 0) return true;
  if (Array.isArray(value)) return value.length === 0;
  return typeof value === "string" && value.trim() === "";
}

/**
 * The meta line's fields for one record: one short fact and one date when
 * both are set, else up to two of whatever is set, in view order of
 * preference. Empty fields are skipped so the line never shows "—".
 */
export function autoPhoneCardMeta(record: Record<string, unknown>, plan: AutoPhoneCardPlan): FieldMetadata[] {
  const shorts = plan.shorts.filter((field) => !isBlank(record[field.name]));
  const date = plan.dates.find((field) => !isBlank(record[field.name]));
  const picked: FieldMetadata[] = [];
  if (shorts[0]) picked.push(shorts[0]);
  if (date) picked.push(date);
  for (const field of shorts.slice(1)) {
    if (picked.length >= META_LIMIT) break;
    picked.push(field);
  }
  return picked.slice(0, META_LIMIT);
}

/**
 * "Due" before a due date and "Members" before a count, so a bare date or
 * number on the card says what it is. Text, money and tags speak for themselves.
 */
export function autoPhoneCardFactLabel(field: FieldMetadata): string | null {
  if (!DATE_TYPES.has(field.fieldType) && field.fieldType !== FIELD_TYPES.NUMBER) return null;
  const label = field.label.trim();
  if (!label || /^date$/i.test(label)) return null;
  return label;
}
