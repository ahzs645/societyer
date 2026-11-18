/**
 * Name requests (`nameSearchItems`): one proposed name taken through a search
 * and, usually, a registry decision (name preapproval or reservation).
 *
 * Pure helpers shared by the portable mutation, the organization setup
 * progress query and the Formation and maintenance page:
 * - the status model, with the legacy `success` flag mapped onto it,
 * - field validation (dates, the decision time, counts, money), and the
 *   import cleanup that drops what fails it,
 * - the summary the setup "name" step reads,
 * - short date and time wording ("Nov 17", "Nov 18, 2:00 p.m. PST").
 *
 * The decision time is an absolute time with its offset
 * (`2026-11-18T14:00:00-08:00`) or a day (`2026-11-18`). Rows saved before
 * that hold a bare local time (`2026-11-18T14:00`); readers take it in the
 * organization's time zone when they know it, else the viewer's.
 */

import { addDaysToDateOnly, isDateOnly, parseDateOnly } from "./dateOnly";
import { CANADIAN_TIME_ZONES, offsetMinutesAt, timeZoneAbbreviation, wallClockInZone, zonedDateTimeISO } from "./timeZones";

export const NAME_REQUEST_STATUSES = ["searching", "submitted", "approved", "rejected", "withdrawn"] as const;
export type NameRequestStatus = (typeof NAME_REQUEST_STATUSES)[number];

export const NAME_REQUEST_STATUS_LABELS: Record<NameRequestStatus, string> = {
  searching: "Searching",
  submitted: "Submitted",
  approved: "Approved",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
};

/** Name preapprovals and NUANS reports are generally good for 90 days. */
export const NAME_APPROVAL_VALID_DAYS = 90;

/** How close to expiry an approved name is flagged before the filing. */
export const NAME_APPROVAL_EXPIRY_WARNING_DAYS = 14;

export function isNameRequestStatus(value: unknown): value is NameRequestStatus {
  return typeof value === "string" && (NAME_REQUEST_STATUSES as readonly string[]).includes(value);
}

/** The fields of a `nameSearchItems` row the helpers read. */
export type NameRequestLike = {
  _id?: unknown;
  name?: string | null;
  suffix?: string | null;
  status?: string | null;
  success?: boolean | null;
  requestId?: string | null;
  nuansReportNumber?: string | null;
  submittedOn?: string | null;
  decisionExpectedAtISO?: string | null;
  decidedOn?: string | null;
  expiresOn?: string | null;
  updatedAtISO?: string | null;
  createdAtISO?: string | null;
};

/**
 * A row's status. Rows saved before statuses existed have only `success`:
 * `true` reads as approved, anything else as still searching.
 */
export function nameRequestStatus(row: Pick<NameRequestLike, "status" | "success">): NameRequestStatus {
  if (isNameRequestStatus(row.status)) return row.status;
  return row.success === true ? "approved" : "searching";
}

/** True when the row carries an explicit status (not a legacy row). */
export function hasExplicitNameRequestStatus(row: Pick<NameRequestLike, "status">): boolean {
  return isNameRequestStatus(row.status);
}

const SUFFIX_LABELS: Record<string, string> = { canada_inc: "Canada Inc.", inc: "Inc.", corp: "Corp.", ltd: "Ltd." };

/** "DDC North Inc.": the name with its suffix code spelled out. */
export function nameRequestDisplayName(row: Pick<NameRequestLike, "name" | "suffix">): string {
  const name = String(row.name ?? "").trim();
  const code = String(row.suffix ?? "").trim();
  const suffix = !code || code === "other" ? "" : SUFFIX_LABELS[code] ?? `${code.charAt(0).toUpperCase()}${code.slice(1)}`;
  if (!suffix || name.toLowerCase().endsWith(suffix.toLowerCase())) return name;
  return [name, suffix].filter(Boolean).join(" ");
}

/** Suggested expiry for an approval decided on `decidedOn` (check the decision letter for the exact date). */
export function suggestedNameApprovalExpiry(decidedOn: string | null | undefined): string | undefined {
  if (!isDateOnly(decidedOn)) return undefined;
  return addDaysToDateOnly(decidedOn, NAME_APPROVAL_VALID_DAYS) ?? undefined;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const DECISION_TIME = /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})?)?$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** A real calendar day as `YYYY-MM-DD`. */
