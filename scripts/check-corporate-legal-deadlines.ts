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
// With no recorded annual business, a first-meeting deadline in an earlier year
// is unverified history, not the open deadline; a recent one stays open.
assert.equal(assessAnnualMeetingDeadline(bc, asOf).dueDate, '2026-12-31', 'BC: the current calendar-year limit, pending the unrecorded preceding meeting');
assert.equal(assessAnnualMeetingDeadline(bc, asOf).status, 'review_required');
assert.deepEqual(assessAnnualMeetingDeadline(bc, asOf).historyNotVerified?.cycleYears, [2021, 2022, 2023, 2024, 2025]);
assert.equal(assessAnnualMeetingDeadline({ ...bc, incorporationDate: '2025-02-01' }, asOf).dueDate, '2026-08-01', 'a missing first meeting in the current year stays open');
assert.equal(assessAnnualMeetingDeadline({ ...bc, incorporationDate: '2025-02-01' }, asOf).status, 'overdue');
assert.equal(assessAnnualMeetingDeadline({ ...bc, annualMeetingDate: '2027-01-01' }, asOf).dueDate, '2026-12-31', 'future meeting does not count');
assert.ok(assessAnnualMeetingDeadline({ ...bc, annualMeetingDate: '2027-01-01' }, asOf).historyNotVerified, 'future meeting is not evidence for the unverified history');
assert.equal(assessAnnualMeetingDeadline({ ...bc, annualMeetingAssessmentYear: 2021 }, asOf).dueDate, '2021-09-10', 'an explicitly selected cycle keeps the first-meeting rule');
assert.equal(assessAnnualMeetingDeadline({ ...bc, heldAgmYears: [2025] }, asOf).status, 'review_required', 'a year alone cannot prove a 15-month interval');
assert.equal(assessAnnualMeetingDeadline({ ...bc, actFormedUnder: 'custom_unreviewed_act' }, asOf).status, 'review_required');

// BC applies both calendar-year and 15-month constraints, using the annual reference date.
assert.equal(assessAnnualMeetingDeadline({ ...bc, annualMeetingDate: '2025-12-01' }, asOf).dueDate, '2026-12-31');
assert.equal(assessAnnualMeetingDeadline({ ...bc, annualMeetingDate: '2025-02-01' }, asOf).dueDate, '2026-05-01');
assert.equal(assessAnnualMeetingDeadline({ ...bc, annualMeetingDate: '2025-12-01', annualReferenceDate: '2025-03-01' }, asOf).dueDate, '2026-12-31', 'a stale profile reference date does not override a later held AGM');
assert.equal(assessAnnualMeetingDeadline({ ...bc, annualMeetingDate: '2025-02-01', annualReferenceDate: '2025-03-01' }, asOf).dueDate, '2026-06-01', 'a later annual reference date is used');
const waiver = { date: '2025-11-01', kind: 'written_waiver' as const, annualReferenceDate: '2025-10-01', verified: true, evidenceRef: 'signed-unanimous-waiver' };
assert.equal(assessAnnualMeetingDeadline({ ...bc, annualMeetingCompletions: [waiver] }, asOf).dueDate, '2026-12-31');
assert.equal(assessAnnualMeetingDeadline({ ...bc, annualMeetingCompletions: [{ ...waiver, verified: false }] }, asOf).dueDate, '2026-12-31');
assert.ok(assessAnnualMeetingDeadline({ ...bc, annualMeetingCompletions: [{ ...waiver, verified: false }] }, asOf).historyNotVerified, 'an unverified waiver is not evidence');
assert.equal(assessAnnualMeetingDeadline({ ...bc, annualMeetingCompletions: [{ ...waiver, annualReferenceDate: undefined }] }, asOf).status, 'review_required');

