import assert from 'node:assert/strict';
import {
  addCalendarMonths, addComplianceDays, addFiscalFilingMonths, assessAnnualMeetingDeadline,
  assessAnnualReturnDeadline, deriveComplianceDeadlines, nextAnnualReportDueDate,
  nextFiscalYearEnd, parseComplianceDate, type ComplianceSettings,
} from '../shared/corporationSettings';
import { CORPORATE_LEGAL_PROFILES } from '../shared/corporateLegalProfiles';
import { CORPORATE_LEGAL_SOURCES } from '../shared/corporateLegalSources';
import { directorGovernanceRule } from '../shared/directorRules';

const bc: ComplianceSettings = { entityType: 'corporation__business_', jurisdictionCode: 'CA-BC', incorporationDate: '2020-03-10' };
const fed: ComplianceSettings = { ...bc, jurisdictionCode: 'CA-FED-CBCA' };
const on: ComplianceSettings = { ...bc, jurisdictionCode: 'CA-ON-OBCA' };
const society: ComplianceSettings = { entityType: 'society', jurisdictionCode: 'CA-BC', incorporationDate: '2020-03-10' };
const asOf = '2026-10-11';

// The legacy director wrapper draws from the same Act data as the full profile.
assert.equal(directorGovernanceRule('CA-BC', 'corporation').minimumActiveDirectors, 1);
assert.equal(directorGovernanceRule('CA-FED-CBCA', 'corporation').residentDirectorRule, 'canadian_25_percent');
assert.equal(directorGovernanceRule('CA-ON-OBCA', 'corporation', { ...on, distributing: true }).minimumActiveDirectors, 3);
assert.equal(directorGovernanceRule('CA-BC', 'society', { ...society, isMemberFunded: true }).minimumActiveDirectors, 1);
assert.equal(directorGovernanceRule('CA-BC', 'society', { ...society, isMemberFunded: true }).requiresResidentDirector, false);
assert.equal(directorGovernanceRule('CA-BC', 'corporation', { ...bc, actFormedUnder: 'unreviewed_private_act' }).minimumActiveDirectors, undefined);

// Date validity and distinct statutory month conventions.
for (const bad of ['2026-02-29', '2026-04-31', '2026-01-00', '2026-13-01', '2026-01-01junk', '2026-01-01T00:00:00Z', '0000-01-01']) assert.equal(parseComplianceDate(bad), null, bad);
assert.ok(parseComplianceDate('2024-02-29'));
assert.equal(addCalendarMonths('2026-06-30', 2), '2026-08-30', 'anniversaries do not inherit the tax month-end rule');
assert.equal(addCalendarMonths('2026-08-31', -2), '2026-06-30', 'notice range is measured back from the meeting');
assert.equal(addFiscalFilingMonths('2026-02-28', 6), '2026-08-31');
assert.equal(addFiscalFilingMonths('2026-06-30', 6), '2026-12-31');
assert.equal(addFiscalFilingMonths('2025-09-30', 6), '2026-03-31');
assert.equal(addFiscalFilingMonths('2026-09-23', 6), '2027-03-23');
assert.equal(addFiscalFilingMonths('2026-02-29', 6), null);
assert.equal(addComplianceDays('2024-02-28', 2), '2024-03-01');
assert.equal(nextFiscalYearEnd({ fiscalYearEnd: '04-31' }, asOf), null);
assert.equal(nextFiscalYearEnd({ fiscalYearEnd: '02-29' }, '2026-01-01'), '2026-02-28');

// First meetings are statutory dates, not planned month/day occurrences.
for (const entity of [bc, fed, on]) {
  const result = assessAnnualMeetingDeadline({ ...entity, incorporationDate: '2025-08-31', agmMonth: 6, agmDay: 15, fiscalYearEnd: '12-31' }, asOf);
  assert.equal(result.dueDate, '2027-02-28');
  assert.equal(result.status, 'upcoming');
}
assert.equal(assessAnnualMeetingDeadline(bc, asOf).dueDate, '2021-09-10', 'missing first meeting stays overdue');
assert.equal(assessAnnualMeetingDeadline({ ...bc, annualMeetingDate: '2027-01-01' }, asOf).dueDate, '2021-09-10', 'future meeting does not count');
assert.equal(assessAnnualMeetingDeadline({ ...bc, heldAgmYears: [2025] }, asOf).status, 'review_required', 'a year alone cannot prove a 15-month interval');
assert.equal(assessAnnualMeetingDeadline({ ...bc, actFormedUnder: 'custom_unreviewed_act' }, asOf).status, 'review_required');

