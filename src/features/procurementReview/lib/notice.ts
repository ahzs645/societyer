/**
 * Reads one published procurement record (the catalog row's JSON, as Zoer
 * stored it) into what the hosted reader shows. Sources disagree on field
 * names and date formats, and BC Bid keeps a raw label/value copy of its page
 * (`detailFields`) that repeats the structured fields, so everything the page
 * shows is chosen here once: the facts, the deadline, the status, and only the
 * source fields that say something the facts do not.
 */

export type Tone = "neutral" | "success" | "warn" | "danger" | "info";
/** Whose page a fact opens: the buyer, or the organisation the notice is issued for. */
export type NoticeParty = "organization" | "issuedFor";
export type NoticeFact = { label: string; value: string; party?: NoticeParty };
export type NoticeField = { label: string; value: string; long: boolean };
export type NoticeContact = { name: string; role: string; email: string; phone: string };
export type NoticeAttachment = { name: string; url?: string };
export type NoticeDeadline = { text: string; relative: string; state: "open" | "soon" | "today" | "closed" | "unknown" };
export type NoticeStatus = { label: string; tone: Tone; note?: string };

export type NoticeModel = {
  kind: string;
  title: string;
  source: string;
  type: string;
  reference: string;
  buyer: string;
  status: NoticeStatus | null;
  deadline: NoticeDeadline | null;
  description: string;
  sourceUrl?: string;
  facts: NoticeFact[];
  fields: NoticeField[];
  contacts: NoticeContact[];
  attachments: NoticeAttachment[];
  commodities: string[];
};

export const DEADLINE_ZONE = "America/Vancouver";

type Data = Record<string, unknown>;
const asData = (value: unknown): Data => (value && typeof value === "object" && !Array.isArray(value) ? value as Data : {});
const text = (value: unknown): string => (typeof value === "string" ? value.trim() : typeof value === "number" && Number.isFinite(value) ? String(value) : "");
const first = (data: Data, ...keys: string[]): string => {
  for (const key of keys) { const value = text(data[key]); if (value) return value; }
  return "";
};
const squash = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** An https link without credentials, or nothing. */
export function safeHttpsUrl(value: unknown): string | undefined {
  const raw = text(value);
  if (!raw) return;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : undefined;
  } catch { return; }
}

const SOURCE_LABELS: Record<string, string> = {
  "bc-bid": "BC Bid",
  canadabuys: "CanadaBuys",
  bidsandtenders: "bids&tenders",
  "municipal-sites": "Buyer's website",
  "browser-sites": "Buyer's website",
};

/**
 * Where a record came from, from its stored sourceId or its catalog key
 * (`opportunity:<source>:…`). BC Bid keys name no source: bare opportunity
 * keys, and award keys whose parts are joined with "::".
 */
export function sourceLabel(recordKey: string, data: unknown = {}): string {
  const stored = text(asData(data).sourceId);
  if (stored) return SOURCE_LABELS[stored] ?? stored;
  const [, second = "", third] = recordKey.split(":");
  return third ? SOURCE_LABELS[second] ?? second : "BC Bid";
}

// ---------------------------------------------------------------------------
// Dates. A source date is a calendar day, optionally with a wall-clock time in
// the source's zone (America/Vancouver for every source Zoer collects). An
// explicit offset is converted to that zone; anything unreadable stays text.

export type SourceDate = { date: string; time?: string };

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const pad = (n: number) => String(n).padStart(2, "0");
function validDay(y: number, m: number, d: number) {
  if (!y || m < 1 || m > 12 || d < 1) return false;
  return d <= new Date(Date.UTC(y, m, 0)).getUTCDate();
}
function clock(hour: string | undefined, minute: string | undefined, meridiem: string | undefined): string | undefined {
  if (hour === undefined || minute === undefined) return;
  let h = Number(hour);
  const m = Number(minute);
  if (meridiem) {
    const pm = /^p/i.test(meridiem);
    if (h < 1 || h > 12) return;
    h = (h % 12) + (pm ? 12 : 0);
  }
  return h <= 23 && m <= 59 ? `${pad(h)}:${pad(m)}` : undefined;
}
function day(y: number, m: number, d: number, time?: string): SourceDate | null {
  return validDay(y, m, d) ? { date: `${y}-${pad(m)}-${pad(d)}`, ...(time ? { time } : {}) } : null;
}