// Federal subsequent financial-year constraint; Ontario does not copy it.
assert.equal(assessAnnualMeetingDeadline({ ...fed, annualMeetingDate: '2025-08-01', fiscalYearEnd: '12-31' }, asOf).dueDate, '2026-06-30');
assert.equal(assessAnnualMeetingDeadline({ ...fed, annualMeetingDate: '2025-02-01', fiscalYearEnd: '12-31' }, asOf).dueDate, '2026-05-01');
assert.equal(assessAnnualMeetingDeadline({ ...fed, annualMeetingDate: '2026-06-30', fiscalYearEnd: '12-31' }, asOf).dueDate, '2027-06-30', 'do not reuse the financial year already dealt with');
assert.equal(assessAnnualMeetingDeadline({ ...fed, annualMeetingDate: '2025-08-01' }, asOf).status, 'review_required');
assert.equal(assessAnnualMeetingDeadline({ ...on, annualMeetingDate: '2025-08-01', fiscalYearEnd: '12-31' }, asOf).dueDate, '2026-11-01');
assert.equal(assessAnnualMeetingDeadline({ ...fed, annualMeetingCompletions: [waiver] }, asOf).status, 'review_required', 'a bare BC waiver is not a CBCA annual-business resolution');
assert.equal(assessAnnualMeetingDeadline({ ...fed, annualMeetingCompletions: [waiver] }, asOf).dueDate, null, 'CBCA needs the preceding meeting to calculate the deadline');
assert.ok(assessAnnualMeetingDeadline({ ...fed, annualMeetingCompletions: [waiver] }, asOf).historyNotVerified);

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
assert.equal(assessAnnualReturnDeadline(currentBC, asOf).status, 'overdue', 'more than seven days past an unreviewed boundary is overdue');
assert.equal(assessAnnualReturnDeadline(currentBC, '2026-05-15').status, 'review_required', 'within the calendar-adjustment margin the boundary still needs review');
assert.equal(assessAnnualReturnDeadline(currentBC, '2027-06-01').dueDate, '2026-05-10');
// Without filing evidence the open cycle is the current one; earlier cycles
// are unverified history rather than assumed complete or overdue.
assert.equal(assessAnnualReturnDeadline(bc, asOf).dueDate, '2027-05-10');
assert.deepEqual(assessAnnualReturnDeadline(bc, asOf).historyNotVerified?.cycleYears, [2021, 2022, 2023, 2024, 2025, 2026], 'unknown historical filings are not assumed complete');
assert.equal(assessAnnualReturnDeadline(bc, '2026-04-01').dueDate, '2026-05-10', 'an upcoming current-cycle deadline is not skipped');
assert.equal(assessAnnualReturnDeadline({ ...bc, lastAnnualReturnCycleYear: 2025, lastAnnualReturnFiledAt: '2025-04-01' }, asOf).dueDate, '2026-05-10', 'the open cycle follows the latest receipt');
assert.deepEqual(assessAnnualReturnDeadline({ ...bc, lastAnnualReturnCycleYear: 2025, lastAnnualReturnFiledAt: '2025-04-01' }, asOf).historyNotVerified?.cycleYears, [2021, 2022, 2023, 2024], 'the latest receipt proves its year only');
assert.deepEqual(assessAnnualReturnDeadline({ ...bc, lastAnnualReturnCycleYear: 2025, lastAnnualReturnFiledAt: '2024-04-01' }, asOf).historyNotVerified?.cycleYears.includes(2025), true, 'a pre-cycle filing cannot discharge it');
assert.equal(assessAnnualReturnDeadline({ ...fed, incorporationDate: '2025-02-01', annualReturnCycleYear: 2026 }, asOf).dueDate, '2026-04-02');
assert.equal(assessAnnualReturnDeadline({ ...fed, incorporationDate: '2026-02-01', annualReturnCycleYear: 2026 }, asOf).status, 'not_applicable');
const currentFiled = { cycleYear: 2026, filedAt: '2026-05-20', status: 'filed' as const, evidenceRef: 'receipt-2026' };
for (const evidence of [{ ...currentFiled, status: 'planned' as const }, { ...currentFiled, cycleYear: 2025 }, { ...currentFiled, filedAt: '2027-01-01' }]) {
  assert.equal(assessAnnualReturnDeadline({ ...currentBC, annualReturnFilings: [evidence] }, asOf).status, 'overdue', 'non-matching evidence leaves the cycle open past the calendar margin');
}
const filedAssessment = assessAnnualReturnDeadline({ ...currentBC, annualReturnFilings: [currentFiled] }, asOf);
assert.equal(filedAssessment.status, 'satisfied');
assert.equal(filedAssessment.late, undefined);
assert.equal(filedAssessment.timingReviewRequired, true, 'A filed return remains complete while timeliness requires calendar review');
assert.equal(nextAnnualReportDueDate({ ...currentBC, annualReturnFilings: [currentFiled] }, asOf), null);
assert.equal(assessAnnualReturnDeadline({ ...bc, annualReturnFilings: [{ cycleYear: 2021, filedAt: '2021-04-01', status: 'filed' }, { cycleYear: 2023, filedAt: '2023-04-01', status: 'filed' }] }, asOf).cycleYear, 2024, 'the open cycle follows the latest accepted cycle');
assert.deepEqual(assessAnnualReturnDeadline({ ...bc, annualReturnFilings: [{ cycleYear: 2021, filedAt: '2021-04-01', status: 'filed' }, { cycleYear: 2023, filedAt: '2023-04-01', status: 'filed' }] }, asOf).historyNotVerified?.cycleYears, [2022], 'a filing gap survives a later accepted cycle as unverified history');

