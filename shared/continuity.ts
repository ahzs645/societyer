/**
 * Record-continuity engine (finding A15 / schema §5b / intake-design §6.3).
 *
 * Pure: takes a snapshot of native records plus governance expectations and
 * returns, for every expected period, one status. `shared/functions/continuity.ts`
 * loads the snapshot over `ctx.db`; tests call these functions directly.
 *
 * "Evidence missing" is always reported separately from "not done": a period
 * with no record is `record_missing` (or `source_only` when a source mentions
 * it), never "not held", unless a person marks it `never_held`.
 */

import {
  rulePackForSociety,
  type BodyKind,
  type CadenceRule,
  type ExpectationKind,
  type ExpectationOrigin,
  type ExpectationSeverity,
} from "./continuityRules";

export const CONTINUITY_STATUSES = [
  "satisfied",
  "draft_only",
  "record_missing",
  "source_only",
  "cancelled",
  "never_held",
  "waived",
  "not_applicable",
  "upcoming",
] as const;
export type ContinuityStatus = (typeof CONTINUITY_STATUSES)[number];

export const CONTINUITY_STATUS_LABELS: Record<ContinuityStatus, string> = {
  satisfied: "Record on file",
  draft_only: "Draft or unapproved only",
  record_missing: "Record missing",
  source_only: "Only in source files",
  cancelled: "Cancelled",
  never_held: "Never held",
  waived: "Waived",
  not_applicable: "Not applicable",
  upcoming: "Upcoming",
};

/** Statuses a person can set on a period. */
export const PERIOD_MARK_STATUSES = ["never_held", "cancelled", "waived", "not_applicable", "satisfied"] as const;
export type PeriodMarkStatus = (typeof PERIOD_MARK_STATUSES)[number];

/** A period that still needs attention. */
export function isGapStatus(status: ContinuityStatus): boolean {
  return status === "record_missing" || status === "source_only" || status === "draft_only";
}

export type EffectiveExpectation = {
  key: string;
  id?: string;
  stored: boolean;
  title: string;
  kind: ExpectationKind | string;
  bodyKind: BodyKind | string;
  committeeId?: string;
  meetingType?: string;
  rule: CadenceRule;
  effectiveFrom?: string;
  effectiveTo?: string;
  severity: ExpectationSeverity | string;
  origin: ExpectationOrigin | string;
  ruleKey?: string;
  citation?: string;
  caveat?: string;
  status: string;
  notes?: string;
};

export type EvidenceRef = { table: string; id: string; label: string; date?: string; status?: string };

export type ContinuityPeriod = {
  periodKey: string;
  label: string;
  start: string;
  end: string;
  dueDate: string;
  status: ContinuityStatus;
  expectedCount: number;
  foundCount: number;
  evidence: EvidenceRef[];
  note?: string;
  mark?: { id: string; status: string; reason?: string; evidenceDocumentIds?: string[] };
};

export type ContinuityRow = {
  expectation: EffectiveExpectation;
  bodyKey: string;
  bodyLabel: string;
  periods: ContinuityPeriod[];
};

export type SnapshotMeeting = { _id: string; type?: string; title?: string; scheduledAt: string; status?: string; committeeId?: string; minutesId?: string };
export type SnapshotMinutes = { _id: string; meetingId: string; heldAt?: string; approvedAt?: string; approvedInMeetingId?: string; status?: string };
export type SnapshotFiling = { _id: string; kind: string; periodLabel?: string; dueDate?: string; filedAt?: string; status?: string; confirmationNumber?: string };
export type SnapshotFinancial = { _id: string; fiscalYear: string; periodEnd?: string; presentedAtMeetingId?: string; approvedByBoardAt?: string };
export type SnapshotStatementImport = { _id: string; fiscalYear: string; periodEnd?: string; status?: string; title?: string };
export type SnapshotDirector = { _id: string; firstName?: string; lastName?: string; termStart?: string; termEnd?: string; consentOnFile?: boolean; status?: string };
export type SnapshotInsurance = { _id: string; kind?: string; policySeriesKey?: string; policyNumber?: string; insurer?: string; startDate?: string; endDate?: string; status?: string };
export type SnapshotSourceSignal = { table: string; id: string; date: string; bodyKey?: string; infoType?: string; label: string };
export type SnapshotMark = { _id: string; expectationKey: string; periodKey: string; status: string; reason?: string; evidenceDocumentIds?: string[]; meetingId?: string };
export type SnapshotCommittee = { _id: string; name: string; status?: string };
export type SnapshotMinutesText = { minutesId: string; meetingId: string; heldAt: string; text: string };

export type ContinuitySnapshot = {
  today: string;
  society: { incorporationDate?: string; jurisdictionCode?: string; entityType?: string; isMemberFunded?: boolean; fiscalYearEnd?: string } | null;
  committees: SnapshotCommittee[];
  meetings: SnapshotMeeting[];
  minutes: SnapshotMinutes[];
  adoptedMinutesIds: string[];
  filings: SnapshotFiling[];
  financials: SnapshotFinancial[];
  statementImports: SnapshotStatementImport[];
  directors: SnapshotDirector[];
  insurance: SnapshotInsurance[];
  sourceSignals: SnapshotSourceSignal[];
  marks: SnapshotMark[];
  /** Which record families the caller could read; unreadable families are reported, not guessed. */
  readable: { meetings: boolean; filings: boolean; financials: boolean; directors: boolean; insurance: boolean; sources: boolean };
};