const zoneParts = new Intl.DateTimeFormat("en-CA", { timeZone: DEADLINE_ZONE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
function inZone(at: number): SourceDate {
  const p = Object.fromEntries(zoneParts.formatToParts(at).map((part) => [part.type, part.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}
/** Today's date in the source zone. */
export function zoneToday(now = Date.now()): string { return inZone(now).date; }

/** Only an offset-qualified source timestamp establishes an instant. */
export function deadlineInstant(raw: unknown): number | null {
  if (typeof raw !== "string" || !/^\d{4}-\d{2}-\d{2}[Tt ](?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:[Zz]|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(raw.trim())) return null;
  const at = Date.parse(raw);
  return Number.isFinite(at) && parseSourceDate(raw) ? at : null;
}
/** Keep raw precision: a sortable wall-clock date cannot recover the original source zone. */
export function procurementDeadlineValue(row: { date: string; dateText?: string; analyticsJson?: string }): string {
  const extra = row.analyticsJson ? JSON.parse(row.analyticsJson) : {};
  return text(extra.closingAt) || text(extra.closingDate) || (deadlineInstant(row.dateText) !== null ? row.dateText! : row.date || row.dateText || "");
}

const ISO = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?\s*([AaPp]\.?[Mm]\.?)?\s*(Z|[+-]\d{2}:?\d{2})?)?/;
const WORDY = /(?:^|\b)([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})(?:,?\s*(?:at\s+)?(\d{1,2}):(\d{2})(?::\d{2})?\s*([AaPp]\.?[Mm]\.?)?)?/;
const DAY_FIRST_WORDY = /(?:^|\b)(\d{1,2})\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})(?:,?\s*(?:at\s+)?(\d{1,2}):(\d{2})(?::\d{2})?\s*([AaPp]\.?[Mm]\.?)?)?/;
const SLASHED = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})(?:,?\s+(\d{1,2}):(\d{2})\s*([AaPp]\.?[Mm]\.?)?)?/;

/**
 * Reads the date formats the sources publish: ISO dates and stamps (offsets
 * converted to the source zone), "Wed Oct 7, 2026 3:00 PM (PDT)",
 * "2026-10-30 2:00:00 PM (Pacific)", "October 30, 2026", "30 Oct 2026" and
 * North American "10/05/26 2:00pm". Anything else (for example "submissions
 * can be received at any time") is not a date.
 */
export function parseSourceDate(raw: unknown): SourceDate | null {
  const value = text(raw);
  if (!value) return null;
  let m = ISO.exec(value);
  if (m) {
    const [, y, mo, d, h, mi, meridiem, offset] = m;
    if (offset && h !== undefined && !meridiem) {
      const at = Date.parse(value.slice(0, m[0].length).replace(" ", "T"));
      return Number.isFinite(at) && validDay(Number(y), Number(mo), Number(d)) ? inZone(at) : null;
    }
    return day(Number(y), Number(mo), Number(d), clock(h, mi, meridiem));
  }
  m = WORDY.exec(value);
  if (m) {
    const month = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()) + 1;
    if (month) return day(Number(m[3]), month, Number(m[2]), clock(m[4], m[5], m[6]));
  }
  m = DAY_FIRST_WORDY.exec(value);
  if (m) {
    const month = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase()) + 1;
    if (month) return day(Number(m[3]), month, Number(m[1]), clock(m[4], m[5], m[6]));
  }
  m = SLASHED.exec(value);
  if (m) {
    const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return day(year, Number(m[1]), Number(m[2]), clock(m[4], m[5], m[6]));
  }
  return null;
}

/** YYYY-MM-DD[THH:MM] in the source zone, or "" — the import's `date`, as scripts/procurement/export-convex.py writes it. */
export function sortableDate(raw: unknown): string {
  const parsed = parseSourceDate(raw);
  return parsed ? (parsed.time ? `${parsed.date}T${parsed.time}` : parsed.date) : "";
}

function dayText(date: string, withYear = true) {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, { month: "short", day: "numeric", ...(withYear ? { year: "numeric" } : {}), timeZone: "UTC" });
}
function timeText(time: string) {
  const [h, m] = time.split(":").map(Number);
  return new Date(Date.UTC(2000, 0, 1, h, m)).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", timeZone: "UTC" });
}
const dayNumber = (date: string) => { const [y, m, d] = date.split("-").map(Number); return Date.UTC(y, m - 1, d) / 86_400_000; };

/** "Oct 30, 2026 · 2:00 PM" (or the source's own text when it isn't a date). */
export function formatSourceDate(raw: unknown, { withYear = true }: { withYear?: boolean } = {}): string {
  const parsed = parseSourceDate(raw);
  if (!parsed) return text(raw);
  return parsed.time ? `${dayText(parsed.date, withYear)} · ${timeText(parsed.time)}` : dayText(parsed.date, withYear);
}