// BC applies both calendar-year and 15-month constraints, using the annual reference date.
assert.equal(assessAnnualMeetingDeadline({ ...bc, annualMeetingDate: '2025-12-01' }, asOf).dueDate, '2026-12-31');
assert.equal(assessAnnualMeetingDeadline({ ...bc, annualMeetingDate: '2025-02-01' }, asOf).dueDate, '2026-05-01');
assert.equal(assessAnnualMeetingDeadline({ ...bc, annualMeetingDate: '2025-12-01', annualReferenceDate: '2025-03-01' }, asOf).dueDate, '2026-06-01');
const waiver = { date: '2025-11-01', kind: 'written_waiver' as const, annualReferenceDate: '2025-10-01', verified: true, evidenceRef: 'signed-unanimous-waiver' };
assert.equal(assessAnnualMeetingDeadline({ ...bc, annualMeetingCompletions: [waiver] }, asOf).dueDate, '2026-12-31');
assert.equal(assessAnnualMeetingDeadline({ ...bc, annualMeetingCompletions: [{ ...waiver, verified: false }] }, asOf).dueDate, '2021-09-10');
assert.equal(assessAnnualMeetingDeadline({ ...bc, annualMeetingCompletions: [{ ...waiver, annualReferenceDate: undefined }] }, asOf).status, 'review_required');

// Federal subsequent financial-year constraint; Ontario does not copy it.
assert.equal(assessAnnualMeetingDeadline({ ...fed, annualMeetingDate: '2025-08-01', fiscalYearEnd: '12-31' }, asOf).dueDate, '2026-06-30');
assert.equal(assessAnnualMeetingDeadline({ ...fed, annualMeetingDate: '2025-02-01', fiscalYearEnd: '12-31' }, asOf).dueDate, '2026-05-01');
assert.equal(assessAnnualMeetingDeadline({ ...fed, annualMeetingDate: '2026-06-30', fiscalYearEnd: '12-31' }, asOf).dueDate, '2027-06-30', 'do not reuse the financial year already dealt with');
assert.equal(assessAnnualMeetingDeadline({ ...fed, annualMeetingDate: '2025-08-01' }, asOf).status, 'review_required');
assert.equal(assessAnnualMeetingDeadline({ ...on, annualMeetingDate: '2025-08-01', fiscalYearEnd: '12-31' }, asOf).dueDate, '2026-11-01');
assert.equal(assessAnnualMeetingDeadline({ ...fed, annualMeetingCompletions: [waiver] }, asOf).dueDate, '2021-09-10', 'a bare BC waiver is not a CBCA annual-business resolution');

// Society incorporation year, actual/deemed completion, missed calendar cycles and extensions.
assert.equal(assessAnnualMeetingDeadline({ ...society, incorporationDate: '2026-01-01' }, asOf).dueDate, '2027-12-31');
assert.equal(assessAnnualMeetingDeadline({ ...society, incorporationDate: '2026-01-01', annualMeetingAssessmentYear: 2026 }, asOf).status, 'not_applicable');
assert.equal(assessAnnualMeetingDeadline({ ...society, annualMeetingDate: '2024-06-01' }, asOf).dueDate, '2025-12-31', 'an uncompleted calendar year is not silently skipped');
const extension = { cycleYear: 2025, dueDate: '2026-03-15', authority: 'registrar' as const, evidenceRef: 'registrar-order' };
assert.equal(assessAnnualMeetingDeadline({ ...society, annualMeetingDate: '2024-06-01', annualMeetingExtension: extension }, asOf).dueDate, '2026-03-15');
assert.equal(assessAnnualMeetingDeadline({ ...society, annualMeetingDate: '2024-06-01', annualMeetingExtension: { ...extension, evidenceRef: '' } }, asOf).status, 'review_required');
const postponed = { date: '2026-03-10', kind: 'held' as const, cycleYear: 2025, verified: true, evidenceRef: 'registrar-order-and-minutes' };
assert.equal(assessAnnualMeetingDeadline({ ...society, annualMeetingCompletions: [postponed] }, asOf).dueDate, '2026-12-31');
assert.equal(assessAnnualMeetingDeadline({ ...society, annualMeetingCompletions: [postponed], annualMeetingAssessmentYear: 2025 }, asOf).status, 'satisfied');