/* -------------------------------- dates ---------------------------------- */

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (value: number) => String(value).padStart(2, "0");
export const dateOnly = (value: string | undefined | null) => (typeof value === "string" ? value.slice(0, 10) : "");
const yearOf = (value: string | undefined | null) => Number(String(value ?? "").slice(0, 4)) || 0;

function addDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function daysBetween(a: string, b: string) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

function lastDayOfMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/* --------------------------- expectations -------------------------------- */

export function bodyKeyFor(expectation: Pick<EffectiveExpectation, "bodyKind" | "committeeId">) {
  if (expectation.bodyKind === "committee" && expectation.committeeId) return `committee:${expectation.committeeId}`;
  return String(expectation.bodyKind);
}

export function bodyLabelFor(bodyKey: string, committees: readonly SnapshotCommittee[]) {
  if (bodyKey === "members") return "Members";
  if (bodyKey === "board") return "Board of directors";
  if (bodyKey === "organization") return "Organization";
  if (bodyKey.startsWith("committee:")) return committees.find((committee) => committee._id === bodyKey.slice(10))?.name ?? "Committee";
  return bodyKey;
}

/** Earliest year the organization has any record, used when no incorporation date is set. */
export function inceptionYear(snapshot: Pick<ContinuitySnapshot, "society" | "meetings" | "today">) {
  const incorporated = yearOf(snapshot.society?.incorporationDate);
  if (incorporated) return incorporated;
  const years = snapshot.meetings.map((meeting) => yearOf(meeting.scheduledAt)).filter((year) => year > 1900);
  return years.length ? Math.min(...years) : yearOf(snapshot.today);
}

/**
 * Combine stored expectations with the jurisdiction rule pack: a rule-pack
 * rule applies implicitly until a stored row with the same `ruleKey` takes
 * over (an archived stored row switches the rule off).
 */
export function effectiveExpectations(
  stored: readonly EffectiveExpectation[],
  snapshot: Pick<ContinuitySnapshot, "society" | "meetings" | "today">,
): EffectiveExpectation[] {
  const byRuleKey = new Map(stored.filter((row) => row.ruleKey).map((row) => [row.ruleKey as string, row]));
  const implicit: EffectiveExpectation[] = [];
  const pack = rulePackForSociety(snapshot.society);
  const incorporated = yearOf(snapshot.society?.incorporationDate);
  const firstYear = inceptionYear(snapshot);
  for (const rule of pack?.rules ?? []) {
    if (byRuleKey.has(rule.ruleKey)) continue;
    if (rule.ruleKey === "BC-SOC-DIRECTORS-MIN" && snapshot.society?.isMemberFunded) continue;
    const startYear = incorporated ? incorporated + (rule.startsYearsAfterIncorporation ?? 0) : firstYear;
    implicit.push({
      key: rule.ruleKey,
      stored: false,
      title: rule.title,
      kind: rule.kind,
      bodyKind: rule.bodyKind,
      meetingType: rule.meetingType,
      rule: rule.rule,
      effectiveFrom: `${startYear}-01-01`,
      severity: rule.severity,
      origin: "rule_pack",
      ruleKey: rule.ruleKey,
      citation: rule.citation,
      caveat: rule.caveat,
      status: "active",
    });
  }
  return [...implicit, ...stored].filter((row) => row.status === "active");
}

/* --------------------------- period expansion ---------------------------- */

export type ExpectedPeriod = { periodKey: string; label: string; start: string; end: string; dueDate: string; expectedCount: number; months?: number[] };

export function expandPeriods(expectation: EffectiveExpectation, fromYear: number, toYear: number): ExpectedPeriod[] {
  const rule = expectation.rule ?? { frequency: "ad_hoc" };
  const startYear = Math.max(fromYear, yearOf(expectation.effectiveFrom) || fromYear);
  const endYear = Math.min(toYear, yearOf(expectation.effectiveTo) || toYear);
  const effectiveFrom = expectation.effectiveFrom ? dateOnly(expectation.effectiveFrom) : "";
  const effectiveTo = expectation.effectiveTo ? dateOnly(expectation.effectiveTo) : "";
  const periods: ExpectedPeriod[] = [];
  const months = rule.months?.length ? rule.months : undefined;
  for (let year = startYear; year <= endYear; year += 1) {
    switch (rule.frequency) {
      case "monthly":
        for (let month = 1; month <= 12; month += 1) {
          if (months && !months.includes(month)) continue;
          const start = `${year}-${pad(month)}-01`;
          const end = `${year}-${pad(month)}-${pad(lastDayOfMonth(year, month))}`;
          periods.push({ periodKey: `${year}-${pad(month)}`, label: `${MONTH_LABELS[month - 1]} ${year}`, start, end, dueDate: end, expectedCount: 1 });
        }
        break;
      case "quarterly":
        for (let quarter = 1; quarter <= 4; quarter += 1) {
          const firstMonth = (quarter - 1) * 3 + 1;
          const start = `${year}-${pad(firstMonth)}-01`;
          const end = `${year}-${pad(firstMonth + 2)}-${pad(lastDayOfMonth(year, firstMonth + 2))}`;
          periods.push({ periodKey: `${year}-Q${quarter}`, label: `Q${quarter} ${year}`, start, end, dueDate: end, expectedCount: 1 });
        }
        break;
      case "per_year_count":
        periods.push({ periodKey: String(year), label: String(year), start: `${year}-01-01`, end: `${year}-12-31`, dueDate: `${year}-12-31`, expectedCount: Math.max(1, rule.count ?? 1), months });
        break;
      case "ad_hoc":
        break;
      default:
        periods.push({ periodKey: String(year), label: String(year), start: `${year}-01-01`, end: `${year}-12-31`, dueDate: `${year}-12-31`, expectedCount: 1 });
    }
  }
  return periods.filter((period) => (!effectiveFrom || period.end >= effectiveFrom) && (!effectiveTo || period.start <= effectiveTo));
}

