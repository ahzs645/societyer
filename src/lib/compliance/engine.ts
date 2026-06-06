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
  eventDates?: Record<string, string | undefined>;
  contextKey?: string;
  contextLabel?: string;
  sourceRegistrationId?: string;
};

export type ComplianceObligationStatus = "upcoming" | "due_today" | "overdue";

export type ComplianceObligation = {
  packId: string;
  ruleId: string;
  obligationKey: string;
  title: string;
  scheduleKind: ComplianceObligationSchedule["kind"];
  dueDate: string;
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
  return new Date(Date.UTC(year, month - 1, day));
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function daysInMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

function addOffset(value: string, offset: ComplianceDateOffset): string {
  const date = parseDate(value);
  if (offset.years) {
    date.setUTCFullYear(date.getUTCFullYear() + offset.years);
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
  if (factKey === "incorporationDate") return facts.incorporationDate;
  if (factKey === "anniversaryDate") return facts.anniversaryDate;
  if (factKey === "fiscalYearEnd") return facts.fiscalYearEnd;
  if (factKey === "registrationDate") return facts.registrationDate;
  if (factKey === "commencedBusinessDate") return facts.commencedBusinessDate;
  if (factKey === "annualMeetingDate") return facts.annualMeetingDate;
  return facts.eventDates?.[factKey];
}

function statusFor(dueDate: string, asOfDate: string): ComplianceObligationStatus {
  const comparison = compareDate(dueDate, asOfDate);
  if (comparison === 0) return "due_today";
  return comparison < 0 ? "overdue" : "upcoming";
}

function addYears(value: string, years: number): string {
  return addOffset(value, { years });
}

function computeAnnualDueDate(schedule: Extract<ComplianceObligationSchedule, { kind: "annual" }>, facts: ComplianceFacts, asOfDate: string): string | undefined {
  const anchor = getFactDate(facts, schedule.anchorFact);
  if (!anchor) return undefined;
  let yearsFromAnchor = 0;
  let dueDate = addOffset(anchor, schedule.dueOffset);
  while (compareDate(dueDate, asOfDate) < 0) {
    yearsFromAnchor += 1;
    dueDate = addOffset(addYears(anchor, yearsFromAnchor), schedule.dueOffset);
  }
  return dueDate;
}

function computeWindowDates(schedule: Extract<ComplianceObligationSchedule, { kind: "window" }>, facts: ComplianceFacts, asOfDate: string): { dueDate: string; windowStartDate: string } | undefined {
  const openAnchor = getFactDate(facts, schedule.opens.anchorFact);
  const closeAnchor = getFactDate(facts, schedule.closes.anchorFact);
  if (!openAnchor || !closeAnchor) return undefined;

  if (schedule.recurrence === "once") {
    return {
      windowStartDate: addOffset(openAnchor, schedule.opens.offset),
      dueDate: addOffset(closeAnchor, schedule.closes.offset),
    };
  }

  let yearsFromAnchor = 0;
  let windowStartDate = addOffset(openAnchor, schedule.opens.offset);
  let dueDate = addOffset(closeAnchor, schedule.closes.offset);
  while (compareDate(dueDate, asOfDate) < 0) {
    yearsFromAnchor += 1;
    windowStartDate = addOffset(addYears(openAnchor, yearsFromAnchor), schedule.opens.offset);
    dueDate = addOffset(addYears(closeAnchor, yearsFromAnchor), schedule.closes.offset);
  }
  return { windowStartDate, dueDate };
}

function computeRuleDates(rule: ComplianceRule, facts: ComplianceFacts, asOfDate: string): { dueDate: string; windowStartDate?: string } | undefined {
  const schedule = rule.schedule;
  if (schedule.kind === "annual") {
    const dueDate = computeAnnualDueDate(schedule, facts, asOfDate);
    return dueDate ? { dueDate } : undefined;
  }
  if (schedule.kind === "offset") {
    const anchor = getFactDate(facts, schedule.anchorFact);
    return anchor ? { dueDate: addOffset(anchor, schedule.dueOffset) } : undefined;
  }
  return computeWindowDates(schedule, facts, asOfDate);
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
  const asOfDate = facts.asOfDate ?? formatDate(new Date());
  const contextKind = facts.contextKind ?? "home";
  const applicablePacks = filterApplicableCompliancePacks(facts, packs);
  const obligations: ComplianceObligation[] = [];

  for (const pack of applicablePacks) {
    for (const rule of pack.rules) {
      if (rule.status === "deprecated") continue;
      if (!ruleAppliesToFacts(rule, pack, facts)) continue;
      const dates = computeRuleDates(rule, facts, asOfDate);
      if (!dates) continue;
      obligations.push({
        packId: pack.packId,
        ruleId: rule.ruleId,
        obligationKey: rule.obligationKey,
        title: rule.title,
        scheduleKind: rule.schedule.kind,
        dueDate: dates.dueDate,
        windowStartDate: dates.windowStartDate,
        status: statusFor(dates.dueDate, asOfDate),
        authority: rule.authority,
        sources: sourcesForRule(rule, pack),
        creates: rule.creates,
        caveat: rule.caveat,
        jurisdictionCode: facts.jurisdictionCode,
        contextKind,
        contextKey: facts.contextKey ? `${facts.contextKey}:${rule.ruleId}` : rule.ruleId,
        contextLabel: facts.contextLabel,
        sourceRegistrationId: facts.sourceRegistrationId,
      });
    }
  }

  return obligations.sort((left, right) => left.dueDate.localeCompare(right.dueDate) || left.ruleId.localeCompare(right.ruleId));
}
