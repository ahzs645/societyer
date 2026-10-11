import { legalGovernanceProfile, type GovernanceOrganization } from './legalGovernanceProfiles';
import { canonicalizeJurisdictionCode } from './organizationDomain';
import { dateOnly, deriveAgmFacts, statedReportingYear, type AgmMeetingLike } from './agmEvidence';
import { assessAnnualReturnDeadline, parseComplianceDate, type AnnualMeetingCompletion, type AnnualReturnFilingEvidence, type ComplianceSettings, type DeadlineAssessment } from './corporationSettings';

/** Only an explicit reporting year/period closes a filing cycle. Dates alone are ambiguous. */
export function annualReturnEvidence(organization: GovernanceOrganization | null | undefined, filings: readonly Record<string, any>[]): AnnualReturnFilingEvidence[] {
  const profile = legalGovernanceProfile(organization);
  const kinds: Record<string, string[]> = { bc_society: ['AnnualReport', 'BCSocietyAnnualReport'], bc_company: ['BCCompanyAnnualReport'], federal_cbca: ['FederalAnnualReturn'], ontario_obca: ['OntarioAnnualReturn'] };
  if (!profile) return [];
  return filings.filter(row => {
    if (!kinds[profile.id]?.includes(String(row.kind))) return false;
    // A return for a registration or branch does not discharge the home Act's
    // annual return. Older records without an explicit context remain usable.
    const context = String(row.contextKind ?? '').trim().toLowerCase();
    if (context && context !== 'home') return false;
    const jurisdiction = String(row.jurisdictionCode ?? '').trim();
    if (!jurisdiction) return true;
    if (canonicalizeJurisdictionCode(jurisdiction) === 'unknown') return false;
    return legalGovernanceProfile({ ...organization,
      actFormedUnder: organization?.actFormedUnder || profile.actKeys[0],
      jurisdictionCode: jurisdiction, homeJurisdictionCode: jurisdiction,
    })?.id === profile.id;
  }).map(row => {
    const dates = String(row.periodLabel ?? '').match(/\b\d{4}-\d{2}-\d{2}\b/g) ?? [];
    const periodEnd = dateOnly(row.reportingPeriodEnd) || (dates.length === 1 ? dateOnly(dates[0]) : '');
    const periodYear = periodEnd ? Number(periodEnd.slice(0, 4)) : undefined;
    const cycleYear = profile.id === 'ontario_obca' && periodYear !== undefined ? periodYear : statedReportingYear(row) ?? periodYear;
    return { cycleYear, ...(periodEnd ? { periodEnd } : {}), filedAt: dateOnly(row.filedAt), status: row.status, evidenceRef: row._id == null ? undefined : String(row._id) };
  });
}

/** Shared adapter for annual-cycle and settings screens. Dates from planning
 * never enter completion evidence; postponed BC AGMs retain one covered year. */