/* ----------------------------- meetings ---------------------------------- */

type MeetingClass = "approved" | "draft" | "minutes_missing" | "cancelled" | "scheduled";
const CLASS_RANK: Record<MeetingClass, number> = { approved: 5, draft: 4, minutes_missing: 3, cancelled: 2, scheduled: 1 };

export function isHeldStatus(status: string | undefined) {
  return status === "Held" || status === "HeldMinutesMissing" || status === "Draft";
}

export function classifyMeeting(
  meeting: SnapshotMeeting,
  minutesByMeeting: ReadonlyMap<string, SnapshotMinutes>,
  adopted: ReadonlySet<string>,
): MeetingClass {
  const status = String(meeting.status ?? "");
  if (status === "Cancelled") return "cancelled";
  if (!isHeldStatus(status)) return "scheduled";
  const minutes = minutesByMeeting.get(meeting._id);
  if (status === "HeldMinutesMissing" || !minutes) return "minutes_missing";
  if (status === "Draft") return "draft";
  if (minutes.approvedAt || minutes.approvedInMeetingId || adopted.has(minutes._id) || /^(approved|adopted)$/i.test(String(minutes.status ?? ""))) return "approved";
  return "draft";
}

function meetingBodyKey(meeting: SnapshotMeeting): string {
  if (meeting.committeeId) return `committee:${meeting.committeeId}`;
  const type = String(meeting.type ?? "");
  if (type === "AGM" || type === "SGM" || /annual general|special general/i.test(String(meeting.title ?? ""))) return "members";
  return "board";
}

function meetingsForExpectation(expectation: EffectiveExpectation, meetings: readonly SnapshotMeeting[]) {
  const key = bodyKeyFor(expectation);
  return meetings.filter((meeting) => {
    if (meetingBodyKey(meeting) !== key) return false;
    if (expectation.kind === "agm") return meeting.type === "AGM" || /annual general/i.test(String(meeting.title ?? ""));
    if (expectation.meetingType) return meeting.type === expectation.meetingType;
    return true;
  });
}

type MeetingIndex = { classOf: Map<string, MeetingClass>; minutesByMeeting: Map<string, SnapshotMinutes> };

function buildMeetingIndex(snapshot: ContinuitySnapshot): MeetingIndex {
  const minutesByMeeting = new Map<string, SnapshotMinutes>();
  for (const minutes of snapshot.minutes) minutesByMeeting.set(String(minutes.meetingId), minutes);
  for (const meeting of snapshot.meetings) {
    if (meeting.minutesId && !minutesByMeeting.has(meeting._id)) {
      const minutes = snapshot.minutes.find((row) => row._id === meeting.minutesId);
      if (minutes) minutesByMeeting.set(meeting._id, minutes);
    }
  }
  const adopted = new Set(snapshot.adoptedMinutesIds.map(String));
  const classOf = new Map<string, MeetingClass>();
  for (const meeting of snapshot.meetings) classOf.set(meeting._id, classifyMeeting(meeting, minutesByMeeting, adopted));
  return { classOf, minutesByMeeting };
}

function meetingEvidence(meeting: SnapshotMeeting, klass: MeetingClass): EvidenceRef {
  const label = { approved: "minutes approved", draft: "minutes not approved", minutes_missing: "held, minutes missing", cancelled: "cancelled", scheduled: "scheduled" }[klass];
  return { table: "meetings", id: meeting._id, label: `${meeting.title || meeting.type || "Meeting"} (${label})`, date: dateOnly(meeting.scheduledAt), status: klass };
}

function signalMatches(signal: SnapshotSourceSignal, period: ExpectedPeriod, bodyKey: string) {
  if (signal.bodyKey !== bodyKey) return false;
  const date = signal.date;
  if (date.length === 4) return period.periodKey.length === 4 && date === period.periodKey;
  if (date.length === 7) return `${date}-01` <= period.end && `${date}-31` >= period.start;
  return date >= period.start && date <= period.end;
}

