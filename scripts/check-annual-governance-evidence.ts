import assert from 'node:assert/strict';
import { annualGovernanceSettings, annualReturnEvidence, assessAnnualGovernanceReturnCycle } from '../shared/annualGovernanceEvidence';
import { assessAnnualMeetingDeadline, assessAnnualReturnDeadline } from '../shared/corporationSettings';
import { summaryPortable } from '../shared/functions/annualCycle';
import { MemoryDb, PortableRuntime, definePortableQuery, makeCapabilities } from '../shared/portable/index';
import { portableTestPrincipal, portableTestSeed } from './portable-test-fixture';

const today = '2026-10-11';
const bc = { entityType: 'corporation__business_', actFormedUnder: 'business_corporations_act', jurisdictionCode: 'CA-BC', incorporationDate: '2020-03-10', fiscalYearEnd: '12-31' };
const fed = { ...bc, jurisdictionCode: 'CA-FED-CBCA', actFormedUnder: 'canada_business_corporations_act' };
const on = { ...bc, jurisdictionCode: 'CA-ON-OBCA', actFormedUnder: 'business_corporations_act__ontario_' };
const society = { ...bc, entityType: 'society', actFormedUnder: 'societies_act' };
const held = { _id: 'held', type: 'AGM', status: 'Held', scheduledAt: '2025-06-01T18:00:00Z', title: 'Annual meeting' };
const unreliable = [
  { ...held, _id: 'stale-plan', status: 'Scheduled', scheduledAt: '2024-06-01' },
  { ...held, _id: 'unknown', status: undefined, scheduledAt: '2023-06-01' },
  { ...held, _id: 'invalid', scheduledAt: '2025-02-30' },
  { ...held, _id: 'board', type: 'Board', scheduledAt: '2025-05-01' },
  { ...held, _id: 'cancelled', status: 'Cancelled', heldAt: '2024-05-01' },
  { ...held, _id: 'future', scheduledAt: '2027-05-01' },
];
const recorded = annualGovernanceSettings(bc, [held, ...unreliable], [], today);
assert.deepEqual(recorded.annualMeetingCompletions?.map(m => m.date), ['2025-06-01']);
assert.equal(recorded.annualMeetingDate, undefined, 'the adapter uses one completion channel');
assert.equal(assessAnnualMeetingDeadline(recorded, today).dueDate, '2026-09-01');
assert.equal(assessAnnualMeetingDeadline(annualGovernanceSettings(bc, unreliable, [], today), today).dueDate, '2021-09-10', 'past planning does not advance the first annual deadline');
assert.deepEqual(annualGovernanceSettings({ jurisdictionCode: null, entityType: null }, [], [], today).annualMeetingCompletions, []);

// Imported annual-business evidence is a distinct reviewed input. A carried
// generic resolution or a planned date cannot manufacture that evidence.
const written = { kind: 'written_annual_business', date: '2025-06-01', annualReferenceDate: '2025-06-01', verified: true, evidenceRef: 'reviewed-annual-instrument-2025' };
const reviewedWritten = annualGovernanceSettings({ ...bc, annualMeetingCompletions: [written] }, [], [], today);
assert.deepEqual(reviewedWritten.annualMeetingCompletions, [written]);
assert.deepEqual(reviewedWritten.heldAgmYears, [], 'written business does not become a physically held meeting');
assert.equal(assessAnnualMeetingDeadline(reviewedWritten, today).dueDate, '2026-09-01');
for (const completion of [
  { ...written, verified: false }, { ...written, verified: undefined },
  { ...written, evidenceRef: ' ' }, { ...written, evidenceRef: undefined },
  { ...written, date: '2025-02-30' }, { ...written, date: '2027-01-01' },
  { ...written, date: '2019-01-01' }, { ...written, kind: undefined, status: 'Carried' },
  { ...written, annualReferenceDate: undefined }, { ...written, annualReferenceDate: '2025-02-30' },
  { ...written, cycleYear: 2024 }, { ...written, cycleYear: 2025.5 },
]) assert.deepEqual(annualGovernanceSettings({ ...bc, annualMeetingCompletions: [completion] }, [], [], today).annualMeetingCompletions, []);
assert.deepEqual(annualGovernanceSettings({ ...bc, actFormedUnder: 'bespoke_act', annualMeetingCompletions: [written] }, [], [], today).annualMeetingCompletions, []);
for (const organization of [fed, on]) {
  const supplied = { ...written, annualReferenceDate: undefined };
  const settings = annualGovernanceSettings({ ...organization, annualMeetingCompletions: [supplied] }, [], [], today);
  assert.equal(settings.annualMeetingCompletions?.length, 1, 'reviewed annual business survives the adapter');
  assert.deepEqual(annualGovernanceSettings({ ...organization, annualMeetingCompletions: [{ ...supplied, kind: 'written_waiver' }] }, [], [], today).annualMeetingCompletions, [], 'bare meeting waiver is not an annual-business completion in these Acts');
}
const suppliedHeld = { kind: 'held', date: '2025-06-01', verified: true, evidenceRef: 'verified-held-minutes' };
assert.equal(annualGovernanceSettings({ ...bc, annualMeetingCompletions: [suppliedHeld] }, [held], [], today).annualMeetingCompletions?.length, 1, 'duplicate held evidence is deduplicated');
assert.equal(annualGovernanceSettings({ ...bc, annualMeetingCompletions: [suppliedHeld] }, [held], [], today).annualMeetingCompletions?.[0].evidenceRef, 'verified-held-minutes');