export function isValidDateOnly(value: unknown): value is string {
  return isDateOnly(value) && parseDateOnly(value) !== null;
}

/**
 * A readable decision time: a day (`2026-11-18`), a time with its offset
 * (`2026-11-18T14:00:00-08:00`), or an older bare local time
 * (`2026-11-18T14:00`).
 */
export function isDecisionExpectedValue(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = DECISION_TIME.exec(value);
  if (!match || !isValidDateOnly(match[1])) return false;
  if (match[2] === undefined) return true;
  const offsetOk = match[5] === undefined || match[5] === "Z" || (Number(match[5].slice(1, 3)) <= 14 && Number(match[5].slice(4)) <= 59);
  return Number(match[2]) <= 23 && Number(match[3]) <= 59 && (match[4] === undefined || Number(match[4]) <= 59) && offsetOk;
}

/** True when the value has a time of day, not just a day. */
export function decisionExpectedHasTime(value: string | null | undefined): boolean {
  return Boolean(value && DECISION_TIME.exec(value)?.[2] !== undefined);
}

/** True for a time with no offset (saved before decision times had a time zone). */
function isBareLocalTime(value: string): boolean {
  const match = DECISION_TIME.exec(value);
  return Boolean(match && match[2] !== undefined && match[5] === undefined);
}

/**
 * Pin an older bare local time to `timeZone` (`2026-11-18T14:00` in
 * America/Vancouver → `2026-11-18T14:00:00-08:00`). Days and times that
 * already carry an offset come back unchanged, and so does everything when
 * no zone is known.
 */
export function withDecisionTimeZone(value: string, timeZone: string | null | undefined): string {
  if (!timeZone || !isDecisionExpectedValue(value) || !isBareLocalTime(value)) return value;
  return zonedDateTimeISO(value.slice(0, 10), value.slice(11, 16), timeZone) ?? value;
}

/**
 * The instant of a timed decision value (ms). A bare local time is read in
 * `sourceTimeZone`, else the runtime's zone. Undefined for a day or junk.
 */
export function decisionExpectedInstant(value: string | null | undefined, sourceTimeZone?: string): number | undefined {
  if (!isDecisionExpectedValue(value) || !decisionExpectedHasTime(value)) return undefined;
  const iso = isBareLocalTime(value) ? zonedDateTimeISO(value.slice(0, 10), value.slice(11, 16), sourceTimeZone) : value;
  const at = iso ? Date.parse(iso) : Number.NaN;
  return Number.isFinite(at) ? at : undefined;
}

export function isEmailAddress(value: unknown): value is string {
  return typeof value === "string" && value.length <= 254 && EMAIL.test(value);
}

/** Validate a name request's typed fields; throws a plain-language error. */
export function assertNameRequestFields(fields: {
  status?: string;
  submittedOn?: string;
  decisionExpectedAtISO?: string;
  decidedOn?: string;
  expiresOn?: string;
  contactEmail?: string;
  amountPaidCents?: number;
  similarNamesReviewed?: number;
  exactMatchesFound?: number;
}): void {
  if (fields.status !== undefined && !isNameRequestStatus(fields.status)) {
    throw new Error(`Name request status must be one of: ${NAME_REQUEST_STATUSES.join(", ")}.`);
  }
  const dates: Array<[string | undefined, string]> = [
    [fields.submittedOn, "Submitted on"], [fields.decidedOn, "Decided on"], [fields.expiresOn, "Expires on"],
  ];
  for (const [value, label] of dates) {
    if (value !== undefined && !isValidDateOnly(value)) throw new Error(`${label} must be a date (YYYY-MM-DD).`);
  }
  if (fields.decisionExpectedAtISO !== undefined && !isDecisionExpectedValue(fields.decisionExpectedAtISO)) {
    throw new Error("Decision expected must be a date, or a date and time.");
  }
  if (fields.decisionExpectedAtISO !== undefined && isBareLocalTime(fields.decisionExpectedAtISO)) {
    throw new Error("Decision expected needs a time zone with its time.");
  }
  if (fields.contactEmail !== undefined && !isEmailAddress(fields.contactEmail)) {
    throw new Error("Contact email must be an email address.");
  }
  const counts: Array<[number | undefined, string]> = [
    [fields.amountPaidCents, "Amount paid"], [fields.similarNamesReviewed, "Similar names reviewed"], [fields.exactMatchesFound, "Exact matches found"],
  ];
  for (const [value, label] of counts) {
    if (value !== undefined && (!Number.isInteger(value) || value < 0)) throw new Error(`${label} must be a whole number of zero or more.`);
  }
  if (fields.decidedOn && fields.expiresOn && fields.expiresOn < fields.decidedOn) {
    throw new Error("Expires on can't be before the decision date.");
  }
}