function evaluateMeetingPeriod(
  expectation: EffectiveExpectation,
  period: ExpectedPeriod,
  meetings: readonly SnapshotMeeting[],
  index: MeetingIndex,
  snapshot: ContinuitySnapshot,
): Omit<ContinuityPeriod, "periodKey" | "label" | "start" | "end" | "dueDate" | "expectedCount"> {
  const inPeriod = meetings.filter((meeting) => {
    const date = dateOnly(meeting.scheduledAt);
    if (date < period.start || date > period.end) return false;
    if (period.months && !period.months.includes(Number(date.slice(5, 7)))) return false;
    return true;
  });
  // Draft/approved/format copies of one meeting share a date: count dates.
  const byDate = new Map<string, MeetingClass>();
  for (const meeting of inPeriod) {
    const date = dateOnly(meeting.scheduledAt);
    const klass = index.classOf.get(meeting._id) ?? "scheduled";
    if (!byDate.has(date) || CLASS_RANK[klass] > CLASS_RANK[byDate.get(date)!]) byDate.set(date, klass);
  }
  const classes = [...byDate.values()];
  const held = classes.filter((klass) => klass === "approved" || klass === "draft" || klass === "minutes_missing");
  const evidence = inPeriod.map((meeting) => meetingEvidence(meeting, index.classOf.get(meeting._id) ?? "scheduled")).sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const foundCount = held.length;
  const ofExpected = period.expectedCount > 1 ? ` (${foundCount} of ${period.expectedCount})` : "";
  if (foundCount >= period.expectedCount) {
    const counted = held;
    if (counted.every((klass) => klass === "approved")) return { status: "satisfied", foundCount, evidence };
    if (counted.some((klass) => klass === "minutes_missing")) {
      return { status: "record_missing", foundCount, evidence, note: `Held — minutes missing for ${counted.filter((klass) => klass === "minutes_missing").length} meeting(s)${ofExpected}` };
    }
    return { status: "draft_only", foundCount, evidence, note: `Minutes exist but approval is not recorded${ofExpected}` };
  }
  const bodyKey = bodyKeyFor(expectation);
  const signals = snapshot.readable.sources ? snapshot.sourceSignals.filter((signal) => signalMatches(signal, period, bodyKey)) : [];
  const signalEvidence = signals.slice(0, 8).map((signal) => ({ table: signal.table, id: signal.id, label: signal.label, date: signal.date, status: "source" }));
  if (period.dueDate >= snapshot.today) {
    return { status: "upcoming", foundCount, evidence: [...evidence, ...signalEvidence], note: foundCount ? `In progress${ofExpected}` : "Not yet due" };
  }
  if (!foundCount && classes.length && classes.every((klass) => klass === "cancelled")) {
    return { status: "cancelled", foundCount, evidence, note: "Only cancelled meetings recorded" };
  }
  if (signals.length) {
    return { status: "source_only", foundCount, evidence: [...evidence, ...signalEvidence], note: `Source files mention this period but no native record exists${ofExpected}` };
  }
  return { status: "record_missing", foundCount, evidence, note: foundCount ? `Fewer meetings recorded than expected${ofExpected}` : "No meeting record" };
}

/* --------------------------- other record kinds -------------------------- */

function yearsIn(text: string | undefined) {
  return [...String(text ?? "").matchAll(/(?<!\d)((?:19|20)\d{2})(?!\d)/g)].map((match) => Number(match[1]));
}

function heldAgms(snapshot: ContinuitySnapshot, index: MeetingIndex) {
  return snapshot.meetings
    .filter((meeting) => (meeting.type === "AGM" || /annual general/i.test(String(meeting.title ?? ""))) && !meeting.committeeId)
    .filter((meeting) => {
      const klass = index.classOf.get(meeting._id);
      return klass === "approved" || klass === "draft" || klass === "minutes_missing";
    })
    .sort((a, b) => dateOnly(a.scheduledAt).localeCompare(dateOnly(b.scheduledAt)));
}

function evaluateAnnualFiling(expectation: EffectiveExpectation, period: ExpectedPeriod, snapshot: ContinuitySnapshot, agms: SnapshotMeeting[]) {
  const year = Number(period.periodKey);
  const agm = agms.filter((meeting) => yearOf(meeting.scheduledAt) === year).at(-1);
  if (!agm) return { status: "not_applicable" as ContinuityStatus, foundCount: 0, evidence: [], note: `No AGM recorded for ${year}; see the AGM row` };
  const agmDate = dateOnly(agm.scheduledAt);
  const offset = expectation.rule.offsetDays ?? 30;
  const due = addDays(agmDate, offset);
  const filings = snapshot.filings.filter((filing) => /annual/i.test(filing.kind) && !/insurance/i.test(filing.kind));
  const matches = filings.filter((filing) => {
    const filed = dateOnly(filing.filedAt);
    if (filed && filed >= addDays(agmDate, -14) && filed <= addDays(agmDate, 365)) return true;
    return yearsIn(filing.periodLabel).includes(year);
  });
  const evidence: EvidenceRef[] = [
    { table: "meetings", id: agm._id, label: `AGM ${agmDate}`, date: agmDate, status: "anchor" },
    ...matches.map((filing) => ({ table: "filings", id: filing._id, label: `${filing.kind}${filing.periodLabel ? ` ${filing.periodLabel}` : ""}${filing.filedAt ? ` filed ${dateOnly(filing.filedAt)}` : " (not marked filed)"}`, date: dateOnly(filing.filedAt) || dateOnly(filing.dueDate), status: filing.status })),
  ];
  const filed = matches.filter((filing) => filing.filedAt).sort((a, b) => dateOnly(a.filedAt).localeCompare(dateOnly(b.filedAt)))[0];
  if (filed) {
    const late = daysBetween(due, dateOnly(filed.filedAt));
    return { status: "satisfied" as ContinuityStatus, foundCount: 1, evidence, note: late > 0 ? `Filed ${late} day(s) after the ${offset}-day deadline` : undefined, dueDate: due };
  }
  if (due >= snapshot.today) return { status: "upcoming" as ContinuityStatus, foundCount: 0, evidence, note: `Due ${due}`, dueDate: due };
  if (matches.length) return { status: "draft_only" as ContinuityStatus, foundCount: 0, evidence, note: "Filing recorded but not marked filed", dueDate: due };
  return { status: "record_missing" as ContinuityStatus, foundCount: 0, evidence, note: "No filing evidence on file (evidence missing is not proof it was not filed)", dueDate: due };
}

