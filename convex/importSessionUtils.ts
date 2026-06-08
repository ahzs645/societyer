// Import-session leaf utilities: text/date cleaning, coercion, and source-system helpers.

function cleanDate(value: unknown) {
  const text = cleanText(value);
  if (!text) return undefined;
  const date = text.match(/\d{4}-\d{2}-\d{2}/)?.[0];
  if (date) return date;
  const month = text.match(/\d{4}-\d{2}/)?.[0];
  if (month) return `${month}-01`;
  const year = text.match(/\b(19|20)\d{2}\b/)?.[0];
  if (year) return `${year}-01-01`;
  return undefined;
}

function cleanDateTime(value: unknown) {
  const text = cleanText(value);
  if (!text) return undefined;
  if (/^\d{4}-\d{2}-\d{2}T/.test(text)) return text;
  const date = cleanDate(text);
  return date ? `${date}T00:00:00.000Z` : undefined;
}

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

function fiscalYearFromDate(value: unknown) {
  const date = cleanDate(value) ?? todayDate();
  return date.slice(0, 4);
}

function splitName(value: unknown) {
  const parts = cleanText(value)?.split(/\s+/).filter(Boolean) ?? [];
  if (parts.length === 0) return { firstName: undefined, lastName: undefined };
  if (parts.length === 1) return { firstName: parts[0], lastName: undefined };
  return { firstName: parts.slice(0, -1).join(" "), lastName: parts[parts.length - 1] };
}

function personKey(value: unknown) {
  return cleanText(value)?.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function tagValue(value: unknown) {
  const text = cleanText(value);
  return text ? text.toLowerCase().replace(/\s+/g, "-") : undefined;
}

function cleanText(value: unknown) {
  const text = String(value ?? "").trim();
  return text || undefined;
}

function arrayOf(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function compactStrings(values: unknown[]): string[] {
  return values.map((value) => cleanText(value)).filter((value): value is string => Boolean(value));
}

function compactRecord<T extends Record<string, any>>(value: T): T | undefined {
  const out: Record<string, any> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry === undefined || entry === "") continue;
    if (Array.isArray(entry) && entry.length === 0) continue;
    if (entry && typeof entry === "object" && !Array.isArray(entry) && Object.keys(entry).length === 0) continue;
    out[key] = entry;
  }
  return Object.keys(out).length ? (out as T) : undefined;
}

function unique(values: unknown[]) {
  return Array.from(new Set(values.map((value) => cleanText(value)).filter(Boolean))) as string[];
}

function numberOrUndefined(value: unknown) {
  if (value === "" || value == null) return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function optionalBoolean(value: unknown) {
  if (typeof value === "boolean") return value;
  const text = cleanText(value)?.toLowerCase();
  if (!text) return undefined;
  if (["yes", "y", "true", "1", "counted", "recorded", "carried", "elected"].includes(text)) return true;
  if (["no", "n", "false", "0", "not counted", "not recorded", "defeated", "not elected"].includes(text)) return false;
  return undefined;
}

function sourceSystemFromExternalId(externalId: unknown) {
  const text = cleanText(externalId)?.toLowerCase() ?? "";
  if (text.startsWith("local:")) return "local";
  if (text.startsWith("file:")) return "local";
  if (text.startsWith("onedrive:")) return "onedrive";
  return "paperless";
}

function sourceSystemLabel(externalSystem: unknown) {
  const system = cleanText(externalSystem)?.toLowerCase();
  if (system === "local") return "Local file";
  if (system === "onedrive") return "OneDrive file";
  if (system === "paperless") return "Paperless";
  return cleanText(externalSystem) || "External source";
}

function sourceSystemTag(externalSystem: unknown) {
  const system = cleanText(externalSystem)?.toLowerCase() || "paperless";
  if (system === "local" || system === "file") return "local";
  if (system === "onedrive") return "onedrive";
  if (system === "paperless") return "paperless";
  return system.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "external";
}

function fallbackSourceTitle(externalId: unknown) {
  const text = cleanText(externalId) || "Imported source";
  if (/^paperless:/i.test(text)) return `Paperless source ${text.replace(/^paperless:/i, "")}`;
  if (/^local:sha256:/i.test(text)) return `Local source ${text.replace(/^local:sha256:/i, "").slice(0, 12)}`;
  if (/^file:/i.test(text)) return text.replace(/^file:/i, "").split(/[\\/]/).filter(Boolean).pop() || text;
  return text;
}

export {
  cleanDate,
  cleanDateTime,
  todayDate,
  fiscalYearFromDate,
  splitName,
  personKey,
  tagValue,
  cleanText,
  arrayOf,
  compactStrings,
  compactRecord,
  unique,
  numberOrUndefined,
  optionalBoolean,
  sourceSystemFromExternalId,
  sourceSystemLabel,
  sourceSystemTag,
  fallbackSourceTitle,
};
