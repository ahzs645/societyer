import { loadComplianceRulePacks } from "./registry";
import type {
  ComplianceContextKind,
  ComplianceDateOffset,
  ComplianceObligationSchedule,
  ComplianceRule,
  ComplianceRulePack,
  ComplianceSource,
} from "./rulePackSchema";

export type ComplianceFacts = {
  jurisdictionCode: string;
  entityType: string;
  entitySubtype?: string;
  homeJurisdictionCode?: string;
  contextKind?: ComplianceContextKind;
  registrationType?: string;
  corporationClass?: string;
  status?: string;
  asOfDate?: string;
  incorporationDate?: string;
  anniversaryDate?: string;
  fiscalYearEnd?: string;
  registrationDate?: string;
  commencedBusinessDate?: string;
  annualMeetingDate?: string;
  annualMeetingYear?: number;
  agmExtensionDate?: string;
  agmExtensionEvidence?: string;
  annualReferenceDate?: string;
  completedOccurrenceKeys?: string[];
  eventDates?: Record<string, string | undefined>;
  contextKey?: string;
  contextLabel?: string;
  sourceRegistrationId?: string;
  legalSubtype?: string;
  formationStatus?: string;
};

export type ComplianceObligationStatus = "upcoming" | "due_today" | "overdue";

export type ComplianceObligation = {
  packId: string;
  ruleId: string;
  ruleStatus: ComplianceRule["status"];
  obligationKey: string;
  title: string;
  scheduleKind: ComplianceObligationSchedule["kind"];
  dueDate: string;
  occurrenceKey: string;
  status: ComplianceObligationStatus;
  windowStartDate?: string;
  authority: ComplianceRule["authority"];
  sources: ComplianceSource[];
  creates?: ComplianceRule["creates"];
  caveat?: string;
  jurisdictionCode: string;
  contextKind?: ComplianceContextKind;
  contextKey: string;
  contextLabel?: string;
  sourceRegistrationId?: string;
};

function parseDate(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || formatDate(date) !== value) throw new Error(`Invalid calendar date: ${value}`);
  return date;
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function daysInMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

export function addComplianceDateOffset(value: string, offset: ComplianceDateOffset): string {
  const date = parseDate(value);
  if (offset.years) {
    const day = date.getUTCDate();
    const month = date.getUTCMonth();
    date.setUTCDate(1);
    date.setUTCFullYear(date.getUTCFullYear() + offset.years);
    date.setUTCDate(Math.min(day, daysInMonth(date.getUTCFullYear(), month)));
  }
  if (offset.months) {
    const day = date.getUTCDate();
    const targetMonthIndex = date.getUTCMonth() + offset.months;
    date.setUTCDate(1);
    date.setUTCMonth(targetMonthIndex);
    date.setUTCDate(Math.min(day, daysInMonth(date.getUTCFullYear(), date.getUTCMonth())));
  }
  if (offset.days) {
    date.setUTCDate(date.getUTCDate() + offset.days);
  }
  return formatDate(date);
}

function compareDate(left: string, right: string): number {
  return left.localeCompare(right);
}

function getFactDate(facts: ComplianceFacts, factKey: string): string | undefined {
  const dates: Record<string, string | undefined> = {
    incorporationDate: facts.incorporationDate,
    anniversaryDate: facts.anniversaryDate,
    fiscalYearEnd: facts.fiscalYearEnd,
    registrationDate: facts.registrationDate,
    commencedBusinessDate: facts.commencedBusinessDate,
    annualMeetingDate: facts.annualMeetingDate,
    annualReferenceDate: facts.annualReferenceDate,
  };
  const value = factKey in dates ? dates[factKey] : facts.eventDates?.[factKey];
  if (!value) return undefined;
  try { parseDate(value); return value; } catch { return undefined; }
}

function statusFor(dueDate: string, asOfDate: string): ComplianceObligationStatus {
  const comparison = compareDate(dueDate, asOfDate);
  if (comparison === 0) return "due_today";
  return comparison < 0 ? "overdue" : "upcoming";
}

function addYears(value: string, years: number): string {
  return addComplianceDateOffset(value, { years });
}

function computeAnnualDueDate(schedule: Extract<ComplianceObligationSchedule, { kind: "annual" }>, facts: ComplianceFacts, asOfDate: string): string | undefined {
  const anchor = getFactDate(facts, schedule.anchorFact);
  if (!anchor) return undefined;
  // Select the latest commenced cycle, preserving its overdue status. A
  // calendar tick is never evidence that last year's obligation was completed.
  let yearsFromAnchor = Math.max(0, Number(asOfDate.slice(0, 4)) - Number(anchor.slice(0, 4)));
  while (yearsFromAnchor > 0 && addYears(anchor, yearsFromAnchor) > asOfDate) yearsFromAnchor -= 1;
  const dueDate = addComplianceDateOffset(addYears(anchor, yearsFromAnchor), schedule.dueOffset);
  return dueDate;
}