function evaluateFinancialStatement(period: ExpectedPeriod, snapshot: ContinuitySnapshot, agms: SnapshotMeeting[]) {
  const year = Number(period.periodKey);
  const agm = agms.filter((meeting) => yearOf(meeting.scheduledAt) === year).at(-1);
  if (!agm) return { status: "not_applicable" as ContinuityStatus, foundCount: 0, evidence: [], note: `No AGM recorded for ${year}` };
  const agmDate = dateOnly(agm.scheduledAt);
  const fiscalMatch = (fiscalYear: string, periodEnd?: string) => {
    const end = dateOnly(periodEnd);
    if (end) return end < agmDate && end >= addDays(agmDate, -455);
    const years = yearsIn(fiscalYear);
    return years.includes(year - 1) || years.includes(year);
  };
  const anchor: EvidenceRef = { table: "meetings", id: agm._id, label: `AGM ${agmDate}`, date: agmDate, status: "anchor" };
  const presented = snapshot.financials.filter((row) => row.presentedAtMeetingId === agm._id);
  const official = presented.length ? presented : snapshot.financials.filter((row) => fiscalMatch(row.fiscalYear, row.periodEnd));
  if (official.length) {
    return { status: "satisfied" as ContinuityStatus, foundCount: official.length, evidence: [anchor, ...official.map((row) => ({ table: "financials", id: row._id, label: `Financial statements FY ${row.fiscalYear}`, date: dateOnly(row.periodEnd) }))], note: presented.length ? undefined : "Matched by fiscal year; presentation at the AGM is not linked" };
  }
  const imports = snapshot.statementImports.filter((row) => fiscalMatch(row.fiscalYear, row.periodEnd));
  if (imports.length) {
    const verified = imports.some((row) => /verified/i.test(String(row.status ?? "")));
    return { status: (verified ? "satisfied" : "draft_only") as ContinuityStatus, foundCount: imports.length, evidence: [anchor, ...imports.map((row) => ({ table: "financialStatementImports", id: row._id, label: row.title ?? `Statement FY ${row.fiscalYear}`, date: dateOnly(row.periodEnd), status: row.status }))], note: verified ? "Imported statement (not linked to the AGM)" : "Imported statement not yet verified" };
  }
  return { status: "record_missing" as ContinuityStatus, foundCount: 0, evidence: [anchor], note: "No financial statements for the fiscal year before this AGM" };
}

function directorsInYear(snapshot: ContinuitySnapshot, year: number, currentYear: number) {
  const start = `${year}-01-01`;
  const end = `${year}-12-31`;
  return snapshot.directors.filter((director) => {
    if (year === currentYear && director.status && director.status !== "Active") return false;
    const termStart = dateOnly(director.termStart);
    const termEnd = dateOnly(director.termEnd);
    if (termStart && termStart > end) return false;
    if (termEnd && termEnd < start) return false;
    if (!termStart && year !== currentYear) return false;
    return true;
  });
}

function directorName(director: SnapshotDirector) {
  return `${director.firstName ?? ""} ${director.lastName ?? ""}`.trim() || "Director";
}

function evaluateDirectors(expectation: EffectiveExpectation, period: ExpectedPeriod, snapshot: ContinuitySnapshot) {
  const year = Number(period.periodKey);
  const directors = directorsInYear(snapshot, year, yearOf(snapshot.today));
  const evidence = directors.slice(0, 20).map((director) => ({ table: "directors", id: director._id, label: directorName(director), date: dateOnly(director.termStart), status: director.consentOnFile ? "consent" : "no consent" }));
  if (!directors.length) return { status: "record_missing" as ContinuityStatus, foundCount: 0, evidence, note: `No director register entries cover ${year}` };
  if (expectation.kind === "director_count") {
    const minimum = expectation.rule.minimumCount ?? 3;
    const count = new Set(directors.map(directorName)).size;
    return count >= minimum
      ? { status: "satisfied" as ContinuityStatus, foundCount: count, evidence }
      : { status: "record_missing" as ContinuityStatus, foundCount: count, evidence, note: `${count} of ${minimum} directors recorded` };
  }
  const missing = directors.filter((director) => !director.consentOnFile);
  return missing.length
    ? { status: "record_missing" as ContinuityStatus, foundCount: directors.length - missing.length, evidence, note: `${missing.length} director(s) without consent evidence` }
    : { status: "satisfied" as ContinuityStatus, foundCount: directors.length, evidence };
}

function evaluateInsurance(expectation: EffectiveExpectation, period: ExpectedPeriod, snapshot: ContinuitySnapshot) {
  const series = expectation.rule.seriesKey?.toLowerCase();
  const policies = snapshot.insurance.filter((policy) => {
    if (series && ![policy.policySeriesKey, policy.kind, policy.policyNumber].some((value) => String(value ?? "").toLowerCase().includes(series))) return false;
    const start = dateOnly(policy.startDate);
    const end = dateOnly(policy.endDate) || (start ? addDays(start, 365) : "");
    return start && start <= period.end && end >= period.start;
  });
  const evidence = policies.map((policy) => ({ table: "insurancePolicies", id: policy._id, label: `${policy.kind ?? "Policy"} ${policy.policyNumber ?? ""}`.trim(), date: dateOnly(policy.startDate), status: policy.status }));
  return policies.length
    ? { status: "satisfied" as ContinuityStatus, foundCount: policies.length, evidence }
    : { status: "record_missing" as ContinuityStatus, foundCount: 0, evidence, note: "No policy in force recorded" };
}

/* ----------------------------- evaluation -------------------------------- */

export type ContinuityRange = { fromYear: number; toYear: number };