// Anniversary cycles remain open throughout the filing window and after it.
const currentBC = { ...bc, annualReturnCycleYear: 2026 };
assert.equal(assessAnnualReturnDeadline(currentBC, '2026-04-01').dueDate, '2026-05-10');
assert.equal(assessAnnualReturnDeadline(currentBC, asOf).dueDate, '2026-05-10');
assert.equal(assessAnnualReturnDeadline(currentBC, asOf).status, 'review_required');
assert.equal(assessAnnualReturnDeadline(currentBC, '2027-06-01').dueDate, '2026-05-10');
assert.equal(assessAnnualReturnDeadline(bc, asOf).dueDate, '2021-05-10', 'unknown historical filings are not assumed complete');
assert.equal(assessAnnualReturnDeadline({ ...bc, lastAnnualReturnCycleYear: 2025, lastAnnualReturnFiledAt: '2025-04-01' }, asOf).dueDate, '2021-05-10', 'the latest receipt proves its year only');
assert.equal(assessAnnualReturnDeadline({ ...bc, lastAnnualReturnCycleYear: 2025, lastAnnualReturnFiledAt: '2024-04-01' }, asOf).dueDate, '2021-05-10', 'a pre-cycle filing cannot discharge it');
assert.equal(assessAnnualReturnDeadline({ ...fed, incorporationDate: '2025-02-01', annualReturnCycleYear: 2026 }, asOf).dueDate, '2026-04-02');
assert.equal(assessAnnualReturnDeadline({ ...fed, incorporationDate: '2026-02-01', annualReturnCycleYear: 2026 }, asOf).status, 'not_applicable');
const currentFiled = { cycleYear: 2026, filedAt: '2026-05-20', status: 'filed' as const, evidenceRef: 'receipt-2026' };
for (const evidence of [{ ...currentFiled, status: 'planned' as const }, { ...currentFiled, cycleYear: 2025 }, { ...currentFiled, filedAt: '2027-01-01' }]) {
  assert.equal(assessAnnualReturnDeadline({ ...currentBC, annualReturnFilings: [evidence] }, asOf).status, 'review_required');
}
const filedAssessment = assessAnnualReturnDeadline({ ...currentBC, annualReturnFilings: [currentFiled] }, asOf);
assert.equal(filedAssessment.status, 'satisfied');
assert.equal(filedAssessment.late, undefined);
assert.equal(filedAssessment.timingReviewRequired, true, 'A filed return remains complete while timeliness requires calendar review');
assert.equal(nextAnnualReportDueDate({ ...currentBC, annualReturnFilings: [currentFiled] }, asOf), null);
assert.equal(assessAnnualReturnDeadline({ ...bc, annualReturnFilings: [{ cycleYear: 2021, filedAt: '2021-04-01', status: 'filed' }, { cycleYear: 2023, filedAt: '2023-04-01', status: 'filed' }] }, asOf).cycleYear, 2022, 'a filing gap survives a later accepted cycle');

// Ontario actual fiscal periods and month ends, separate from CRA filing evidence.
const fiscalON = { ...on, annualReturnPeriodEnd: '2025-09-30' };
assert.equal(assessAnnualReturnDeadline(fiscalON, asOf).dueDate, '2026-03-31');
assert.equal(assessAnnualReturnDeadline(fiscalON, '2027-10-11').dueDate, '2026-03-31');
assert.equal(assessAnnualReturnDeadline({ ...on, annualReturnPeriodEnd: '2026-02-28' }, asOf).dueDate, '2026-08-31');
assert.equal(assessAnnualReturnDeadline({ ...on, incorporationDate: undefined, fiscalYearEnd: '12-31' }, asOf).status, 'review_required');
assert.equal(assessAnnualReturnDeadline({ ...fiscalON, annualReturnFilings: [{ cycleYear: 2025, filedAt: '2026-01-01', status: 'filed' }] }, asOf).status, 'review_required', 'a calendar label alone cannot identify a taxation period');
assert.equal(assessAnnualReturnDeadline({ ...fiscalON, annualReturnFilings: [{ periodEnd: '2025-09-30', filedAt: '2026-01-01', status: 'filed' }] }, asOf).status, 'satisfied');
assert.equal(assessAnnualReturnDeadline({ ...on, fiscalYearEnd: '09-30', lastAnnualReturnPeriodEnd: '2025-09-30', lastAnnualReturnFiledAt: '2026-01-01' }, asOf).dueDate, '2021-03-31', 'a latest taxation-period receipt cannot stand for earlier periods');