/** The request fields an imported `nameSearchItems` row may carry. */
export type NameRequestImportFields = {
  status?: NameRequestStatus;
  registry?: string;
  requestId?: string;
  submittedOn?: string;
  decisionExpectedAtISO?: string;
  decidedOn?: string;
  expiresOn?: string;
  contactEmail?: string;
  receiptOrderNumber?: string;
  amountPaidCents?: number;
  distinctiveRationale?: string;
  similarNamesReviewed?: number;
  exactMatchesFound?: number;
  similarNamesNotes?: string;
  /** As the bundle names them; the importer maps them to its documents. */
  supportingDocumentIds?: string[];
};

const IMPORT_TEXT_FIELDS = ["registry", "requestId", "receiptOrderNumber", "distinctiveRationale", "similarNamesNotes"] as const;
const IMPORT_DATE_FIELDS = ["submittedOn", "decidedOn", "expiresOn"] as const;
const IMPORT_COUNT_FIELDS = ["amountPaidCents", "similarNamesReviewed", "exactMatchesFound"] as const;

/**
 * An imported row's request fields, each checked on its own with the rules
 * above: what passes is kept (trimmed; whole numbers may come as text), what
 * fails is named in `dropped` so the import can report it instead of failing
 * the row. An expiry before the decision date drops the expiry. A bare local
 * decision time is kept for the importer to pin to the organization's zone.
 */
export function cleanImportedNameRequestFields(payload: Readonly<Record<string, unknown>>): { fields: NameRequestImportFields; dropped: string[] } {
  const fields: NameRequestImportFields = {};
  const dropped: string[] = [];
  const given = (key: string) => {
    const value = payload[key];
    return value !== undefined && value !== null && !(typeof value === "string" && !value.trim());
  };
  const textOf = (key: string): string | undefined => {
    const value = payload[key];
    if (typeof value === "string") return value.trim() || undefined;
    return typeof value === "number" && Number.isFinite(value) ? String(value) : undefined;
  };
  if (given("status")) {
    const status = textOf("status")?.toLowerCase();
    if (isNameRequestStatus(status)) fields.status = status;
    else dropped.push("status");
  }
  for (const key of IMPORT_TEXT_FIELDS) {
    if (!given(key)) continue;
    const value = textOf(key);
    if (value) fields[key] = value;
    else dropped.push(key);
  }
  for (const key of IMPORT_DATE_FIELDS) {
    if (!given(key)) continue;
    const value = textOf(key);
    if (isValidDateOnly(value)) fields[key] = value;
    else dropped.push(key);
  }
  if (given("decisionExpectedAtISO")) {
    const value = textOf("decisionExpectedAtISO");
    if (isDecisionExpectedValue(value)) fields.decisionExpectedAtISO = value;
    else dropped.push("decisionExpectedAtISO");
  }
  if (given("contactEmail")) {
    const value = textOf("contactEmail");
    if (isEmailAddress(value)) fields.contactEmail = value;
    else dropped.push("contactEmail");
  }
  for (const key of IMPORT_COUNT_FIELDS) {
    if (!given(key)) continue;
    const raw = payload[key];
    const value = typeof raw === "number" ? raw : typeof raw === "string" && /^\s*\d+\s*$/.test(raw) ? Number(raw) : Number.NaN;
    if (Number.isInteger(value) && value >= 0) fields[key] = value;
    else dropped.push(key);
  }
  if (given("supportingDocumentIds")) {
    const raw = payload.supportingDocumentIds;
    const ids = Array.isArray(raw) ? raw.filter((id): id is string => typeof id === "string" && Boolean(id.trim())).map((id) => id.trim()) : [];
    if (Array.isArray(raw) && ids.length === raw.length) fields.supportingDocumentIds = ids;
    else {
      dropped.push("supportingDocumentIds");
      if (ids.length) fields.supportingDocumentIds = ids;
    }
  }
  if (fields.decidedOn && fields.expiresOn && fields.expiresOn < fields.decidedOn) {
    delete fields.expiresOn;
    dropped.push("expiresOn");
  }
  return { fields, dropped };
}