export function defaultRange(snapshot: Pick<ContinuitySnapshot, "society" | "meetings" | "today">, from?: string, to?: string): ContinuityRange {
  const currentYear = yearOf(snapshot.today);
  const fromYear = yearOf(from) || inceptionYear(snapshot);
  const toYear = Math.min(yearOf(to) || currentYear, currentYear);
  return { fromYear: Math.min(fromYear, toYear), toYear };
}

export function evaluateContinuity(
  expectations: readonly EffectiveExpectation[],
  snapshot: ContinuitySnapshot,
  range: ContinuityRange,
): ContinuityRow[] {
  const index = buildMeetingIndex(snapshot);
  const agms = heldAgms(snapshot, index);
  const marks = new Map(snapshot.marks.map((mark) => [`${mark.expectationKey}|${mark.periodKey}`, mark]));
  const rows: ContinuityRow[] = [];
  for (const expectation of expectations) {
    const bodyKey = bodyKeyFor(expectation);
    const meetings = expectation.kind === "agm" || expectation.kind === "meeting" ? meetingsForExpectation(expectation, snapshot.meetings) : [];
    const periods = expandPeriods(expectation, range.fromYear, range.toYear).map((period): ContinuityPeriod => {
      let result: { status: ContinuityStatus; foundCount: number; evidence: EvidenceRef[]; note?: string; dueDate?: string };
      switch (expectation.kind) {
        case "agm":
        case "meeting":
          result = snapshot.readable.meetings ? evaluateMeetingPeriod(expectation, period, meetings, index, snapshot) : { status: "not_applicable", foundCount: 0, evidence: [], note: "Meeting records are not visible to your role" };
          break;
        case "annual_filing":
          result = snapshot.readable.filings && snapshot.readable.meetings ? evaluateAnnualFiling(expectation, period, snapshot, agms) : { status: "not_applicable", foundCount: 0, evidence: [], note: "Filing records are not visible to your role" };
          break;
        case "financial_statement":
          result = snapshot.readable.financials && snapshot.readable.meetings ? evaluateFinancialStatement(period, snapshot, agms) : { status: "not_applicable", foundCount: 0, evidence: [], note: "Financial records are not visible to your role" };
          break;
        case "director_count":
        case "director_consent":
          result = snapshot.readable.directors ? evaluateDirectors(expectation, period, snapshot) : { status: "not_applicable", foundCount: 0, evidence: [], note: "Director records are not visible to your role" };
          break;
        case "insurance_term":
          result = snapshot.readable.insurance ? evaluateInsurance(expectation, period, snapshot) : { status: "not_applicable", foundCount: 0, evidence: [], note: "Insurance records are not visible to your role" };
          break;
        default:
          result = { status: "record_missing", foundCount: 0, evidence: [], note: "No automatic matcher for this kind; attach evidence or mark the period" };
      }
      const dueDate = result.dueDate ?? period.dueDate;
      // Continuous checks for the current year read today's register.
      if (result.status === "record_missing" && dueDate >= snapshot.today && !["director_count", "director_consent", "insurance_term"].includes(String(expectation.kind))) {
        result = { ...result, status: "upcoming", note: result.note ?? "Not yet due" };
      }
      const mark = marks.get(`${expectation.key}|${period.periodKey}`);
      const out: ContinuityPeriod = {
        periodKey: period.periodKey,
        label: period.label,
        start: period.start,
        end: period.end,
        dueDate,
        expectedCount: period.expectedCount,
        foundCount: result.foundCount,
        evidence: result.evidence,
        status: result.status,
        ...(result.note ? { note: result.note } : {}),
      };
      if (mark) {
        out.mark = { id: mark._id, status: mark.status, reason: mark.reason, evidenceDocumentIds: mark.evidenceDocumentIds };
        if ((PERIOD_MARK_STATUSES as readonly string[]).includes(mark.status)) out.status = mark.status as ContinuityStatus;
        out.note = mark.reason ? `Marked ${mark.status.replace(/_/g, " ")}: ${mark.reason}` : `Marked ${mark.status.replace(/_/g, " ")}`;
        for (const documentId of mark.evidenceDocumentIds ?? []) out.evidence.push({ table: "documents", id: documentId, label: "Attached evidence", status: "attached" });
        if (mark.meetingId) out.evidence.push({ table: "meetings", id: mark.meetingId, label: "Linked meeting", status: "attached" });
      }
      return out;
    });
    rows.push({ expectation, bodyKey, bodyLabel: bodyLabelFor(bodyKey, snapshot.committees), periods });
  }
  return rows;
}

/* --------------------------- cross references ---------------------------- */

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const MONTH_RE = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
const REFERENCE_RE = new RegExp(
  `minutes\\s+(?:of|from|dated|for)\\s+(?:the\\s+)?(?:(?:previous\\s+|last\\s+|regular\\s+|special\\s+)?(?:board\\s+|executive\\s+|committee\\s+|annual\\s+general\\s+|general\\s+|agm\\s+)?meeting\\s+(?:of|held\\s+on|on|dated)\\s+)?` +
    `(?:${MONTH_RE}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+((?:19|20)\\d{2}))?|(\\d{1,2})(?:st|nd|rd|th)?\\s+${MONTH_RE}\\.?,?\\s+((?:19|20)\\d{2})|((?:19|20)\\d{2})-(\\d{2})-(\\d{2}))`,
  "gi",
);

export type MinutesReference = { referencedDate: string; excerpt: string; yearInferred: boolean };