// Society held/no-AGM/extended cycles are different anchors; a plan cannot satisfy them.
assert.equal(assessAnnualReturnDeadline({ ...society, annualReturnCycleYear: 2025 }, asOf).dueDate, '2026-01-31');
assert.equal(assessAnnualReturnDeadline({ ...society, annualReturnCycleYear: 2025, agmMonth: 6, agmDay: 1 }, asOf).dueDate, '2026-01-31');
assert.equal(assessAnnualReturnDeadline({ ...society, annualReturnCycleYear: 2025, annualMeetingDate: '2025-06-01' }, asOf).dueDate, '2025-07-01');
assert.equal(assessAnnualReturnDeadline({ ...society, annualReturnCycleYear: 2025, annualMeetingExtension: extension }, asOf).dueDate, '2026-04-14');
assert.equal(assessAnnualReturnDeadline({ ...society, annualReturnCycleYear: 2025, annualMeetingCompletions: [postponed], annualMeetingExtension: extension }, asOf).dueDate, '2026-04-09');
assert.equal(assessAnnualReturnDeadline({ ...society, incorporationDate: undefined, annualMeetingDates: ['2024-06-01', '2025-06-01'] }, asOf).dueDate, '2024-07-01', 'when recognition is unknown, a new meeting does not close the oldest known report');
assert.equal(assessAnnualReturnDeadline({ ...society, annualMeetingDates: ['2024-06-01', '2025-06-01'] }, asOf).dueDate, '2022-01-31', 'known recognition preserves earlier no-AGM report cycles as evidence gaps');
assert.equal(assessAnnualReturnDeadline({ ...society, annualReturnCycleYear: 2025, heldAgmYears: [2025] }, asOf).status, 'review_required');
const derived = deriveComplianceDeadlines({ ...currentBC, annualMeetingDate: '2025-12-01', agmMonth: 6, agmDay: 15, waivePrepFinancials: true }, asOf);
assert.equal(derived.find(d => d.key === 'agm')?.dueDate, '2026-12-31');
assert.equal(derived.find(d => d.key === 'agm')?.plannedDate, '2026-06-15');
assert.equal(derived.find(d => d.key === 'annual-report')?.dueDate, '2026-05-10', 'financial waiver does not remove an overdue filing');
assert.equal(deriveComplianceDeadlines(currentBC, '2026-02-30').length, 0);