// ---------------------------------------------------------------------------
// Setup summary
// ---------------------------------------------------------------------------

/**
 * What the setup "name" step needs about the organization's name requests:
 * the deciding request's state, dates and identifiers, never the search
 * details. `daysUntilExpiry` is counted from the organization's today.
 */
export type NameRequestSummary = {
  state: "approved" | "pending" | "rejected" | "none";
  id?: string;
  name?: string;
  requestId?: string;
  nuansReportNumber?: string;
  submittedOn?: string;
  decisionExpectedAtISO?: string;
  decidedOn?: string;
  expiresOn?: string;
  daysUntilExpiry?: number;
  /** The organization's time zone, for wording the decision time where the viewer's isn't known. */
  timeZone?: string;
};

const SUMMARY_RANK: Record<NameRequestStatus, number> = { approved: 3, submitted: 2, rejected: 1, searching: 0, withdrawn: 0 };

function daysBetween(fromDateOnly: string, toDateOnly: string): number | undefined {
  const from = parseDateOnly(fromDateOnly);
  const to = parseDateOnly(toDateOnly);
  if (!from || !to) return undefined;
  return Math.round((to.getTime() - from.getTime()) / 86_400_000);
}

function text(value: unknown): string | undefined {
  const trimmed = String(value ?? "").trim();
  return trimmed || undefined;
}

/**
 * Summarize name requests for setup: an approval beats a pending request,
 * which beats a rejection; within a state the most recently updated row
 * wins. Searching and withdrawn rows don't decide anything.
 *
 * `legacyApproval` (a NUANS number on a formation record) counts as an
 * approval only when no request carries an explicit status. `timeZone` (the
 * organization's) pins an older bare decision time and travels with the
 * summary.
 */
export function summarizeNameRequests(
  rows: readonly NameRequestLike[],
  options: { today?: string; legacyApproval?: boolean; timeZone?: string } = {},
): NameRequestSummary {
  let best: { row: NameRequestLike; status: NameRequestStatus } | undefined;
  for (const row of rows) {
    const status = nameRequestStatus(row);
    if (SUMMARY_RANK[status] === 0) continue;
    if (!best || SUMMARY_RANK[status] > SUMMARY_RANK[best.status]
      || (SUMMARY_RANK[status] === SUMMARY_RANK[best.status] && String(row.updatedAtISO ?? row.createdAtISO ?? "") > String(best.row.updatedAtISO ?? best.row.createdAtISO ?? ""))) {
      best = { row, status };
    }
  }
  if (!best) {
    const anyExplicit = rows.some(hasExplicitNameRequestStatus);
    return options.legacyApproval && !anyExplicit ? { state: "approved" } : { state: "none" };
  }
  const { row, status } = best;
  const expiresOn = isValidDateOnly(row.expiresOn) ? row.expiresOn : undefined;
  const daysUntilExpiry = expiresOn && options.today && isValidDateOnly(options.today) ? daysBetween(options.today, expiresOn) : undefined;
  const summary: NameRequestSummary = {
    state: status === "approved" ? "approved" : status === "submitted" ? "pending" : "rejected",
    id: row._id === undefined || row._id === null ? undefined : String(row._id),
    name: text(nameRequestDisplayName(row)),
    requestId: text(row.requestId),
    nuansReportNumber: text(row.nuansReportNumber),
    submittedOn: isValidDateOnly(row.submittedOn) ? row.submittedOn : undefined,
    decisionExpectedAtISO: isDecisionExpectedValue(row.decisionExpectedAtISO) ? withDecisionTimeZone(row.decisionExpectedAtISO, options.timeZone) : undefined,
    decidedOn: isValidDateOnly(row.decidedOn) ? row.decidedOn : undefined,
    expiresOn,
    daysUntilExpiry,
    timeZone: options.timeZone,
  };
  return Object.fromEntries(Object.entries(summary).filter(([, value]) => value !== undefined)) as NameRequestSummary;
}