/** Find "minutes of <date>" references in minutes text. */
export function findMinutesReferences(text: string, citingDate: string): MinutesReference[] {
  const out: MinutesReference[] = [];
  const seen = new Set<string>();
  const citingYear = yearOf(citingDate);
  for (const match of text.matchAll(REFERENCE_RE)) {
    let year: number;
    let month: number;
    let day: number;
    let yearInferred = false;
    if (match[1]) {
      month = MONTHS[match[1].slice(0, 3).toLowerCase()];
      day = Number(match[2]);
      if (match[3]) year = Number(match[3]);
      else {
        yearInferred = true;
        const candidate = `${citingYear}-${pad(month)}-${pad(day)}`;
        year = candidate > citingDate ? citingYear - 1 : citingYear;
      }
    } else if (match[4]) {
      day = Number(match[4]);
      month = MONTHS[match[5].slice(0, 3).toLowerCase()];
      year = Number(match[6]);
    } else {
      year = Number(match[7]);
      month = Number(match[8]);
      day = Number(match[9]);
    }
    if (!month || !day || day > 31 || month > 12 || !year) continue;
    const referencedDate = `${year}-${pad(month)}-${pad(day)}`;
    if (referencedDate >= citingDate || seen.has(referencedDate)) continue;
    if (daysBetween(referencedDate, citingDate) > 800) continue;
    seen.add(referencedDate);
    const start = Math.max(0, (match.index ?? 0) - 80);
    const excerpt = text.slice(start, (match.index ?? 0) + match[0].length + 40).replace(/\s+/g, " ").trim();
    out.push({ referencedDate, excerpt, yearInferred });
  }
  return out;
}

export type CrossReferenceGap = {
  key: string;
  referencedDate: string;
  citingMeetingId: string;
  citingMinutesId: string;
  citingDate: string;
  excerpt: string;
  status: ContinuityStatus;
  note: string;
  matchedMeetingId?: string;
  mark?: { id: string; status: string; reason?: string };
};

export const CROSS_REFERENCE_EXPECTATION_KEY = "xref:minutes";

export function resolveCrossReferences(texts: readonly SnapshotMinutesText[], snapshot: ContinuitySnapshot): CrossReferenceGap[] {
  const index = buildMeetingIndex(snapshot);
  const marks = new Map(snapshot.marks.filter((mark) => mark.expectationKey === CROSS_REFERENCE_EXPECTATION_KEY).map((mark) => [mark.periodKey, mark]));
  const byDate = new Map<string, SnapshotMeeting[]>();
  for (const meeting of snapshot.meetings) {
    const date = dateOnly(meeting.scheduledAt);
    byDate.set(date, [...(byDate.get(date) ?? []), meeting]);
  }
  const gaps = new Map<string, CrossReferenceGap>();
  for (const entry of texts) {
    const citingDate = dateOnly(entry.heldAt);
    for (const reference of findMinutesReferences(entry.text, citingDate)) {
      const candidates = [-2, -1, 0, 1, 2].flatMap((offset) => byDate.get(addDays(reference.referencedDate, offset)) ?? []).filter((meeting) => meeting._id !== entry.meetingId);
      const withMinutes = candidates.find((meeting) => index.minutesByMeeting.has(meeting._id) && index.classOf.get(meeting._id) !== "cancelled");
      if (withMinutes) continue;
      if (gaps.has(reference.referencedDate)) continue;
      const matched = candidates.find((meeting) => index.classOf.get(meeting._id) !== "cancelled");
      const mark = marks.get(reference.referencedDate);
      const gap: CrossReferenceGap = {
        key: `${CROSS_REFERENCE_EXPECTATION_KEY}|${reference.referencedDate}`,
        referencedDate: reference.referencedDate,
        citingMeetingId: entry.meetingId,
        citingMinutesId: entry.minutesId,
        citingDate,
        excerpt: reference.excerpt.slice(0, 300),
        status: "record_missing",
        note: matched ? "Meeting recorded, but its minutes are missing" : `No meeting or minutes recorded for ${reference.referencedDate}${reference.yearInferred ? " (year inferred)" : ""}`,
        ...(matched ? { matchedMeetingId: matched._id } : {}),
      };
      if (mark) {
        gap.mark = { id: mark._id, status: mark.status, reason: mark.reason };
        if ((PERIOD_MARK_STATUSES as readonly string[]).includes(mark.status)) gap.status = mark.status as ContinuityStatus;
      }
      gaps.set(reference.referencedDate, gap);
    }
  }
  return [...gaps.values()].sort((a, b) => a.referencedDate.localeCompare(b.referencedDate));
}

/* ---------------------------- inferred cadence --------------------------- */

export type CadenceSuggestion = {
  key: string;
  bodyKind: BodyKind;
  committeeId?: string;
  bodyLabel: string;
  title: string;
  rule: CadenceRule;
  effectiveFrom: string;
  medianIntervalDays: number;
  sampleSize: number;
  yearsObserved: number;
  confidence: number;
  rationale: string;
};

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