// Ontario actual fiscal periods and month ends, separate from CRA filing evidence.
const fiscalON = { ...on, annualReturnPeriodEnd: '2025-09-30' };
assert.equal(assessAnnualReturnDeadline(fiscalON, asOf).dueDate, '2026-03-31');
assert.equal(assessAnnualReturnDeadline(fiscalON, '2027-10-11').dueDate, '2026-03-31');
assert.equal(assessAnnualReturnDeadline({ ...on, annualReturnPeriodEnd: '2026-02-28' }, asOf).dueDate, '2026-08-31');
assert.equal(assessAnnualReturnDeadline({ ...on, incorporationDate: undefined, fiscalYearEnd: '12-31' }, asOf).status, 'review_required');
assert.notEqual(assessAnnualReturnDeadline({ ...fiscalON, annualReturnFilings: [{ cycleYear: 2025, filedAt: '2026-01-01', status: 'filed' }] }, asOf).status, 'satisfied', 'a calendar label alone cannot identify a taxation period');
assert.equal(assessAnnualReturnDeadline({ ...fiscalON, annualReturnFilings: [{ periodEnd: '2025-09-30', filedAt: '2026-01-01', status: 'filed' }] }, asOf).status, 'satisfied');
assert.equal(assessAnnualReturnDeadline({ ...on, fiscalYearEnd: '09-30', lastAnnualReturnPeriodEnd: '2025-09-30', lastAnnualReturnFiledAt: '2026-01-01' }, asOf).dueDate, '2027-03-31', 'the open period follows the latest taxation-period receipt');
assert.deepEqual(assessAnnualReturnDeadline({ ...on, fiscalYearEnd: '09-30', lastAnnualReturnPeriodEnd: '2025-09-30', lastAnnualReturnFiledAt: '2026-01-01' }, asOf).historyNotVerified?.periodEnds, ['2020-09-30', '2021-09-30', '2022-09-30', '2023-09-30', '2024-09-30'], 'a latest taxation-period receipt cannot stand for earlier periods');