// ---------------------------------------------------------------------------
// Wording
// ---------------------------------------------------------------------------

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * "Nov 17", or "Nov 17, 2026" when the year differs from `today`'s (or no
 * `today` is given and `withYear` is set). Parsed from the parts, so no time
 * zone shift.
 */
export function formatShortDate(value: string | null | undefined, options: { today?: string; withYear?: boolean } = {}): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value ?? "");
  if (!match) return value ?? "";
  const month = MONTHS_SHORT[Number(match[2]) - 1];
  if (!month) return value ?? "";
  const sameYear = options.today ? options.today.slice(0, 4) === match[1] : !options.withYear;
  return `${month} ${Number(match[3])}${sameYear ? "" : `, ${match[1]}`}`;
}

/** "2:00 p.m." from 24-hour parts. */
function formatClock(hour: number, minute: number): string {
  const suffix = hour < 12 ? "a.m." : "p.m.";
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  return `${twelve}:${String(minute).padStart(2, "0")} ${suffix}`;
}

/**
 * How to word a decision time: `timeZone` is the clock to show it on
 * (omitted: the runtime's, so the viewer's in a browser); `sourceTimeZone`
 * is where an older bare local time was given (omitted: the same clock).
 */
export type DecisionTimeWording = { today?: string; timeZone?: string; sourceTimeZone?: string };

/**
 * "Nov 18, 2:00 p.m. PST" on the viewer's clock (or `timeZone`'s), or
 * "Nov 18" for a day only.
 */
export function formatDecisionExpected(value: string | null | undefined, options: DecisionTimeWording = {}): string {
  if (!isDecisionExpectedValue(value)) return value ?? "";
  if (!decisionExpectedHasTime(value)) return formatShortDate(value, options);
  const at = decisionExpectedInstant(value, options.sourceTimeZone ?? options.timeZone);
  if (at === undefined) return formatShortDate(value.slice(0, 10), options);
  const clock = wallClockInZone(at, options.timeZone);
  const zone = timeZoneAbbreviation(options.timeZone, at);
  return `${formatShortDate(clock.date, options)}, ${formatClock(clock.hour, clock.minute)}${zone ? ` ${zone}` : ""}`;
}

/** The decision time as the form edits it: a day, a time (`HH:MM`) and a zone. */
export type DecisionTimeFields = { date: string; time: string; timeZone: string };

/**
 * Form fields for a saved decision time. A time with an offset opens in the
 * viewer's zone when that's where it was given, else in the first Canadian
 * zone with the same offset at that moment, else converted to the viewer's
 * zone. An older bare time opens in `sourceTimeZone` (the organization's)
 * when known.
 */
export function decisionTimeFields(
  value: string | null | undefined,
  zones: { viewerTimeZone: string; sourceTimeZone?: string },
): DecisionTimeFields {
  const viewer = zones.viewerTimeZone;
  if (!isDecisionExpectedValue(value)) return { date: "", time: "", timeZone: viewer };
  if (!decisionExpectedHasTime(value)) return { date: value, time: "", timeZone: viewer };
  if (isBareLocalTime(value)) return { date: value.slice(0, 10), time: value.slice(11, 16), timeZone: zones.sourceTimeZone || viewer };
  const at = Date.parse(value);
  const offsetText = DECISION_TIME.exec(value)?.[5] ?? "Z";
  const offset = offsetText === "Z" ? 0 : (offsetText.startsWith("-") ? -1 : 1) * (Number(offsetText.slice(1, 3)) * 60 + Number(offsetText.slice(4, 6)));
  const timeZone = [viewer, ...CANADIAN_TIME_ZONES.map((choice) => choice.zone)].find((zone) => offsetMinutesAt(at, zone) === offset) ?? viewer;
  const clock = wallClockInZone(at, timeZone);
  return { date: clock.date, time: clock.time, timeZone };
}

/** What the form saves: the day alone, or the time with its offset in the chosen zone. */
export function decisionExpectedFromFields(fields: Partial<DecisionTimeFields>): string | undefined {
  const date = String(fields.date ?? "").trim();
  if (!isValidDateOnly(date)) return undefined;
  const time = String(fields.time ?? "").trim();
  if (!time) return date;
  return zonedDateTimeISO(date, time, fields.timeZone || undefined);
}

/**
 * "That's 5:00 p.m. your time" (with the day when it differs) under the form
 * when the chosen zone's clock isn't the viewer's; undefined otherwise.
 */
