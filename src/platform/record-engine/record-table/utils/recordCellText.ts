import { FIELD_TYPES } from "../../types/FieldType";
import type {
  AddressValue,
  CurrencyFieldConfig,
  EmailsValue,
  FileValue,
  FullNameValue,
  LinksValue,
  PhonesValue,
  SelectOption,
} from "../../types/FieldType";
import type { FieldMetadata } from "../../types/FieldMetadata";
import { toCalendarDate } from "../../../../lib/dateRanges";
import { DEFAULT_CURRENCY } from "../../../../lib/money";
import type { XlsxCellInput, XlsxColumn } from "../../../../lib/xlsx/types";
import { getSearchableValue, isEmptyValue } from "./filterRecords";

/**
 * A cell as plain text for clipboard copy and CSV export: raw enough to
 * compute with (decimal amounts, ISO dates) but readable (option labels, not
 * stored keys; "Yes"/"No", not true/false).
 */
export function recordCellText(field: FieldMetadata, value: unknown, record?: any): string {
  if (isEmptyValue(value)) {
    if (field.fieldType === FIELD_TYPES.BOOLEAN && value === false) return booleanLabel(field, false);
    return "";
  }
  switch (field.fieldType) {
    case FIELD_TYPES.CURRENCY: {
      const amount = currencyDecimalAmount(field, value);
      if (amount == null) return String(value);
      const decimals = (field.config as CurrencyFieldConfig | undefined)?.decimals ?? 2;
      return amount.toFixed(decimals);
    }
    case FIELD_TYPES.NUMBER:
    case FIELD_TYPES.RATING: {
      const number = Number(value);
      return Number.isFinite(number) ? String(number) : String(value);
    }
    case FIELD_TYPES.BOOLEAN:
      return booleanLabel(field, value === true || value === "true" || value === 1 || value === "1");
    case FIELD_TYPES.DATE:
      return toCalendarDate(value) ?? String(value);
    case FIELD_TYPES.DATE_TIME: {
      const time = typeof value === "number" ? value : Date.parse(String(value));
      return Number.isFinite(time) ? new Date(time).toISOString() : String(value);
    }
    case FIELD_TYPES.SELECT:
      return selectLabel(field, value);
    case FIELD_TYPES.MULTI_SELECT:
      return (Array.isArray(value) ? value : [value]).map((entry) => selectLabel(field, entry)).join("; ");
    case FIELD_TYPES.RELATION: {
      const label = record?.[`${field.name}Label`];
      return label != null && label !== "" ? String(label) : getSearchableValue(value, field.fieldType);
    }
    case FIELD_TYPES.FULL_NAME: {
      const name = value as FullNameValue;
      return [name.honorificPrefix, name.firstName, name.middleName, name.lastName, name.honorificSuffix].filter(Boolean).join(" ");
    }
    case FIELD_TYPES.ADDRESS: {
      const address = value as AddressValue;
      return [address.addressStreet1, address.addressStreet2, address.addressCity, address.addressState, address.addressPostcode, address.addressCountry]
        .filter(Boolean)
        .join(", ");
    }
    case FIELD_TYPES.EMAILS: {
      const emails = value as EmailsValue;
      return [emails.primaryEmail, ...(emails.additionalEmails ?? [])].filter(Boolean).join("; ");
    }
    case FIELD_TYPES.PHONES: {
      const phones = value as PhonesValue;
      return [phones.primaryPhoneNumber, ...(phones.additionalPhones ?? []).map((phone) => phone.number)].filter(Boolean).join("; ");
    }
    case FIELD_TYPES.LINKS: {
      const links = value as LinksValue;
      return [links.primaryLinkUrl, ...(links.secondaryLinks ?? []).map((link) => link.url)].filter(Boolean).join("; ");
    }
    case FIELD_TYPES.FILES:
      return (Array.isArray(value) ? (value as FileValue[]) : []).map((file) => file.label || file.name).filter(Boolean).join("; ");
    case FIELD_TYPES.RICH_TEXT:
      return String(value).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    case FIELD_TYPES.RAW_JSON:
      try {
        return typeof value === "string" ? value : JSON.stringify(value);
      } catch {
        return String(value);
      }
    default:
      if (Array.isArray(value)) return value.map((entry) => getSearchableValue(entry, field.fieldType)).join("; ");
      return getSearchableValue(value, field.fieldType);
  }
}