const bcFilings = [
  { _id: 'bc-2021', kind: 'BCCompanyAnnualReport', reportingYear: 2021, status: 'Filed', filedAt: '2021-04-01' },
  { _id: 'bc-2023', kind: 'BCCompanyAnnualReport', reportingYear: 2023, status: 'Filed', filedAt: '2023-04-01' },
  { _id: 'wrong-kind', kind: 'FederalAnnualReturn', reportingYear: 2022, status: 'Filed', filedAt: '2022-04-01' },
  { _id: 'ambiguous', kind: 'BCCompanyAnnualReport', periodLabel: 'FY2021-2022', status: 'Filed', filedAt: '2022-04-01' },
  { _id: 'date-only', kind: 'BCCompanyAnnualReport', status: 'Filed', filedAt: '2022-04-01' },
];
const bcSettings = annualGovernanceSettings(bc, [held], bcFilings, today);
assert.equal(annualReturnEvidence(bc, bcFilings).length, 4, 'a foreign filing kind never satisfies the home return');
const homeReturn = { kind: 'BCCompanyAnnualReport', reportingYear: 2022, status: 'Filed', filedAt: '2022-04-01' };
for (const extra of [
  { contextKind: 'extra_provincial' }, { contextKind: 'branch' },
  { contextKind: 'home', jurisdictionCode: 'CA-ON-OBCA' }, { jurisdictionCode: 'CA-FED-CBCA' },
  { jurisdictionCode: 'unknown' }, { jurisdictionCode: 'unreviewed_jurisdiction' },
]) assert.deepEqual(annualReturnEvidence(bc, [{ ...homeReturn, ...extra }]), [], 'a contradictory or unreviewed filing context is not home evidence');
for (const extra of [{}, { contextKind: 'home' }, { jurisdictionCode: 'CA-BC' }, { jurisdictionCode: 'bc' }, { jurisdictionCode: 'british_columbia' }]) {
  assert.equal(annualReturnEvidence(bc, [{ ...homeReturn, ...extra }]).length, 1, 'legacy home context and known home aliases remain usable');
}
for (const [organization, kind, jurisdictionCode] of [[on, 'OntarioAnnualReturn', 'CA-ON'], [on, 'OntarioAnnualReturn', 'ontario'], [fed, 'FederalAnnualReturn', 'CA-FED'], [fed, 'FederalAnnualReturn', 'federal']] as const) {
  assert.equal(annualReturnEvidence(organization, [{ ...homeReturn, kind, jurisdictionCode }]).length, 1);
}
assert.equal(assessAnnualReturnDeadline(bcSettings, today).cycleYear, 2022, 'a later filed cycle leaves the older gap open');
assert.equal(assessAnnualReturnDeadline(bcSettings, today).dueDate, '2022-05-10');
assert.equal(assessAnnualGovernanceReturnCycle(bcSettings, 2021, today).status, 'satisfied');
assert.equal(assessAnnualGovernanceReturnCycle(bcSettings, 2022, today).status, 'review_required', 'an unfiled old cycle remains open while its legal holiday boundary is unreviewed');
assert.equal(assessAnnualGovernanceReturnCycle(bcSettings, 2022, today).timingReviewRequired, true);
const bcReturnCalendar = { profileId: 'bc_company', obligation: 'annual_return' as const, cycleYear: 2022, nominalDueDate: '2022-05-10', reviewedDueDate: '2022-05-10', reviewedOn: today, verified: true, evidenceRef: 'fixture-calendar-review', calendarBasis: 'Fixture reviewer confirmed the date, locality and registry filing channel.' };
assert.equal(assessAnnualGovernanceReturnCycle(annualGovernanceSettings({ ...bc, annualDeadlineCalendarReviews: [bcReturnCalendar] }, [held], bcFilings, today), 2022, today).status, 'overdue', 'a matching evidenced calendar permits a conclusive late-boundary classification');
assert.equal(assessAnnualGovernanceReturnCycle(annualGovernanceSettings(fed, [held], [], today), 2022, today).dueDate, '2022-05-09', 'CBCA uses 60 days from anniversary, independently of the held meeting');

