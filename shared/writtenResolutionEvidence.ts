/** Evidence recorded by an authorized officer; this is not a digital-signature service. */
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
        signedAt > recordedAt || !asOf || recordedAt > asOf || (circulation && signedAt < circulation)) {
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
  const deadlineReviewed = !!dueDate && !!triggerDate && dueDate >= triggerDate && deadline.triggerDateISO === triggerDate &&
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