/** As formatSourceDate, without the year when it is this year: list rows. */
export function shortSourceDate(raw: unknown, now = Date.now()): string {
  const parsed = parseSourceDate(raw);
  return formatSourceDate(raw, { withYear: !parsed || parsed.date.slice(0, 4) !== zoneToday(now).slice(0, 4) });
}

/**
 * The closing date with how far away it is. A day without a time is judged by
 * its calendar day in the source zone: earlier days are closed, the same day
 * reads "today" (never silently open or closed), later days are open.
 */
export function deadlineOf(raw: unknown, now = Date.now()): NoticeDeadline | null {
  const value = text(raw);
  if (!value) return null;
  const parsed = parseSourceDate(value);
  if (!parsed) return { text: value, relative: "", state: "unknown" };
  const today = zoneToday(now);
  const days = dayNumber(parsed.date) - dayNumber(today);
  const formatted = formatSourceDate(value);
  if (days < 0) return { text: formatted, relative: days === -1 ? "yesterday" : `${-days} days ago`, state: "closed" };
  if (days === 0) {
    const instant = deadlineInstant(value), passed = instant !== null && instant < now;
    return { text: formatted, relative: passed ? "earlier today" : instant === null ? "closing date today; time unverified" : "today", state: passed ? "closed" : "today" };
  }
  return { text: formatted, relative: days === 1 ? "tomorrow" : `in ${days} days`, state: days <= 7 ? "soon" : "open" };
}

/**
 * Status as a reader should understand it. Sources keep saying "Open" after
 * the closing date (BC Bid does for weeks), so a passed deadline reads
 * "Closed" and the source's own word is kept in the note.
 */
export function statusOf(kind: string, raw: unknown, deadline: NoticeDeadline | null, sourceName = "the source"): NoticeStatus | null {
  const source = text(raw);
  if (kind === "award") return { label: "Awarded", tone: "info" };
  const key = source.toLowerCase();
  const openStatus = /^(open|active|published|accepting (responses|bids|submissions))$/.test(key);
  if ((key === "" || openStatus) && deadline?.state === "closed") {
    return { label: "Closed", tone: "neutral", ...(source ? { note: `still listed as “${source}” on ${sourceName}` } : {}) };
  }
  if (!source) return null;
  if (openStatus) return { label: "Open", tone: "success", ...(deadline?.state === "today" ? { note: "Check the source closing time." } : {}) };
  if (/cancel/.test(key)) return { label: source, tone: "danger" };
  if (/award/.test(key)) return { label: source, tone: "info" };
  if (/closed|expired|complete|withdrawn|terminated/.test(key)) return { label: source, tone: "neutral" };
  return { label: source, tone: "neutral" };
}

// ---------------------------------------------------------------------------
// Source fields.