const ontarioFilings = [
  { _id: 'on-period', kind: 'OntarioAnnualReturn', reportingPeriodEnd: '2025-04-30', reportingYear: 2025, status: 'Filed', filedAt: '2025-10-20' },
  { _id: 'cra', kind: 'T2', reportingPeriodEnd: '2024-12-31', status: 'Filed', filedAt: '2025-06-01' },
];
const onSettings = annualGovernanceSettings(on, [held], ontarioFilings, today);
assert.equal(assessAnnualGovernanceReturnCycle(onSettings, 2025, today).dueDate, '2025-10-31', 'actual period overrides the current recurring fiscal preference');
assert.equal(assessAnnualGovernanceReturnCycle(onSettings, 2025, today).status, 'satisfied');
assert.equal(assessAnnualGovernanceReturnCycle(onSettings, 2024, today).status, 'review_required', 'the CRA tax filing is not an Ontario registry receipt and the old open boundary requires calendar review');
assert.equal(assessAnnualGovernanceReturnCycle(onSettings, 2024, today).dueDate, '2025-06-30');
assert.equal(assessAnnualGovernanceReturnCycle({ ...onSettings, lastAnnualReturnPeriodEnd: '2025-04-30', lastAnnualReturnFiledAt: '2025-10-20' }, 2024, today).dueDate, '2025-06-30', 'a latest-filed checkpoint cannot rewrite an explicitly selected historical year');
const twoPeriods = annualGovernanceSettings(on, [], [...ontarioFilings, { _id: 'second-period', kind: 'OntarioAnnualReturn', reportingPeriodEnd: '2025-12-31', status: 'Draft' }], today);
assert.equal(assessAnnualGovernanceReturnCycle(twoPeriods, 2025, today).status, 'review_required', 'two taxation periods in a year require separate assessments');
assert.equal(assessAnnualGovernanceReturnCycle(twoPeriods, 2025, today).dueDate, null);
const labels = annualReturnEvidence(on, [
  { kind: 'OntarioAnnualReturn', periodLabel: 'Taxation period ended 2025-02-28', status: 'Filed', filedAt: '2025-08-20' },
  { kind: 'OntarioAnnualReturn', periodLabel: '2024-03-01 to 2025-02-28', status: 'Filed', filedAt: '2025-08-20' },
]);
assert.equal(labels[0].periodEnd, '2025-02-28');
assert.equal(labels[1].periodEnd, undefined, 'an unstructured date range does not guess a period end');

const extended = { ...society, annualMeetingDate: '2026-03-10', annualMeetingYear: 2025, agmExtensionDate: '2026-03-15', agmExtensionEvidence: 'registrar-order-2025' };
const postponedMeeting = { ...held, _id: 'postponed-held', scheduledAt: '2025-12-20', heldAt: '2026-03-10' };
const societyFilings = [{ _id: 'extended-report', kind: 'AnnualReport', reportingYear: 2025, status: 'Filed', filedAt: '2026-03-20' }];
const extendedSettings = annualGovernanceSettings(extended, [postponedMeeting], societyFilings, today);
const verifiedExtension = { kind: 'held', date: '2026-03-10', cycleYear: 2025, verified: true, evidenceRef: 'reviewed-postponed-annual-minutes' };
assert.equal(annualGovernanceSettings(extended, [], societyFilings, today).annualMeetingCompletions?.length, 1);
assert.equal(annualGovernanceSettings({ ...extended, annualMeetingDate: undefined, annualMeetingCompletions: [verifiedExtension] }, [], societyFilings, today).annualMeetingCompletions?.[0].cycleYear, 2025);
for (const date of ['2024-06-01', '2026-04-01']) assert.deepEqual(annualGovernanceSettings({ ...extended, annualMeetingDate: undefined, annualMeetingCompletions: [{ ...verifiedExtension, date }] }, [], [], today).annualMeetingCompletions, [], 'registrar extension does not attribute a prior or too-late meeting to its covered year');
assert.deepEqual(extendedSettings.heldAgmYears, [2025]);
assert.equal(extendedSettings.annualMeetingCompletions?.length, 1);
assert.equal(extendedSettings.annualMeetingCompletions?.[0].cycleYear, 2025);
assert.equal(assessAnnualMeetingDeadline({ ...extendedSettings, annualMeetingAssessmentYear: 2025 }, today).status, 'satisfied');
assert.notEqual(assessAnnualMeetingDeadline({ ...extendedSettings, annualMeetingAssessmentYear: 2026 }, today).status, 'satisfied');
assert.equal(assessAnnualGovernanceReturnCycle(extendedSettings, 2025, today).dueDate, '2026-04-09');
assert.equal(assessAnnualGovernanceReturnCycle(extendedSettings, 2025, today).status, 'satisfied');
assert.notEqual(assessAnnualGovernanceReturnCycle(extendedSettings, 2026, today).status, 'satisfied');