export function decisionTimeViewerHint(fields: Partial<DecisionTimeFields>, viewerTimeZone: string): string | undefined {
  if (!fields.time || !fields.timeZone || fields.timeZone === viewerTimeZone) return undefined;
  const value = decisionExpectedFromFields(fields);
  const at = value ? Date.parse(value) : Number.NaN;
  if (!Number.isFinite(at) || offsetMinutesAt(at, viewerTimeZone) === offsetMinutesAt(at, fields.timeZone)) return undefined;
  const mine = wallClockInZone(at, viewerTimeZone);
  const day = mine.date === fields.date ? "" : `${formatShortDate(mine.date)}, `;
  return `That's ${day}${formatClock(mine.hour, mine.minute)} your time`;
}

/** "Request 21480579 · Submitted Nov 17 · Decision expected Nov 18, 2:00 p.m. PST" and similar. */
export function nameRequestProgressLine(row: NameRequestLike, options: DecisionTimeWording = {}): string {
  const status = nameRequestStatus(row);
  const parts: string[] = [];
  if (text(row.requestId)) parts.push(`Request ${text(row.requestId)}`);
  if (status === "approved" || status === "rejected") {
    const verb = status === "approved" ? "Approved" : "Rejected";
    parts.push(isValidDateOnly(row.decidedOn) ? `${verb} ${formatShortDate(row.decidedOn, options)}` : verb);
    if (status === "approved" && isValidDateOnly(row.expiresOn)) parts.push(`Expires ${formatShortDate(row.expiresOn, options)}`);
    return parts.join(" · ");
  }
  if (isValidDateOnly(row.submittedOn)) parts.push(`Submitted ${formatShortDate(row.submittedOn, options)}`);
  if (status === "submitted" && isDecisionExpectedValue(row.decisionExpectedAtISO)) {
    parts.push(`Decision expected ${formatDecisionExpected(row.decisionExpectedAtISO, options)}`);
  }
  return parts.join(" · ");
}

// ---------------------------------------------------------------------------
// Incorporation packet
// ---------------------------------------------------------------------------

export type NameApprovalPacketView = {
  hasRecord: boolean;
  /** The approved name, spelled as approved. */
  name: string;
  /** "Proposed corporate name: DDC North Inc. Name approved by …" for the articles worksheet. */
  line: string;
};

/**
 * The federal articles worksheet's name line: the latest approved request,
 * with who approved it, when, its references and expiry, and a prompt when
 * the workspace name is spelled differently.
 */
export function nameApprovalPacketView(
  rows: readonly (NameRequestLike & { registry?: string | null })[],
  organizationName: string | null | undefined,
  formatDate: (dateOnly: string) => string,
): NameApprovalPacketView {
  const approved = rows
    .filter((row) => nameRequestStatus(row) === "approved" && nameRequestDisplayName(row))
    .sort((a, b) => String(b.updatedAtISO ?? b.createdAtISO ?? "").localeCompare(String(a.updatedAtISO ?? a.createdAtISO ?? "")))[0];
  if (!approved) return { hasRecord: false, name: "", line: "" };
  const name = nameRequestDisplayName(approved);
  const by = text(approved.registry) ? ` by ${text(approved.registry)}` : "";
  const on = isValidDateOnly(approved.decidedOn) ? ` on ${formatDate(approved.decidedOn)}` : "";
  const references = [text(approved.requestId) ? `request ${text(approved.requestId)}` : "", text(approved.nuansReportNumber) ? `NUANS ${text(approved.nuansReportNumber)}` : ""].filter(Boolean);
  const expires = isValidDateOnly(approved.expiresOn) ? ` The approval expires ${formatDate(approved.expiresOn)}; file before then.` : "";
  const squash = (value: string) => value.trim().replace(/\s+/g, " ");
  const differs = Boolean(organizationName && squash(organizationName) !== squash(name));
  const named = `Proposed corporate name: ${name}${/[.!?]$/.test(name) ? "" : "."}`;
  const sentence = `Name approved${by}${on}${references.length ? ` (${references.join("; ")})` : ""}. Use it exactly as approved in the application.${expires}${differs ? ` [The workspace is named ${squash(String(organizationName))}; update it to match the approved name.]` : ""}`;
  return { hasRecord: true, name, line: `${named} ${sentence}` };
}
