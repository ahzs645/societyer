/** Evidence recorded by an authorized officer; this is not a digital-signature service. */
import { canonicalizeJurisdictionCode, homeJurisdictionCode, organizationTimeZone, type LegalEntityLike } from "./organizationDomain";
import { legalProfileRegistry } from "./legalGovernanceProfiles";

/**
 * Singular or plural label for a written-resolution count: "1 person",
 * "2 people", "1 share", "3 votes". An unknown unit counts consents.
 */
export function resolutionCountUnitLabel(count: number | null | undefined, unit?: string | null): string {
  const one = count === 1;
  switch (unit) {
    case "people": return one ? "person" : "people";
    case "shares": return one ? "share" : "shares";
    case "votes": return one ? "vote" : "votes";
    default: return one ? "consent" : "consents";
  }
}

/** New circulation records must be entered within this period after circulation. */
export const CIRCULATION_RECORDING_WINDOW_HOURS = 72;

/**
 * The organization's local calendar for circulation and record dates:
 * America/Vancouver for BC, America/Toronto for Ontario and federal
 * corporations, an explicit workspace time zone when recorded, else UTC.
 */
export function resolutionTimeZone(organization?: (LegalEntityLike & { timeZone?: string | null }) | null): string {
  const zone = organizationTimeZone(organization);
  if (zone) return zone;
  const code = canonicalizeJurisdictionCode(homeJurisdictionCode(organization));
  // A legacy society with no recorded jurisdiction resolves to the BC profile.
  const profileCode = legalProfileRegistry.resolve(organization)?.jurisdictionCode ?? "";
  if (/^CA-FED(?:-|$)/.test(code) || /^CA-(?:FED|ON)(?:-|$)/.test(profileCode)) return "America/Toronto";
  if (/^CA-BC(?:-|$)/.test(profileCode)) return "America/Vancouver";
  return "UTC";
}

/** Circulation must be recorded promptly, so the current register still reflects the circulation-date electorate. */
export function validateCirculationRecordingWindow(circulatedAtISO: string, nowISO: string) {
  const elapsed = Date.parse(nowISO) - Date.parse(circulatedAtISO);
  if (!Number.isFinite(elapsed) || elapsed < 0) throw new Error("The actual circulation date and time cannot be in the future.");
  if (elapsed > CIRCULATION_RECORDING_WINDOW_HOURS * 3_600_000) {
    throw new Error(`Record a new circulation within ${CIRCULATION_RECORDING_WINDOW_HOURS} hours after it occurred. Historical signed resolutions need their original reviewed electorate and supporting records; today's register cannot establish that history.`);
  }
}