// Exercise the actual portable annual-cycle read, not only the adapter.
async function cycle(organization: Record<string, any>, meetings: Record<string, any>[], filings: Record<string, any>[], year: number) {
  const societyId = 'cycle-fixture';
  const membership = portableTestSeed(societyId);
  const db = new MemoryDb({ seed: {
    ...membership,
    societies: [{ ...membership.societies[0], ...organization }],
    meetings: meetings.map(row => ({ ...row, societyId })),
    filings: filings.map(row => ({ ...row, societyId })),
  } });
  return new PortableRuntime({ db, capabilities: makeCapabilities({}), principalProvider: portableTestPrincipal })
    .register(definePortableQuery({ name: 'cycle', handler: summaryPortable }))
    .runQuery('cycle', { societyId, year }) as Promise<any>;
}
const lateBcCycle = await cycle(bc, [{ ...held, scheduledAt: '2021-10-01' }], [], 2021);
assert.equal(lateBcCycle.meetingAssessment.status, 'satisfied');
assert.equal(lateBcCycle.meetingAssessment.dueDate, '2021-09-10', 'historical cycle uses the deadline before its first held meeting');
assert.equal(lateBcCycle.meetingAssessment.late, undefined, 'completion is preserved while statutory timeliness awaits calendar review');
assert.equal(lateBcCycle.meetingAssessment.timingReviewRequired, true);
assert.equal(lateBcCycle.reportAssessment.dueDate, '2021-05-10', 'company report is not 30 days from the AGM');
const plannedBcCycle = await cycle(bc, unreliable.filter(row => row._id !== 'future'), [], 2024);
assert.equal(plannedBcCycle.meetingAssessment.status, 'review_required');
assert.equal(plannedBcCycle.meetingAssessment.timingReviewRequired, true);
assert.equal(plannedBcCycle.meetingAssessment.dueDate, '2021-09-10');
const writtenCycle = await cycle({ ...bc, annualMeetingCompletions: [written] }, [], [], 2025);
assert.equal(writtenCycle.meetingAssessment.status, 'satisfied');
assert.ok(writtenCycle.meetingAssessment.basis.includes('Reviewed written annual-business completion'));
assert.equal(writtenCycle.agm, null, 'reviewed written business does not fabricate a meeting row');
const foreignReturnCycle = await cycle(bc, [], [{ ...homeReturn, _id: 'foreign-context', contextKind: 'extra_provincial' }], 2022);
assert.equal(foreignReturnCycle.reportAssessment.status, 'review_required');
assert.equal(foreignReturnCycle.reportAssessment.timingReviewRequired, true);
const onCycle = await cycle(on, [], ontarioFilings, 2025);
assert.equal(onCycle.reportAssessment.dueDate, '2025-10-31');
assert.equal(onCycle.annualReport._id, 'on-period');
const extended2025 = await cycle(extended, [postponedMeeting], societyFilings, 2025);
const extended2026 = await cycle(extended, [postponedMeeting], societyFilings, 2026);
assert.equal(extended2025.agm._id, 'postponed-held');
assert.equal(extended2025.reportAssessment.status, 'satisfied');
assert.equal(extended2026.agm, null, 'an attributed postponed AGM is not reused for its physical calendar year');
assert.equal(extended2026.annualReport, null);

console.log('Annual governance evidence, filing periods and portable cycle checks passed');