function computeWindowDates(schedule: Extract<ComplianceObligationSchedule, { kind: "window" }>, facts: ComplianceFacts, asOfDate: string): { dueDate: string; windowStartDate: string } | undefined {
  const openAnchor = getFactDate(facts, schedule.opens.anchorFact);
  const closeAnchor = getFactDate(facts, schedule.closes.anchorFact);
  if (!openAnchor || !closeAnchor) return undefined;

  if (schedule.recurrence === "once") {
    return {
      windowStartDate: addComplianceDateOffset(openAnchor, schedule.opens.offset),
      dueDate: addComplianceDateOffset(closeAnchor, schedule.closes.offset),
    };
  }

  let yearsFromAnchor = Math.max(0, Number(asOfDate.slice(0, 4)) - Number(openAnchor.slice(0, 4)));
  while (yearsFromAnchor > 0 && addComplianceDateOffset(addYears(openAnchor, yearsFromAnchor), schedule.opens.offset) > asOfDate) yearsFromAnchor -= 1;
  const windowStartDate = addComplianceDateOffset(addYears(openAnchor, yearsFromAnchor), schedule.opens.offset);
  const dueDate = addComplianceDateOffset(addYears(closeAnchor, yearsFromAnchor), schedule.closes.offset);
  return { windowStartDate, dueDate };
}

function computeRuleDates(rule: ComplianceRule, facts: ComplianceFacts, asOfDate: string): { dueDate: string; windowStartDate?: string } | undefined {
  const schedule = rule.schedule;
  if (rule.ruleId === "compliance-ca-bc-societies-agm-planning") {
    const year = Number(asOfDate.slice(0, 4));
    if (!facts.incorporationDate || Number(facts.incorporationDate.slice(0, 4)) >= year) return undefined;
    const fulfilledYear = facts.annualMeetingYear ?? Number(facts.annualMeetingDate?.slice(0, 4));
    if (fulfilledYear === year) return undefined;
    return { dueDate: facts.agmExtensionDate && facts.agmExtensionEvidence && Number(facts.agmExtensionDate.slice(0, 4)) - 1 === year ? facts.agmExtensionDate : `${year}-12-31` };
  }
  if (rule.ruleId === "compliance-ca-bc-societies-no-agm-annual-report") {
    const suppliedYearEnd = facts.eventDates?.noAgmCalendarYearEnd;
    const year = suppliedYearEnd ? Number(suppliedYearEnd.slice(0, 4)) : Number(asOfDate.slice(0, 4)) - 1;
    if (!facts.incorporationDate || Number(facts.incorporationDate.slice(0, 4)) >= year) return undefined;
    const fulfilledYear = facts.annualMeetingYear ?? Number(facts.annualMeetingDate?.slice(0, 4));
    if (fulfilledYear === year) return undefined;
    if (facts.agmExtensionDate && facts.agmExtensionEvidence && Number(facts.agmExtensionDate.slice(0, 4)) - 1 === year) {
      return { dueDate: addComplianceDateOffset(facts.agmExtensionDate, { days: 30 }) };
    }
    return { dueDate: `${year + 1}-01-31` };
  }
  if (rule.obligationKey === "agm.subsequent_meeting") {
    if (!facts.annualReferenceDate) return undefined;
    const gapDate = addComplianceDateOffset(facts.annualReferenceDate, { months: 15 });
    if (facts.jurisdictionCode !== "CA-BC") return { dueDate: gapDate };
    const calendarDeadline = `${Number(facts.annualReferenceDate.slice(0, 4)) + 1}-12-31`;
    return { dueDate: gapDate < calendarDeadline ? gapDate : calendarDeadline };
  }
  if (rule.obligationKey === "agm.first_meeting" && facts.annualReferenceDate) return undefined;
  if (schedule.kind === "annual") {
    const dueDate = computeAnnualDueDate(schedule, facts, asOfDate);
    return dueDate ? { dueDate } : undefined;
  }
  if (schedule.kind === "offset") {
    const anchor = getFactDate(facts, schedule.anchorFact);
    return anchor ? { dueDate: addComplianceDateOffset(anchor, schedule.dueOffset) } : undefined;
  }
  return computeWindowDates(schedule, facts, asOfDate);
}

function computeRuleOccurrences(rule: ComplianceRule, facts: ComplianceFacts, asOfDate: string): { dueDate: string; windowStartDate?: string }[] {
  const schedule = rule.schedule;
  const recurring = schedule.kind === "annual" || (schedule.kind === "window" && schedule.recurrence === "annual");
  if (!recurring) {
    const dates = computeRuleDates(rule, facts, asOfDate);
    return dates ? [dates] : [];
  }
  const anchorKey = schedule.kind === "annual" ? schedule.anchorFact : schedule.opens.anchorFact;
  const anchor = getFactDate(facts, anchorKey);
  if (!anchor) return [];
  const results: { dueDate: string; windowStartDate?: string }[] = [];
  const lastYear = Math.max(0, Number(asOfDate.slice(0, 4)) - Number(anchor.slice(0, 4)));
  for (let year = 0; year <= lastYear; year += 1) {
    if (schedule.kind === "annual") {
      const shifted = addYears(anchor, year);
      if (shifted > asOfDate && results.length) break;
      results.push({ dueDate: addComplianceDateOffset(shifted, schedule.dueOffset) });
    } else {
      const closeAnchor = getFactDate(facts, schedule.closes.anchorFact);
      if (!closeAnchor) return [];
      const windowStartDate = addComplianceDateOffset(addYears(anchor, year), schedule.opens.offset);
      if (windowStartDate > asOfDate && results.length) break;
      results.push({ windowStartDate, dueDate: addComplianceDateOffset(addYears(closeAnchor, year), schedule.closes.offset) });
    }
  }
  return results;
}