export function annualGovernanceSettings(
  organization: GovernanceOrganization & Record<string, any>,
  meetings: readonly AgmMeetingLike[],
  filings: readonly Record<string, any>[],
  today: string,
): ComplianceSettings {
  const profile = legalGovernanceProfile(organization);
  const facts = deriveAgmFacts(organization, meetings, today);
  const extension = profile?.id === 'bc_society' && organization.agmExtensionEvidence?.trim() && dateOnly(organization.agmExtensionDate)
    ? { cycleYear: Number(organization.agmExtensionDate.slice(0, 4)) - 1, dueDate: dateOnly(organization.agmExtensionDate), authority: 'registrar' as const, evidenceRef: String(organization.agmExtensionEvidence) } : undefined;
  const completed = new Map<string, AnnualMeetingCompletion>(facts.agmDates.map(date => [`held:${date}`, { date, kind: 'held' as const,
    ...(extension && date === dateOnly(organization.annualMeetingDate) && organization.annualMeetingYear === extension.cycleYear && date <= extension.dueDate
      ? { cycleYear: extension.cycleYear, verified: true, evidenceRef: extension.evidenceRef } : {}),
  }]));
  // A separately reviewed annual-business instrument may discharge annual
  // business without a physical meeting. Generic carried resolutions are not
  // promoted here: a reviewer must identify the kind, date, period and evidence.
  for (const supplied of Array.isArray(organization.annualMeetingCompletions) ? organization.annualMeetingCompletions : []) {
    if (!profile || !supplied || supplied.verified !== true || typeof supplied.evidenceRef !== 'string' || !supplied.evidenceRef.trim() ||
      !['held', 'written_annual_business', 'written_waiver'].includes(supplied.kind) || !parseComplianceDate(supplied.date) || supplied.date > today) continue;
    const start = organization.recognitionDate ?? organization.incorporationDate;
    if (parseComplianceDate(start) && supplied.date < start) continue;
    if (supplied.cycleYear !== undefined && (!Number.isInteger(supplied.cycleYear) || supplied.cycleYear < 1 || supplied.cycleYear > 9999)) continue;
    if (supplied.cycleYear !== undefined && supplied.cycleYear !== Number(supplied.date.slice(0, 4)) &&
      !(profile.id === 'bc_society' && extension && extension.cycleYear === supplied.cycleYear &&
        Number(supplied.date.slice(0, 4)) === supplied.cycleYear + 1 && supplied.date <= extension.dueDate)) continue;
    if (supplied.kind === 'written_waiver' && profile.id !== 'bc_company') continue;
    const annualReferenceDate = supplied.annualReferenceDate ?? organization.annualReferenceDate;
    if (profile.id === 'bc_company' && supplied.kind !== 'held' &&
      (!parseComplianceDate(annualReferenceDate) || annualReferenceDate > today || (parseComplianceDate(start) && annualReferenceDate < start))) continue;
    if (supplied.annualReferenceDate !== undefined && !parseComplianceDate(supplied.annualReferenceDate)) continue;
    completed.set(`${supplied.kind}:${supplied.date}`, {
      date: supplied.date, kind: supplied.kind, verified: true, evidenceRef: supplied.evidenceRef.trim(),
      ...(supplied.cycleYear !== undefined ? { cycleYear: supplied.cycleYear } : {}),
      ...(profile.id === 'bc_company' && annualReferenceDate ? { annualReferenceDate } : {}),
    });
  }
  return {
    ...organization,
    jurisdictionCode: organization.jurisdictionCode ?? undefined,
    entityType: organization.entityType ?? undefined,
    actFormedUnder: organization.actFormedUnder ?? undefined,
    kind: organization.kind ?? undefined,
    organizationKind: organization.organizationKind ?? undefined,
    annualMeetingDate: undefined,
    annualMeetingDates: undefined,
    annualMeetingCompletions: [...completed.values()].sort((a, b) => a.date.localeCompare(b.date)),
    heldAgmYears: facts.agmYears,
    annualMeetingExtension: extension,
    annualReturnFilings: annualReturnEvidence(organization, filings),
  };
}

/** Select the actual Ontario taxation period for a calendar-year view. A later
 * fiscal-calendar preference must not rewrite the period in a filing record. */
export function assessAnnualGovernanceReturnCycle(settings: ComplianceSettings, cycleYear: number, today: string): DeadlineAssessment {
  const profile = legalGovernanceProfile(settings);
  if (profile?.annualReturn.anchor !== 'fiscal_year_end') return assessAnnualReturnDeadline({ ...settings, annualReturnCycleYear: cycleYear }, today);
  const periods = [...new Set([
    settings.annualReturnPeriodEnd,
    ...(settings.annualReturnFilings ?? []).map(filing => filing.periodEnd),
  ].filter((period): period is string => Boolean(parseComplianceDate(period)) && Number(period!.slice(0, 4)) === cycleYear))].sort();
  if (periods.length > 1) return {
    status: 'review_required', dueDate: null, cycleYear, profileId: profile.id,
    sourceIds: profile.annualReturn.sourceIds,
    basis: 'More than one actual taxation period ends in the selected calendar year. Each period needs its own Ontario annual return assessment.',
    issues: [`Select and review the actual period: ${periods.join(', ')}. A single calendar-year filing marker cannot discharge multiple periods.`],
  };
  return assessAnnualReturnDeadline({
    ...settings,
    annualReturnCycleYear: cycleYear,
    annualReturnPeriodEnd: periods[0],
  }, today);
}