// Society held/no-AGM/extended cycles are different anchors; a plan cannot satisfy them.
assert.equal(assessAnnualReturnDeadline({ ...society, annualReturnCycleYear: 2025 }, asOf).dueDate, '2026-01-31');
assert.equal(assessAnnualReturnDeadline({ ...society, annualReturnCycleYear: 2025, agmMonth: 6, agmDay: 1 }, asOf).dueDate, '2026-01-31');
assert.equal(assessAnnualReturnDeadline({ ...society, annualReturnCycleYear: 2025, annualMeetingDate: '2025-06-01' }, asOf).dueDate, '2025-07-01');
assert.equal(assessAnnualReturnDeadline({ ...society, annualReturnCycleYear: 2025, annualMeetingExtension: extension }, asOf).dueDate, '2026-04-14');
assert.equal(assessAnnualReturnDeadline({ ...society, annualReturnCycleYear: 2025, annualMeetingCompletions: [postponed], annualMeetingExtension: extension }, asOf).dueDate, '2026-04-09');
assert.deepEqual(assessAnnualReturnDeadline({ ...society, incorporationDate: undefined, annualMeetingDates: ['2024-06-01', '2025-06-01'] }, asOf).historyNotVerified?.cycleYears, [2024, 2025], 'when recognition is unknown, a new meeting does not close the earlier known reports');
assert.deepEqual(assessAnnualReturnDeadline({ ...society, annualMeetingDates: ['2024-06-01', '2025-06-01'] }, asOf).historyNotVerified?.cycleYears, [2021, 2022, 2023, 2024, 2025], 'known recognition preserves earlier no-AGM report cycles as evidence gaps');
assert.equal(assessAnnualReturnDeadline({ ...society, annualMeetingDates: ['2024-06-01', '2025-06-01'] }, asOf).dueDate, '2027-01-31', 'without filing evidence the current cycle is open');
assert.equal(assessAnnualReturnDeadline({ ...society, annualMeetingDates: ['2025-12-15'] }, '2026-01-01').dueDate, '2026-01-14', 'an upcoming report for the preceding AGM is the current cycle');
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
  assert.equal(assessAnnualReturnDeadline(latest, asOf).cycleYear, 2026, 'the open cycle follows the latest receipt');
  assert.deepEqual(assessAnnualReturnDeadline(latest, asOf).historyNotVerified?.cycleYears, [2022, 2024], 'earlier gaps survive as unverified history');
  assert.equal(assessAnnualReturnDeadline({ ...latest, annualReturnCycleYear: 2022 }, asOf).status, 'overdue', 'an explicitly selected gap remains assessable');
  assert.equal(assessAnnualReturnDeadline({ ...latest, annualReturnCycleYear: 2025 }, asOf).status, 'satisfied', 'the exact last-filed year remains usable when selected');
  assert.equal(assessAnnualReturnDeadline({ ...latest, annualReturnCycleYear: 2026 }, asOf).cycleYear, 2026, 'an explicit later assessment remains available');
  assert.deepEqual(assessAnnualReturnDeadline({ ...latest, annualReturnFilings: latest.annualReturnFilings?.filter(f => f.status !== 'draft') }, asOf).historyNotVerified?.cycleYears, [2022, 2024], 'missing evidence is preserved even without a draft row');
}
const latestOntario: ComplianceSettings = { ...on, fiscalYearEnd: '12-31', lastAnnualReturnPeriodEnd: '2025-12-31', lastAnnualReturnFiledAt: '2026-06-01', annualReturnFilings: [
  { periodEnd: '2020-12-31', filedAt: '2021-06-01', status: 'filed' },
  { periodEnd: '2021-12-31', filedAt: '2022-06-01', status: 'filed' },
  { periodEnd: '2022-12-31', filedAt: '', status: 'draft' },
  { periodEnd: '2023-12-31', filedAt: '2024-06-01', status: 'filed' },
] };
assert.equal(assessAnnualReturnDeadline(latestOntario, asOf).anchorDate, '2026-12-31', 'the open period follows the latest filed period');
assert.deepEqual(assessAnnualReturnDeadline(latestOntario, asOf).historyNotVerified?.periodEnds, ['2022-12-31', '2024-12-31']);
assert.deepEqual(assessAnnualReturnDeadline({ ...latestOntario, annualReturnFilings: latestOntario.annualReturnFilings?.filter(f => f.status !== 'draft') }, asOf).historyNotVerified?.periodEnds, ['2022-12-31', '2024-12-31']);
assert.equal(assessAnnualReturnDeadline({ ...latestOntario, annualReturnPeriodEnd: '2022-12-31' }, asOf).status, 'overdue', 'an explicitly selected gap remains assessable');
assert.equal(assessAnnualReturnDeadline({ ...latestOntario, annualReturnPeriodEnd: '2025-12-31' }, asOf).status, 'satisfied');
assert.equal(assessAnnualReturnDeadline({ ...latestOntario, annualReturnCycleYear: 2025 }, asOf).status, 'satisfied');
assert.equal(assessAnnualReturnDeadline({ ...latestOntario, incorporationDate: undefined }, asOf).anchorDate, '2026-12-31', 'a filed period is a checkpoint even without recognition');
assert.equal(assessAnnualReturnDeadline({ ...on, incorporationDate: undefined, fiscalYearEnd: '12-31' }, asOf).dueDate, null, 'without recognition or a filed period, no Ontario cycle is invented');
assert.equal(assessAnnualReturnDeadline({ ...latestOntario, incorporationDate: undefined, annualReturnPeriodEnd: '2025-12-31' }, asOf).status, 'satisfied', 'an explicitly selected actual period is usable without inventing earlier history');
const latestSociety: ComplianceSettings = { ...society, annualMeetingDates: ['2023-06-01', '2025-06-01'], lastAnnualReturnCycleYear: 2025, lastAnnualReturnFiledAt: '2025-06-20', annualReturnFilings: [
  { cycleYear: 2021, filedAt: '2022-01-15', status: 'filed' },
  { cycleYear: 2022, filedAt: '', status: 'draft' },
  { cycleYear: 2023, filedAt: '2023-06-20', status: 'filed' },
] };
assert.equal(assessAnnualReturnDeadline(latestSociety, asOf).cycleYear, 2026);
assert.deepEqual(assessAnnualReturnDeadline(latestSociety, asOf).historyNotVerified?.cycleYears, [2022, 2024]);
assert.deepEqual(assessAnnualReturnDeadline({ ...latestSociety, annualReturnFilings: latestSociety.annualReturnFilings?.filter(f => f.status !== 'draft') }, asOf).historyNotVerified?.cycleYears, [2022, 2024]);
assert.equal(assessAnnualReturnDeadline({ ...latestSociety, annualReturnCycleYear: 2025 }, asOf).status, 'satisfied');
assert.equal(assessAnnualReturnDeadline({ ...latestSociety, annualReturnCycleYear: 2026 }, asOf).cycleYear, 2026);