/** The nth weekday after a calendar date. Holidays only push a business-day deadline later. */
export function weekdayAfter(dateISO: string, count: number): string | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateISO) || !Number.isSafeInteger(count) || count < 0) return undefined;
  const date = new Date(`${dateISO}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== dateISO) return undefined;
  let remaining = count;
  while (remaining > 0) {
    date.setUTCDate(date.getUTCDate() + 1);
    if (date.getUTCDay() !== 0 && date.getUTCDay() !== 6) remaining -= 1;
  }
  return date.toISOString().slice(0, 10);
}

/**
 * Allowance for statutory holidays and special proclamations inside one
 * business-day period (for example Dec 25, Dec 26 and Jan 1, plus a margin).
 */
export const NOTICE_HOLIDAY_ALLOWANCE_DAYS = 5;

/**
 * A reviewed OBCA s. 104(3) deadline must fall between the nth weekday after
 * the statutory-majority date (no holidays) and that date plus the holiday
 * allowance. A later "reviewed" date would mark late notices as complete.
 */
export function noticeDueDateWindow(triggerDateISO: string, businessDays: number) {
  const earliestISO = weekdayAfter(triggerDateISO, businessDays);
  const latestISO = weekdayAfter(triggerDateISO, businessDays + NOTICE_HOLIDAY_ALLOWANCE_DAYS);
  return earliestISO && latestISO ? { earliestISO, latestISO } : undefined;
}

export type ResolutionElector = {
  key: string;
  name: string;
  weight: number;
  memberId?: string;
  directorId?: string;
  roleHolderId?: string;
};
export type RecordedResolutionConsent = {
  electorKey?: string;
  weight?: number;
  consentEvidence?: string;
  recordedByUserId?: string;
  signedAtISO: string;
  recordedAtISO?: string;
  /** Only the Societies Act s. 1 (c) vote route records votes against. */
  vote?: "for" | "against";
};

/** Exact UTC timestamps keep the legal event separate from its later audit entry. */
export function resolutionTimestamp(value: unknown): string | undefined {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) return undefined;
  const time = new Date(value);
  if (!Number.isFinite(time.getTime())) return undefined;
  const canonical = time.toISOString();
  return canonical.slice(0, 19) === value.slice(0, 19) ? canonical : undefined;
}

export function validateResolutionEventTime(value: unknown, label: string, nowISO: string, earliestISO?: string): string {
  const timestamp = resolutionTimestamp(value);
  const now = resolutionTimestamp(nowISO);
  const earliest = earliestISO ? resolutionTimestamp(earliestISO) : undefined;
  if (!timestamp || !now) throw new Error(`Enter the actual ${label} date and time as a valid UTC timestamp.`);
  if (timestamp > now) throw new Error(`The actual ${label} date and time cannot be in the future.`);
  if (earliestISO && (!earliest || timestamp < earliest)) throw new Error(`The actual ${label} date and time cannot precede circulation or the applicable notice trigger.`);
  return timestamp;
}

export type ResolutionChronology = { circulatedAtISO?: string; asOfISO?: string };

export function resolutionConsentProgress(
  electorate: readonly ResolutionElector[],
  signatures: readonly RecordedResolutionConsent[],
  requiredCount: number,
  chronology: ResolutionChronology = {},
) {
  const electors = new Map(electorate.map((entry) => [entry.key, entry]));
  const signed = new Set<string>();
  const events: Array<{ at: string; weight: number }> = [];
  let count = 0;
  const total = electorate.reduce((sum, elector) => sum + elector.weight, 0);
  const asOf = resolutionTimestamp(chronology.asOfISO ?? new Date().toISOString());
  const circulation = chronology.circulatedAtISO ? resolutionTimestamp(chronology.circulatedAtISO) : undefined;
  let valid = electors.size === electorate.length && electorate.length > 0 && !!asOf &&
    (!chronology.circulatedAtISO || !!circulation) && Number.isSafeInteger(total) && total > 0 &&
    electorate.every((elector) => !!elector.key && !!elector.name?.trim() && Number.isSafeInteger(elector.weight) && elector.weight > 0);
  for (const signature of signatures) {
    const elector = signature.electorKey ? electors.get(signature.electorKey) : undefined;
    const signedAt = resolutionTimestamp(signature.signedAtISO);
    const recordedAt = resolutionTimestamp(signature.recordedAtISO);
    if (!elector || signed.has(elector.key) || (signature.consentEvidence?.trim().length ?? 0) < 12 ||
        !signature.recordedByUserId || signature.weight !== elector.weight ||
        !Number.isSafeInteger(elector.weight) || elector.weight < 1 || !signedAt || !recordedAt ||
        signedAt > recordedAt || !asOf || recordedAt > asOf || (circulation && signedAt < circulation) ||
        (signature.vote !== undefined && signature.vote !== "for")) {
      valid = false;
      continue;
    }
    signed.add(elector.key);
    count += elector.weight;
    events.push({ at: signedAt, weight: elector.weight });
  }
  if (!Number.isSafeInteger(count) || !Number.isSafeInteger(requiredCount) || requiredCount < 1 || requiredCount > total) valid = false;
  let thresholdReachedAtISO: string | undefined;
  if (valid) {
    let chronologicalCount = 0;
    for (const event of events.sort((a, b) => a.at.localeCompare(b.at))) {
      chronologicalCount += event.weight;
      if (chronologicalCount >= requiredCount) { thresholdReachedAtISO = event.at; break; }
    }
  }
  return { count, people: signed.size, valid, thresholdMet: valid && count >= requiredCount, thresholdReachedAtISO };
}

/**
 * Societies Act s. 1 (c) route: the threshold is a share of the votes cast by
 * mail or electronic means. The result exists only after voting closes and an
 * officer certifies that every cast vote is recorded; until then missing
 * "against" votes could change it.
 */
export function resolutionVoteProgress(
  electorate: readonly ResolutionElector[],
  signatures: readonly RecordedResolutionConsent[],
  rule: { numerator: number; denominator: number; strict: boolean },
  chronology: ResolutionChronology & { closesAtISO?: string; countCertifiedAtISO?: string },
) {
  const electors = new Map(electorate.map((entry) => [entry.key, entry]));
  const voted = new Set<string>();
  const asOf = resolutionTimestamp(chronology.asOfISO ?? new Date().toISOString());
  const circulation = resolutionTimestamp(chronology.circulatedAtISO);
  const closes = resolutionTimestamp(chronology.closesAtISO);
  const certified = resolutionTimestamp(chronology.countCertifiedAtISO);
  let valid = electors.size === electorate.length && electorate.length > 0 && !!asOf && !!circulation && !!closes && closes > circulation &&
    electorate.every((elector) => !!elector.key && !!elector.name?.trim() && elector.weight === 1);
  let count = 0;
  let against = 0;
  for (const signature of signatures) {
    const elector = signature.electorKey ? electors.get(signature.electorKey) : undefined;
    const signedAt = resolutionTimestamp(signature.signedAtISO);
    const recordedAt = resolutionTimestamp(signature.recordedAtISO);
    if (!elector || voted.has(elector.key) || (signature.consentEvidence?.trim().length ?? 0) < 12 || !signature.recordedByUserId ||
        signature.weight !== elector.weight || !signedAt || !recordedAt || signedAt > recordedAt || !asOf || recordedAt > asOf ||
        !circulation || signedAt < circulation || !closes || signedAt > closes || !["for", "against"].includes(String(signature.vote))) {
      valid = false;
      continue;
    }
    voted.add(elector.key);
    if (signature.vote === "for") count += elector.weight; else against += elector.weight;
  }
  const cast = count + against;
  const closed = !!asOf && !!closes && asOf >= closes;
  const countCertified = closed && !!certified && !!closes && certified >= closes && !!asOf && certified <= asOf;
  const requiredCount = cast > 0 ? requiredVotesCast(cast, rule) : 0;
  const thresholdMet = valid && countCertified && cast > 0 && count >= requiredCount;
  return { count, against, cast, people: voted.size, valid, closed, countCertified, requiredCount, thresholdMet,
    thresholdReachedAtISO: thresholdMet ? closes : undefined, decided: valid && countCertified };
}

/** Same fraction arithmetic as eligible-voter thresholds, applied to votes cast. */
function requiredVotesCast(cast: number, rule: { numerator: number; denominator: number; strict: boolean }) {
  const product = cast * rule.numerator;
  return rule.strict ? Math.floor(product / rule.denominator) + 1 : Math.ceil(product / rule.denominator);
}

export function validateResolutionConsent(
  electorate: readonly ResolutionElector[],
  signatures: readonly RecordedResolutionConsent[],
  electorKey: string,
  consentEvidence: string,
) {
  const elector = electorate.find((entry) => entry.key === electorKey);
  if (!elector) throw new Error("Choose a signer from the frozen legal electorate.");
  if (signatures.some((entry) => entry.electorKey === electorKey)) throw new Error("Consent from this signer is already recorded.");
  if (consentEvidence.trim().length < 12) throw new Error("Record the signed document, counterpart, or verified consent evidence and its date.");
  return elector;
}

export type ResolutionNoticeEvidence = {
  electorKey: string;
  givenAtISO: string;
  recordedAtISO: string;
  recordedByUserId: string;
  evidence: string;
  documentId?: string;
};

export type ResolutionNoticeDeadline = {
  dueDateISO?: string;
  triggerDateISO?: string;
  timeZone?: string;
  /** Statutory business-day period; OBCA s. 104(3) uses ten. */
  businessDays?: number;
  calendarEvidence?: string;
  reviewedByUserId?: string;
  reviewedAtISO?: string;
};

export function resolutionCalendarDate(timestamp: string, timeZone = "America/Toronto"): string | undefined {
  if (!resolutionTimestamp(timestamp)) return undefined;
  try {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(timestamp));
    return ["year", "month", "day"].map((part) => parts.find((entry) => entry.type === part)?.value).join("-");
  } catch { return undefined; }
}

export function resolutionNoticeProgress(
  electorate: readonly ResolutionElector[],
  signatures: readonly RecordedResolutionConsent[],
  notices: readonly ResolutionNoticeEvidence[],
  triggeredAtISO?: string,
  deadline: ResolutionNoticeDeadline = {},
  asOfISO = new Date().toISOString(),
) {
  const trigger = resolutionTimestamp(triggeredAtISO);
  const asOf = resolutionTimestamp(asOfISO);
  const electors = new Map(electorate.map((entry) => [entry.key, entry]));
  const signedAtTrigger = new Set(signatures.filter((entry) => {
    const signedAt = resolutionTimestamp(entry.signedAtISO);
    return trigger && signedAt && signedAt <= trigger;
  }).map((entry) => entry.electorKey));
  const recipients = trigger ? electorate.filter((elector) => !signedAtTrigger.has(elector.key)) : [];
  const delivered = new Map<string, ResolutionNoticeEvidence>();
  let valid = !!asOf;
  for (const notice of notices) {
    const given = resolutionTimestamp(notice.givenAtISO);
    const recorded = resolutionTimestamp(notice.recordedAtISO);
    if (!electors.has(notice.electorKey) || !trigger || !given || !recorded || !asOf || given < trigger ||
      given > recorded || recorded > asOf || !notice.recordedByUserId || notice.evidence.trim().length < 12) { valid = false; continue; }
    const prior = delivered.get(notice.electorKey);
    if (!prior || given < prior.givenAtISO) delivered.set(notice.electorKey, { ...notice, givenAtISO: given });
  }
  const timeZone = deadline.timeZone ?? "America/Toronto";
  const triggerDate = trigger ? resolutionCalendarDate(trigger, timeZone) : undefined;
  const dueDate = typeof deadline.dueDateISO === "string" && /^\d{4}-\d{2}-\d{2}$/.test(deadline.dueDateISO) && resolutionTimestamp(`${deadline.dueDateISO}T00:00:00Z`) ? deadline.dueDateISO : undefined;
  const reviewedAt = resolutionTimestamp(deadline.reviewedAtISO);
  const window = triggerDate ? noticeDueDateWindow(triggerDate, deadline.businessDays ?? 10) : undefined;
  const deadlineReviewed = !!dueDate && !!triggerDate && !!window && dueDate >= window.earliestISO && dueDate <= window.latestISO && deadline.triggerDateISO === triggerDate &&
    !!deadline.reviewedByUserId && !!reviewedAt && !!asOf && reviewedAt <= asOf && (deadline.calendarEvidence?.trim().length ?? 0) >= 12;
  const today = asOf ? resolutionCalendarDate(asOf, timeZone) : undefined;
  const detail = recipients.map((elector) => {
    const evidence = delivered.get(elector.key);
    const givenDate = evidence ? resolutionCalendarDate(evidence.givenAtISO, timeZone) : undefined;
    return { ...elector, givenAtISO: evidence?.givenAtISO, recorded: !!evidence, late: !!(deadlineReviewed && dueDate && givenDate && givenDate > dueDate) };
  });
  const recordedCount = detail.filter((elector) => elector.recorded).length;
  const lateCount = detail.filter((elector) => elector.late).length;
  const required = !!trigger && detail.length > 0;
  const coverageComplete = valid && required && recordedCount === detail.length;
  const status = !required ? undefined : !valid ? "Review required" : !coverageComplete ? "Required" : !deadlineReviewed ? "Deadline review required" : lateCount ? "Complete late" : "Complete";
  return { required, valid, status, recipients: detail, requiredCount: detail.length, recordedCount, lateCount, coverageComplete,
    triggeredAtISO: trigger, deadlineReviewed, dueDateISO: deadlineReviewed ? dueDate : undefined,
    overdue: !!(required && !coverageComplete && deadlineReviewed && dueDate && today && today > dueDate) };
}