/** Labels the facts, header or description already show. */
const COVERED_LABEL = /^(opportunity (id|number|type|description|title)|solicitation (number|type)|reference( number| #)?|status|issue(d)? date( and time)?|publish(ed)?( date)?|posted( date)?|closing( date)?( and time)?|closing (date )?(&|and) time|closes|issued (by|for)|issuing (organi[sz]ation|location)|organi[sz]ation|buyer|summary( details)?|description|scope|title|commodit(y|ies)|unspsc|main commodity|amendment( #| number)?|amendments|last updated|ends in|bid type|type)$/i;

/** Values that carry no information on their own. */
const EMPTY_VALUE = /^(n\/?a|none|-+|\.)$/i;

function sourceFields(data: Data, shown: string[]): NoticeField[] {
  const raw = Array.isArray(data.detailFields) ? data.detailFields : [];
  const covered = new Set(shown.map(squash).filter(Boolean));
  const description = squash(shown[0] ?? "");
  const seen = new Set<string>();
  const fields: NoticeField[] = [];
  for (const item of raw) {
    const entry = asData(item);
    const label = text(entry.label).replace(/:$/, "");
    const value = text(entry.value);
    if (!label || !value || EMPTY_VALUE.test(value) || COVERED_LABEL.test(label)) continue;
    const key = squash(value);
    if (covered.has(key) || (description.length > 80 && key.length > 80 && (description.includes(key) || key.includes(description)))) continue;
    const id = `${squash(label)}=${key}`;
    if (seen.has(id)) continue;
    seen.add(id);
    // A single lot with no amendments says nothing.
    if (/^lot( #| number)?$/i.test(label) && value === "1") continue;
    fields.push({ label, value, long: value.length > 60 || value.includes("\n") });
  }
  return fields;
}

/** The source's contacts; awards keep a single one in flat fields. */
function contactsOf(data: Data): NoticeContact[] {
  const flat = { name: data.contactName, email: data.contactEmail, phone: data.contactPhone };
  const raw = Array.isArray(data.contacts) && data.contacts.length ? data.contacts : [flat];
  const seen = new Set<string>();
  return raw.map(asData).map((c) => ({ name: text(c.name), role: text(c.role), email: text(c.email), phone: text(c.phone) }))
    .filter((c) => (c.name || c.email || c.phone) && !seen.has(`${c.name}|${c.email}|${c.phone}`) && Boolean(seen.add(`${c.name}|${c.email}|${c.phone}`)));
}

function attachmentsOf(data: Data): NoticeAttachment[] {
  const raw = [...(Array.isArray(data.attachments) ? data.attachments : []), ...(Array.isArray(data.addenda) ? data.addenda : [])];
  return raw.map((item) => (typeof item === "string" ? { name: item } : asData(item)))
    .map((item) => ({ name: text(item.name) || text(item.title) || text(item.fileName), url: safeHttpsUrl(item.url) }))
    .filter((item) => item.name);
}

function commoditiesOf(data: Data): string[] {
  const list = Array.isArray(data.commodities) ? data.commodities.map(text).filter(Boolean) : [];
  const main = text(data.mainCommodity);
  return [...new Set(main ? [main, ...list] : list)];
}

/** A reference the source published, not one of Zoer's synthetic catalog keys. */
/** Connector keys Zoer made up stand in for a reference the source didn't give; they aren't the buyer's number. */
const SYNTHETIC_REFERENCE = /^(browser-sites|municipal-sites|bidsandtenders|canadabuys):/;

/** The first of the source's own reference fields that is a real number (a synthetic key falls through to the next). */
function referenceOf(data: Data): string {
  for (const key of ["opportunityId", "externalId", "referenceNumber", "solicitationNumber"]) {
    const value = text(data[key]);
    if (value && !SYNTHETIC_REFERENCE.test(value) && value.length <= 60) return value;
  }
  return "";
}

function placeOf(data: Data): string {
  const place = asData(data.place);
  const parts = [text(place.municipality), text(place.regionalDistrict)].filter(Boolean);
  return [...new Set(parts)].join(" · ") || first(data, "region", "issuingLocation");
}

function money(value: unknown, currency: unknown): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return text(value);
  return new Intl.NumberFormat("en-CA", { style: "currency", currency: text(currency) || "CAD", maximumFractionDigits: 0 }).format(value);
}

/**
 * The closing date with the most precision available. BC Bid stores a bare
 * day in `closingDate` and the time only in its page fields, so a field naming
 * the same day with a time wins over the bare day.
 */
function closingOf(data: Data, fallback: string): string {
  const stored = first(data, "closingAt", "closingDate") || fallback;
  const parsed = parseSourceDate(stored);
  if (!parsed || parsed.time) return stored;
  for (const item of Array.isArray(data.detailFields) ? data.detailFields : []) {
    const entry = asData(item);
    if (!/^closing/i.test(text(entry.label))) continue;
    const detail = parseSourceDate(entry.value);
    if (detail?.time && detail.date === parsed.date) return text(entry.value);
  }
  return stored;
}

/** The page model for one record. `data` is the parsed catalog JSON; `summary` is the list projection's text. */
export function describeNotice(input: { recordKey: string; kind: string; title: string; organization?: string; status?: string; date?: string }, rawData: unknown, now = Date.now()): NoticeModel {
  const data = asData(rawData);
  const award = input.kind === "award";
  const title = input.title || first(data, "description", "opportunityDescription", "title") || "Untitled notice";
  const buyer = first(data, "issuedBy", "issuingOrganization", "buyer") || text(input.organization);
  const issuedFor = first(data, "issuedFor");
  const type = first(data, "type", "opportunityType", "solicitationType");
  const reference = referenceOf(data);
  const closing = award ? "" : closingOf(data, text(input.date));
  const deadline = award ? null : deadlineOf(closing, now);
  const source = sourceLabel(input.recordKey, data);
  const status = statusOf(input.kind, first(data, "status") || text(input.status), deadline, source === "Buyer's website" ? "the buyer's site" : source);
  let description = first(data, "sourceDescriptionText", "descriptionText", "summary", "summaryDetails");
  if (squash(description) === squash(title)) description = "";
  const commodities = commoditiesOf(data);
  const issued = first(data, "issueDate", "publishedAt", "postedDate");
  const amendments = Number(data.amendments);

  const facts: NoticeFact[] = [];
  const push = (label: string, value: string, party?: NoticeParty) => { if (value) facts.push({ label, value, ...(party ? { party } : {}) }); };
  if (award) {
    push("Awarded", formatSourceDate(first(data, "awardDate")));
    push("Supplier", first(data, "successfulSupplier", "supplier"));
    push("Contract value", money(data.contractValue, data.currency) || first(data, "contractValueText"));
    push("Buyer", buyer, "organization");
  } else {
    push("Closes", deadline?.text ?? "");
    push("Buyer", buyer, "organization");
    if (issuedFor && squash(issuedFor) !== squash(buyer)) push("Issued for", issuedFor, "issuedFor");
  }
  push("Type", type);
  push("Reference", reference);
  if (!award) push("Issued", issued ? formatSourceDate(issued) : "");
  if (Number.isFinite(amendments) && amendments > 0) push("Amendments", String(amendments));
  // A regional district buying for itself is its own location.
  const location = placeOf(data);
  if (squash(location) !== squash(buyer)) push("Location", location);

  // The description is compared first, so a field that only restates it is dropped.
  const shown = [description, title, buyer, issuedFor, type, reference, closing, issued, text(data.status), ...commodities, ...facts.map((f) => f.value)];
  return {
    kind: input.kind,
    title,
    source,
    type,
    reference,
    buyer,
    status,
    deadline,
    description,
    sourceUrl: safeHttpsUrl(data.detailUrl) ?? safeHttpsUrl(data.sourceUrl),
    facts,
    fields: sourceFields(data, shown),
    contacts: contactsOf(data),
    attachments: attachmentsOf(data),
    commodities,
  };
}

// ---------------------------------------------------------------------------
// The page around the record: where Back leads, the buyer's other notices, and
// the documents as one list.

/**
 * What the notice's Back button says, from the place under it in the reader's
 * URL: the buyer (or issued-for organisation) page it was opened from, the
 * analytics, or the list of its kind.
 */
export function backLabel(place: { buyer?: string | null; issuedFor?: string | null; section?: string | null; kind?: string | null }): string {
  const party = text(place.buyer) || text(place.issuedFor);
  if (party) return party;
  if (place.section === "analytics") return "Analytics";
  return place.kind === "award" ? "Awards" : "Opportunities";
}

/** "on BC Bid", "on the buyer's site": where a file that wasn't downloaded can be opened. */
export function onSource(source: string): string {
  return `on ${source === "Buyer's website" ? "the buyer's site" : source}`;
}

/** How many of a kind's notices name the organisation in that role, or null when there's nothing to add (only this one). */
export function partyCount(rows: readonly { organization: string; issuedFor: string }[], party: NoticeParty, name: string): number | null {
  const key = squash(name);
  if (!key) return null;
  const count = rows.filter((row) => squash(party === "organization" ? row.organization : row.issuedFor) === key).length;
  return count > 1 ? count : null;
}

export type NoticeDocumentRow<D> =
  /** Zoer downloaded and published it: preview and download here. */
  | { state: "downloaded"; key: string; name: string; document: D }
  /** Only on the source: stored without its file, or listed and never downloaded. `url` opens it there. */
  | { state: "elsewhere"; key: string; name: string; url?: string; document?: D };

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * The notice's files as one list: those downloaded first, then the stored
 * ones that weren't published, then the files the source lists that Zoer
 * didn't download, each with its source link when the source gave one.
 * `withListed` adds the source's list; pass it only when every stored file is
 * in hand, so a later page can't hold one of them.
 */
export function noticeDocumentRows<D extends { documentKey: string; name: string; available: boolean }>(stored: readonly D[], attachments: readonly NoticeAttachment[], withListed: boolean): NoticeDocumentRow<D>[] {
  const linkFor = (name: string) => safeHttpsUrl(attachments.find((item) => sameName(item.name, name))?.url);
  const rows: NoticeDocumentRow<D>[] = stored.filter((document) => document.available)
    .map((document) => ({ state: "downloaded", key: document.documentKey, name: document.name, document }));
  for (const document of stored) {
    if (!document.available) rows.push({ state: "elsewhere", key: document.documentKey, name: document.name, url: linkFor(document.name), document });
  }
  if (!withListed) return rows;
  const named = stored.map((document) => document.name);
  for (const item of attachments) {
    if (named.some((name) => sameName(name, item.name))) continue;
    named.push(item.name);
    rows.push({ state: "elsewhere", key: `listed:${item.name}`, name: item.name, url: safeHttpsUrl(item.url) });
  }
  return rows;
}