// BC transparency register (BCA Part 4.1, ss. 119.3, 119.31, 119.41): BC
// companies only, anchored on the recognition anniversary and recorded changes.
{
  const transparencyKeys = (s: ComplianceSettings) => deriveComplianceDeadlines(s, asOf).filter(d => d.category === 'transparency');
  const review = transparencyKeys(currentBC).find(d => d.key === 'transparency-review');
  assert.equal(review?.dueDate, '2027-05-10', 'the 2026 window (Mar 10 to May 10) has passed; the 2027 window ends two months after the anniversary');
  assert.deepEqual(review?.sourceIds, ['BC-BCA-TRANSPARENCY']);
  const changed = transparencyKeys({ ...currentBC, transparencyEvents: [{ id: 'c1', individualName: 'Synthetic Holder', stepKind: 'became_significant', awareOn: '2026-10-01', recordedOn: '2026-10-05' }] });
  assert.equal(changed.find(d => d.key === 'transparency-notice:c1')?.dueDate, '2026-10-15', 'notify within 10 days of the entry');
  const pending = transparencyKeys({ ...currentBC, transparencyEvents: [{ id: 'c2', individualName: 'Synthetic Holder', stepKind: 'change', awareOn: '2026-10-01' }] });
  assert.equal(pending.find(d => d.key === 'transparency-update:c2')?.dueDate, '2026-10-31', 'record within 30 days of awareness');
  for (const other of [fed, on, society]) assert.deepEqual(transparencyKeys({ ...other, transparencyEvents: [{ id: 'c2', individualName: 'X', stepKind: 'change', awareOn: '2026-10-01' }] }), [], 'no BC transparency deadlines outside BC companies');
  const source = CORPORATE_LEGAL_SOURCES.find(s => s.id === 'BC-BCA-TRANSPARENCY')!;
  assert.ok(/30 days of awareness/.test(source.summary) && /ten days/.test(source.summary), 'verified 30-day update and 10-day notice periods');
}

// Every corporate profile requirement has a resolvable official source.
const ids = new Set(CORPORATE_LEGAL_SOURCES.map(s => s.id));
assert.equal(ids.size, CORPORATE_LEGAL_SOURCES.length, 'unique corporate source IDs');
for (const p of CORPORATE_LEGAL_PROFILES) {
  for (const id of [...p.directors.sourceIds, ...p.directors.consentSourceIds, ...p.annualMeeting.sourceIds, ...p.annualReturn.sourceIds, ...p.meetings.noticeSourceIds, ...p.meetings.quorumSourceIds, ...p.resolutions.sourceIds, ...p.records.flatMap(r => r.sourceIds)]) assert.ok(ids.has(id), `${p.id}: ${id}`);
}
assert.equal(CORPORATE_LEGAL_PROFILES.find(p => p.id === 'ontario_obca')?.resolutions.ordinaryWrittenDenominatorBasis, 'shares');
console.log('Corporate legal deadline and source checks passed');