/** Suggest a cadence per body from its meeting history (median interval). */
export function inferCadenceSuggestions(
  snapshot: Pick<ContinuitySnapshot, "meetings" | "committees" | "today">,
  existing: readonly EffectiveExpectation[],
): CadenceSuggestion[] {
  const groups = new Map<string, string[]>();
  for (const meeting of snapshot.meetings) {
    if (meeting.status === "Cancelled" || meeting.status === "Scheduled") continue;
    const key = meetingBodyKey(meeting);
    if (key === "members") continue; // AGMs are covered by the statutory rule
    groups.set(key, [...(groups.get(key) ?? []), dateOnly(meeting.scheduledAt)]);
  }
  const covered = new Set(existing.filter((row) => row.kind === "meeting").map((row) => bodyKeyFor(row)));
  const suggestions: CadenceSuggestion[] = [];
  for (const [bodyKey, rawDates] of groups) {
    if (covered.has(bodyKey)) continue;
    const dates = [...new Set(rawDates.filter(Boolean))].sort();
    if (dates.length < 4) continue;
    const intervals = dates.slice(1).map((date, i) => daysBetween(dates[i], date)).filter((days) => days > 0);
    const medianIntervalDays = median(intervals);
    const years = new Map<number, number[]>();
    for (const date of dates) years.set(yearOf(date), [...(years.get(yearOf(date)) ?? []), Number(date.slice(5, 7))]);
    const activeYears = [...years.keys()].sort();
    const fullYears = activeYears.filter((year) => year !== activeYears[0] && year !== activeYears.at(-1));
    const sampleYears = fullYears.length ? fullYears : activeYears;
    const perYear = Math.max(1, Math.round(sampleYears.reduce((sum, year) => sum + (years.get(year)?.length ?? 0), 0) / sampleYears.length));
    const monthShare = new Map<number, number>();
    for (const year of sampleYears) for (const month of new Set(years.get(year) ?? [])) monthShare.set(month, (monthShare.get(month) ?? 0) + 1);
    const usualMonths = [...monthShare.entries()].filter(([, count]) => count / sampleYears.length >= 0.5).map(([month]) => month).sort((a, b) => a - b);
    let rule: CadenceRule;
    if (medianIntervalDays <= 45 && perYear >= 8) rule = usualMonths.length >= 8 && usualMonths.length < 12 ? { frequency: "monthly", months: usualMonths } : { frequency: "monthly" };
    else if (medianIntervalDays >= 75 && medianIntervalDays <= 110 && perYear >= 3 && perYear <= 5) rule = { frequency: "quarterly" };
    else rule = { frequency: "per_year_count", count: Math.min(perYear, 12), ...(usualMonths.length >= Math.min(perYear, 12) ? { months: usualMonths } : {}) };
    const spread = intervals.length ? intervals.filter((days) => Math.abs(days - medianIntervalDays) <= medianIntervalDays * 0.5).length / intervals.length : 0;
    const confidence = Math.round(Math.min(1, (dates.length / 12) * 0.5 + spread * 0.5) * 100) / 100;
    const bodyKind: BodyKind = bodyKey.startsWith("committee:") ? "committee" : "board";
    const bodyLabel = bodyLabelFor(bodyKey, snapshot.committees);
    suggestions.push({
      key: `inferred:${bodyKey}`,
      bodyKind,
      ...(bodyKind === "committee" ? { committeeId: bodyKey.slice(10) } : {}),
      bodyLabel,
      title: `${bodyLabel} meetings`,
      rule,
      effectiveFrom: dates[0],
      medianIntervalDays,
      sampleSize: dates.length,
      yearsObserved: activeYears.length,
      confidence,
      rationale: `${dates.length} meeting dates over ${activeYears.length} year(s); median ${medianIntervalDays} days between meetings; about ${perYear} per year${usualMonths.length ? ` usually in ${usualMonths.map((month) => MONTH_LABELS[month - 1]).join(", ")}` : ""}.`,
    });
  }
  return suggestions.sort((a, b) => b.sampleSize - a.sampleSize);
}

/* ------------------------------- summaries ------------------------------- */

export type RecordGap = {
  key: string;
  expectationKey: string;
  periodKey: string;
  title: string;
  bodyLabel: string;
  kind: string;
  severity: string;
  citation?: string;
  status: ContinuityStatus;
  label: string;
  dueDate: string;
  note?: string;
  evidence: EvidenceRef[];
};

export function flattenRecordGaps(rows: readonly ContinuityRow[], includeDraft = true): RecordGap[] {
  const out: RecordGap[] = [];
  for (const row of rows) {
    for (const period of row.periods) {
      if (!isGapStatus(period.status) || (!includeDraft && period.status === "draft_only")) continue;
      out.push({
        key: `${row.expectation.key}|${period.periodKey}`,
        expectationKey: row.expectation.key,
        periodKey: period.periodKey,
        title: row.expectation.title,
        bodyLabel: row.bodyLabel,
        kind: String(row.expectation.kind),
        severity: String(row.expectation.severity),
        citation: row.expectation.citation,
        status: period.status,
        label: period.label,
        dueDate: period.dueDate,
        note: period.note,
        evidence: period.evidence,
      });
    }
  }
  const severityRank: Record<string, number> = { statutory: 0, bylaw: 1, practice: 2 };
  const statusRank: Record<string, number> = { record_missing: 0, source_only: 1, draft_only: 2 };
  return out.sort((a, b) => (severityRank[a.severity] ?? 3) - (severityRank[b.severity] ?? 3) || (statusRank[a.status] ?? 3) - (statusRank[b.status] ?? 3) || b.periodKey.localeCompare(a.periodKey));
}

export function countStatuses(rows: readonly ContinuityRow[]) {
  const counts = Object.fromEntries(CONTINUITY_STATUSES.map((status) => [status, 0])) as Record<ContinuityStatus, number>;
  for (const row of rows) for (const period of row.periods) counts[period.status] += 1;
  return counts;
}