// Convenience last-filed fields are exact-cycle evidence, never a history
// checkpoint. Later receipts cannot skip an older explicit draft or gap.
for (const organization of [bc, fed]) {
  const latest: ComplianceSettings = { ...organization, lastAnnualReturnCycleYear: 2025, lastAnnualReturnFiledAt: '2025-04-01', annualReturnFilings: [
    { cycleYear: 2021, filedAt: '2021-04-01', status: 'filed' },
    { cycleYear: 2022, filedAt: '', status: 'draft' },
    { cycleYear: 2023, filedAt: '2023-04-01', status: 'filed' },
  ] };
  assert.equal(assessAnnualReturnDeadline(latest, asOf).cycleYear, 2022);
  assert.equal(assessAnnualReturnDeadline({ ...latest, annualReturnCycleYear: 2025 }, asOf).status, 'satisfied', 'the exact last-filed year remains usable when selected');
  assert.equal(assessAnnualReturnDeadline({ ...latest, annualReturnCycleYear: 2026 }, asOf).cycleYear, 2026, 'an explicit later assessment remains available');
  assert.equal(assessAnnualReturnDeadline({ ...latest, annualReturnFilings: latest.annualReturnFilings?.filter(f => f.status !== 'draft') }, asOf).cycleYear, 2022, 'missing evidence is preserved even without a draft row');
}
const latestOntario: ComplianceSettings = { ...on, fiscalYearEnd: '12-31', lastAnnualReturnPeriodEnd: '2025-12-31', lastAnnualReturnFiledAt: '2026-06-01', annualReturnFilings: [
  { periodEnd: '2020-12-31', filedAt: '2021-06-01', status: 'filed' },
  { periodEnd: '2021-12-31', filedAt: '2022-06-01', status: 'filed' },
  { periodEnd: '2022-12-31', filedAt: '', status: 'draft' },
  { periodEnd: '2023-12-31', filedAt: '2024-06-01', status: 'filed' },
] };
assert.equal(assessAnnualReturnDeadline(latestOntario, asOf).anchorDate, '2022-12-31');
assert.equal(assessAnnualReturnDeadline({ ...latestOntario, annualReturnFilings: latestOntario.annualReturnFilings?.filter(f => f.status !== 'draft') }, asOf).anchorDate, '2022-12-31');
assert.equal(assessAnnualReturnDeadline({ ...latestOntario, annualReturnPeriodEnd: '2025-12-31' }, asOf).status, 'satisfied');
assert.equal(assessAnnualReturnDeadline({ ...latestOntario, annualReturnCycleYear: 2025 }, asOf).status, 'satisfied');
assert.equal(assessAnnualReturnDeadline({ ...latestOntario, incorporationDate: undefined }, asOf).dueDate, null, 'a last-filed period cannot establish the earliest Ontario cycle without recognition or explicit selection');
assert.equal(assessAnnualReturnDeadline({ ...latestOntario, incorporationDate: undefined }, asOf).status, 'review_required');
assert.equal(assessAnnualReturnDeadline({ ...latestOntario, incorporationDate: undefined, annualReturnPeriodEnd: '2025-12-31' }, asOf).status, 'satisfied', 'an explicitly selected actual period is usable without inventing earlier history');
const latestSociety: ComplianceSettings = { ...society, annualMeetingDates: ['2023-06-01', '2025-06-01'], lastAnnualReturnCycleYear: 2025, lastAnnualReturnFiledAt: '2025-06-20', annualReturnFilings: [
  { cycleYear: 2021, filedAt: '2022-01-15', status: 'filed' },
  { cycleYear: 2022, filedAt: '', status: 'draft' },
  { cycleYear: 2023, filedAt: '2023-06-20', status: 'filed' },
] };
assert.equal(assessAnnualReturnDeadline(latestSociety, asOf).cycleYear, 2022);
assert.equal(assessAnnualReturnDeadline({ ...latestSociety, annualReturnFilings: latestSociety.annualReturnFilings?.filter(f => f.status !== 'draft') }, asOf).cycleYear, 2022);
assert.equal(assessAnnualReturnDeadline({ ...latestSociety, annualReturnCycleYear: 2025 }, asOf).status, 'satisfied');
assert.equal(assessAnnualReturnDeadline({ ...latestSociety, annualReturnCycleYear: 2026 }, asOf).cycleYear, 2026);

// Every corporate profile requirement has a resolvable official source.
const ids = new Set(CORPORATE_LEGAL_SOURCES.map(s => s.id));
assert.equal(ids.size, CORPORATE_LEGAL_SOURCES.length, 'unique corporate source IDs');
for (const p of CORPORATE_LEGAL_PROFILES) {
  for (const id of [...p.directors.sourceIds, ...p.directors.consentSourceIds, ...p.annualMeeting.sourceIds, ...p.annualReturn.sourceIds, ...p.meetings.noticeSourceIds, ...p.meetings.quorumSourceIds, ...p.resolutions.sourceIds, ...p.records.flatMap(r => r.sourceIds)]) assert.ok(ids.has(id), `${p.id}: ${id}`);
}
assert.equal(CORPORATE_LEGAL_PROFILES.find(p => p.id === 'ontario_obca')?.resolutions.ordinaryWrittenDenominatorBasis, 'shares');
console.log('Corporate legal deadline and source checks passed');