/** The spreadsheet column for a field: amounts, dates and yes/no keep their types. */
export function recordFieldXlsxColumn(field: FieldMetadata): XlsxColumn {
  const header = field.label;
  switch (field.fieldType) {
    case FIELD_TYPES.CURRENCY:
      return { header, type: "currency", currency: (field.config as CurrencyFieldConfig | undefined)?.currencyCode || DEFAULT_CURRENCY };
    case FIELD_TYPES.NUMBER:
    case FIELD_TYPES.RATING:
      return { header, type: "number" };
    case FIELD_TYPES.DATE:
      return { header, type: "date" };
    case FIELD_TYPES.DATE_TIME:
      return { header, type: "datetime" };
    case FIELD_TYPES.BOOLEAN:
      return { header, type: "boolean" };
    default:
      return { header, type: "text" };
  }
}

/**
 * A cell as a typed spreadsheet value: currency as a decimal amount (cents
 * divided when `isCents`), numbers as numbers, ISO dates, timestamps and
 * booleans for the matching column types; everything else (option labels,
 * relation display labels, names, addresses…) as the same text CSV uses.
 */
export function recordCellXlsx(field: FieldMetadata, value: unknown, record?: any): XlsxCellInput {
  switch (field.fieldType) {
    case FIELD_TYPES.CURRENCY: {
      if (isEmptyValue(value)) return null;
      return currencyDecimalAmount(field, value) ?? String(value);
    }
    case FIELD_TYPES.NUMBER:
    case FIELD_TYPES.RATING: {
      if (isEmptyValue(value)) return null;
      const number = Number(value);
      return Number.isFinite(number) ? number : String(value);
    }
    case FIELD_TYPES.BOOLEAN:
      if (value === null || value === undefined || value === "") return null;
      return value === true || value === "true" || value === 1 || value === "1";
    case FIELD_TYPES.DATE:
      if (isEmptyValue(value)) return null;
      return toCalendarDate(value) ?? String(value);
    case FIELD_TYPES.DATE_TIME: {
      if (isEmptyValue(value)) return null;
      const time = typeof value === "number" ? value : Date.parse(String(value));
      return Number.isFinite(time) ? time : String(value);
    }
    default:
      return recordCellText(field, value, record);
  }
}

/** Stored currency value as a decimal amount (dollars), honouring `isCents`. */
export function currencyDecimalAmount(field: FieldMetadata, value: unknown): number | null {
  const number = Number(value);
  if (value === null || value === undefined || value === "" || !Number.isFinite(number)) return null;
  return (field.config as CurrencyFieldConfig | undefined)?.isCents ? number / 100 : number;
}

/** Stored currency value as integer cents, honouring `isCents`. */
export function currencyCents(field: FieldMetadata, value: unknown): number | null {
  const amount = currencyDecimalAmount(field, value);
  return amount == null ? null : Math.round(amount * 100);
}

function booleanLabel(field: FieldMetadata, value: boolean) {
  const config = field.config as { trueLabel?: string; falseLabel?: string } | undefined;
  return value ? config?.trueLabel ?? "Yes" : config?.falseLabel ?? "No";
}

export function selectLabel(field: FieldMetadata, value: unknown): string {
  const options = (field.config?.options ?? []) as SelectOption[];
  const key = String(value ?? "");
  return options.find((option) => String(option.value) === key)?.label ?? key;
}