export function filterApplicableCompliancePacks(facts: Pick<ComplianceFacts, "jurisdictionCode" | "entityType">, packs: ComplianceRulePack[] = loadComplianceRulePacks()): ComplianceRulePack[] {
  return packs.filter(
    (pack) =>
      pack.jurisdictionCode === facts.jurisdictionCode &&
      pack.entityTypes.includes(facts.entityType) &&
      pack.status !== "deprecated",
  );
}

function stringMatches(value: string | undefined, candidates: string[] | undefined): boolean {
  return !candidates?.length || Boolean(value && candidates.includes(value));
}

function ruleAppliesToFacts(rule: ComplianceRule, pack: ComplianceRulePack, facts: ComplianceFacts): boolean {
  const appliesTo = rule.appliesTo;
  if (!appliesTo) {
    return pack.entityTypes.includes(facts.entityType);
  }
  const contextKind = facts.contextKind ?? "home";
  const homeJurisdictionCode = facts.homeJurisdictionCode ?? (contextKind === "home" ? facts.jurisdictionCode : undefined);
  return (
    stringMatches(facts.entityType, appliesTo.entityTypes ?? pack.entityTypes) &&
    stringMatches(facts.entitySubtype, appliesTo.entitySubtypes) &&
    stringMatches(contextKind, appliesTo.contextKinds) &&
    stringMatches(homeJurisdictionCode, appliesTo.homeJurisdictionCodes) &&
    stringMatches(facts.registrationType, appliesTo.registrationTypes) &&
    stringMatches(facts.corporationClass, appliesTo.corporationClasses)
  );
}

function sourcesForRule(rule: ComplianceRule, pack: ComplianceRulePack): ComplianceSource[] {
  const sourceIds = rule.authority.sourceIds ?? [];
  if (!sourceIds.length) return [];
  const sourcesById = new Map(pack.sources.map((source) => [source.sourceId, source]));
  return sourceIds.map((sourceId) => sourcesById.get(sourceId)).filter((source): source is ComplianceSource => Boolean(source));
}

export function computeComplianceObligations(facts: ComplianceFacts, packs: ComplianceRulePack[] = loadComplianceRulePacks()): ComplianceObligation[] {
  if (facts.formationStatus === "preparing" || facts.formationStatus === "submitted") return [];
  const asOfDate = facts.asOfDate ?? formatDate(new Date());
  const contextKind = facts.contextKind ?? "home";
  const applicablePacks = filterApplicableCompliancePacks(facts, packs);
  const obligations: ComplianceObligation[] = [];

  for (const pack of applicablePacks) {
    for (const rule of pack.rules) {
      if (rule.status === "deprecated") continue;
      if (!ruleAppliesToFacts(rule, pack, facts)) continue;
      if (facts.legalSubtype && ["unlimited_liability_company", "community_contribution_company", "benefit_company", "other"].includes(facts.legalSubtype)) continue;
      for (const dates of computeRuleOccurrences(rule, facts, asOfDate)) {
        const occurrenceKey = `${facts.contextKey ?? "home"}:${rule.ruleId}:${dates.dueDate}`;
        if (facts.completedOccurrenceKeys?.includes(occurrenceKey)) continue;
        obligations.push({
          packId: pack.packId,
          ruleId: rule.ruleId,
          ruleStatus: rule.status,
          obligationKey: rule.obligationKey,
          title: rule.title,
          scheduleKind: rule.schedule.kind,
          dueDate: dates.dueDate,
          occurrenceKey,
          windowStartDate: dates.windowStartDate,
          status: statusFor(dates.dueDate, asOfDate),
          authority: rule.authority,
          sources: sourcesForRule(rule, pack),
          creates: rule.creates,
          caveat: [rule.caveat, facts.formationStatus === "unverified" ? "Formation status is unverified; confirm the certificate before relying on this legacy deadline." : undefined].filter(Boolean).join(" ") || undefined,
          jurisdictionCode: facts.jurisdictionCode,
          contextKind,
          contextKey: facts.contextKey ? `${facts.contextKey}:${rule.ruleId}` : rule.ruleId,
          contextLabel: facts.contextLabel,
          sourceRegistrationId: facts.sourceRegistrationId,
        });
      }
    }
  }

  return obligations.sort((left, right) => left.dueDate.localeCompare(right.dueDate) || left.ruleId.localeCompare(right.ruleId));
}
