import assert from 'node:assert/strict';
import { convexTest } from 'convex-test';
import schema from '../convex/schema';
import { api } from '../convex/_generated/api';
import { betterAuthIssuer } from '../convex/lib/authIdentity';
import {
  assessAnnualMeetingDeadline, assessAnnualReturnDeadline, complianceDateFromISO, complianceDeadlineAlreadyTracked,
  deriveComplianceDeadlines, deriveComplianceHistoryNotices, type ComplianceSettings,
} from '../shared/corporationSettings';
import { annualGovernanceSettings, annualReturnEvidence, assessAnnualGovernanceReturnCycle } from '../shared/annualGovernanceEvidence';
import { NOTICE_CALENDAR_REVIEW_CAVEAT } from '../shared/legalMeetingNotice';
import { summaryPortable } from '../shared/functions/annualCycle';
import { complianceDeadlinesPortable } from '../shared/functions/corporationSettings';
import * as corporationSettingsHandlers from '../shared/functions/corporationSettings';
import { validateFiledFacts } from '../shared/functions/filings';
import { MemoryDb, PortableRuntime, definePortableMutation, definePortableQuery, makeCapabilities } from '../shared/portable/index';
import { PORTABLE_TEST_IDENTITY, portableTestPrincipal, portableTestSeed } from './portable-test-fixture';

// Review findings on annual deadlines (PR #60). Every scenario runs against a
// fixed clock so the "current cycle" and calendar margin are deterministic.
const RealDate = Date;
const clockISO = '2026-10-11T20:00:00.000Z';
class FixedClock extends RealDate {
  constructor(...args: unknown[]) { super(...((args.length ? args : [clockISO]) as [])); }
  static now() { return new RealDate(clockISO).getTime(); }
}
globalThis.Date = FixedClock as DateConstructor;
const today = '2026-10-11';

try {
  // --- 1. Old incorporation date with recent evidence -----------------------
  // A BC society incorporated in 1990 with held AGMs and filed reports for 2024
  // and 2025: the open cycles follow the evidence, not the incorporation year.
  const oldSociety = { jurisdictionCode: 'CA-BC', entityType: 'society', incorporationDate: '1990-05-01', fiscalYearEnd: '03-31' };
  const agm = (date: string) => ({ type: 'AGM', title: 'Annual General Meeting', status: 'Held', scheduledAt: `${date}T19:00:00Z`, heldAt: `${date}T19:00:00Z` });
  const reports = [
    { _id: 'f1', kind: 'AnnualReport', status: 'Filed', filedAt: '2024-07-01', periodLabel: '2024', dueDate: '2024-07-15' },
    { _id: 'f2', kind: 'AnnualReport', status: 'Filed', filedAt: '2025-07-01', periodLabel: '2025 AGM', dueDate: '2025-07-14' },
  ];
  const old = annualGovernanceSettings(oldSociety as any, [agm('2024-06-15'), agm('2025-06-14')] as any, reports, today);
  const oldReport = assessAnnualReturnDeadline(old, today);
  assert.equal(oldReport.cycleYear, 2026, 'the report cycle after the latest filed report');
  assert.equal(oldReport.dueDate, '2027-01-31', 'no 2026 AGM yet: the s. 73(2) January 31 date');
  assert.equal(oldReport.status, 'upcoming');
  assert.equal(oldReport.historyNotVerified?.cycleYears[0], 1991, 'unverified history is reported separately');
  assert.equal(oldReport.historyNotVerified?.cycleYears.at(-1), 2023);
  assert.ok(oldReport.historyNotVerified?.basis.startsWith('History not verified'));
  const oldMeeting = assessAnnualMeetingDeadline(old, today);
  assert.equal(oldMeeting.cycleYear, 2026);
  assert.equal(oldMeeting.dueDate, '2026-12-31');
  assert.equal(deriveComplianceDeadlines({ ...old, agmMonth: 6, agmDay: 15 }, today).find(d => d.key === 'annual-report')?.dueDate, '2027-01-31');
  assert.deepEqual(deriveComplianceHistoryNotices(old, today).map(n => n.key), ['agm-history', 'annual-report-history']);
  // An explicit cycle still assesses that cycle.
  assert.equal(assessAnnualGovernanceReturnCycle(old, 2025, today).status, 'satisfied');
  assert.equal(assessAnnualGovernanceReturnCycle(old, 1995, today).dueDate, '1996-01-31');
  assert.equal(assessAnnualGovernanceReturnCycle(old, 1995, today).status, 'overdue');
  assert.equal(assessAnnualMeetingDeadline({ ...old, annualMeetingAssessmentYear: 1995 }, today).dueDate, '1995-12-31');
  // BC society rules are unchanged: AGM + 30 days, January 31 with no AGM, s. 73(3).
  const held2026 = annualGovernanceSettings(oldSociety as any, [agm('2024-06-15'), agm('2025-06-14'), agm('2026-06-13')] as any, reports, '2026-07-01');
  assert.equal(assessAnnualReturnDeadline(held2026, '2026-07-01').dueDate, '2026-07-13', 'AGM + 30 days');
  const extension = { cycleYear: 2025, dueDate: '2026-03-15', authority: 'registrar' as const, evidenceRef: 'registrar-order' };
  const extended: ComplianceSettings = { ...oldSociety, annualMeetingDates: ['2024-06-15'], annualReturnFilings: [{ cycleYear: 2024, filedAt: '2024-07-01', status: 'filed' }], annualMeetingExtension: extension };
  assert.equal(assessAnnualReturnDeadline(extended, '2026-03-20').dueDate, '2026-04-14', 's. 73(3): 30 days after the extended deadline');
  // The same applies to BC companies, CBCA and Ontario.
  const company = { incorporationDate: '1990-05-01', entityType: 'corporation__business_', fiscalYearEnd: '12-31' };
  const bcCompany: ComplianceSettings = { ...company, jurisdictionCode: 'CA-BC', annualReturnFilings: [2024, 2025].map(cycleYear => ({ cycleYear, filedAt: `${cycleYear}-05-15`, status: 'filed' as const })) };
  assert.equal(assessAnnualReturnDeadline(bcCompany, today).cycleYear, 2026);
  assert.equal(assessAnnualReturnDeadline(bcCompany, today).dueDate, '2026-07-01', 'anniversary + 2 months');
  assert.deepEqual(assessAnnualReturnDeadline(bcCompany, today).historyNotVerified?.cycleYears.slice(0, 2), [1991, 1992]);
  const cbca: ComplianceSettings = { ...company, jurisdictionCode: 'CA-FED-CBCA', annualReturnFilings: [2024, 2025, 2026].map(cycleYear => ({ cycleYear, filedAt: `${cycleYear}-05-15`, status: 'filed' as const })) };
  assert.equal(assessAnnualReturnDeadline(cbca, today).dueDate, '2027-06-30', 'anniversary + 60 days, after the latest filing');
  const ontario: ComplianceSettings = { ...company, jurisdictionCode: 'CA-ON-OBCA', annualReturnFilings: ['2023-12-31', '2024-12-31'].map(periodEnd => ({ periodEnd, filedAt: `${Number(periodEnd.slice(0, 4)) + 1}-05-01`, status: 'filed' as const })) };
  assert.equal(assessAnnualReturnDeadline(ontario, today).anchorDate, '2025-12-31', 'the taxation period after the latest filed period');
  assert.equal(assessAnnualReturnDeadline(ontario, today).dueDate, '2026-06-30');
  assert.equal(assessAnnualReturnDeadline({ ...ontario, annualReturnFilings: [] }, today).anchorDate, '2026-12-31', 'no evidence: the current period, not 1990');
  assert.equal(assessAnnualReturnDeadline({ ...bcCompany, annualReturnFilings: [] }, '2026-04-01').dueDate, '2026-07-01', 'an upcoming current cycle is never skipped');

  // --- 2. A stale BC-company annual reference date ---------------------------
  const staleCompany = { jurisdictionCode: 'CA-BC', entityType: 'corporation__business_', actFormedUnder: 'business_corporations_act', incorporationDate: '2010-03-10', fiscalYearEnd: '12-31', annualReferenceDate: '2023-03-01' };
  const stale = annualGovernanceSettings(staleCompany, [agm('2024-06-15'), agm('2025-06-14')] as any, [], today);
  assert.equal(assessAnnualMeetingDeadline(stale, today).anchorDate, '2025-06-14', 'the latest held AGM, not the stale profile reference date');
  assert.equal(assessAnnualMeetingDeadline(stale, today).dueDate, '2026-09-14');
  assert.equal(assessAnnualMeetingDeadline({ ...stale, annualReferenceDate: '2025-09-01' }, today).anchorDate, '2025-09-01', 'a later reference date is still used');

  // --- 3. Overdue escalation when no calendar review is recorded -------------
  const missed: ComplianceSettings = { jurisdictionCode: 'CA-BC', entityType: 'society', incorporationDate: '2015-05-01', annualMeetingDates: ['2024-06-01'] };
  const missedAgm = assessAnnualMeetingDeadline(missed, today);
  assert.equal(missedAgm.cycleYear, 2025);
  assert.equal(missedAgm.status, 'overdue', 'a missed AGM becomes overdue');
  assert.ok(missedAgm.basis.includes('calendar not reviewed'), 'the reason stays in the text');
  assert.equal(assessAnnualMeetingDeadline(missed, '2026-01-05').status, 'review_required', 'inside the 7-day margin it still needs review');
  const review = { profileId: 'bc_society', obligation: 'annual_meeting' as const, cycleYear: 2025, nominalDueDate: '2025-12-31', reviewedDueDate: '2025-12-31', reviewedOn: '2026-01-02', verified: true, evidenceRef: 'calendar-review-2025', calendarBasis: 'BC Interpretation Act reviewed; December 31, 2025 is a Wednesday business day.' };
  assert.equal(assessAnnualMeetingDeadline({ ...missed, annualDeadlineCalendarReviews: [review] }, '2026-01-05').status, 'overdue');
  assert.equal(assessAnnualMeetingDeadline({ ...missed, annualDeadlineCalendarReviews: [review] }, '2026-01-05').calendarReviewStatus, 'reviewed');

  // --- 5. Timestamp fromISO --------------------------------------------------
  assert.equal(complianceDateFromISO('2026-10-11T08:30:00.000Z'), '2026-10-11');
  assert.equal(complianceDateFromISO('2026-10-11T23:59:59-07:00'), '2026-10-11');
  for (const bad of ['2026-02-30T00:00:00Z', '2026-10-11junk', 'not a date', '']) assert.equal(complianceDateFromISO(bad), null, bad);
  assert.deepEqual(deriveComplianceDeadlines(old, '2026-10-11T08:30:00.000Z'), deriveComplianceDeadlines(old, today));
  assert.deepEqual(deriveComplianceDeadlines(old, '2026-10-11junk'), []);

  // --- 6. De-duplication on a stable key -------------------------------------
  const derived = deriveComplianceDeadlines({ ...old, agmMonth: 6, agmDay: 15 }, today);
  const agmDeadline = derived.find(d => d.key === 'agm')!, reportDeadline = derived.find(d => d.key === 'annual-report')!, yearEnd = derived.find(d => d.key === 'fiscal-year-end')!;
  const legacy = [
    { title: 'Annual General Meeting', dueDate: '2026-06-15', category: 'agm' },
    { title: 'Annual Report', dueDate: '2026-07-15', category: 'annual-report' },
    { title: 'Fiscal Year End', dueDate: yearEnd.dueDate, category: 'financial' },
  ];
  for (const deadline of [agmDeadline, reportDeadline, yearEnd]) assert.ok(complianceDeadlineAlreadyTracked(deadline, legacy, old), `legacy ${deadline.key} row matches`);
  assert.ok(complianceDeadlineAlreadyTracked(agmDeadline, [{ title: 'AGM', dueDate: '2026-12-31', category: 'Governance' }], old));
  assert.ok(!complianceDeadlineAlreadyTracked(reportDeadline, [{ title: 'Annual Report', dueDate: '2026-01-31', category: 'Governance' }], old), "last cycle's no-AGM report is a different cycle");
  assert.ok(complianceDeadlineAlreadyTracked(reportDeadline, [{ title: 'Something renamed', sourceKey: 'compliance:annual-report:2026' }], old));
  assert.ok(!complianceDeadlineAlreadyTracked(reportDeadline, [{ title: 'Annual Report', sourceKey: 'compliance:annual-report:2025' }], old));
  assert.ok(!complianceDeadlineAlreadyTracked(reportDeadline, [{ title: 'Board meeting', dueDate: '2027-01-31' }], old), 'an unrelated row is not a duplicate');
  const companyReport = deriveComplianceDeadlines(bcCompany, today).find(d => d.key === 'annual-report')!;
  assert.ok(complianceDeadlineAlreadyTracked(companyReport, [{ title: 'Annual Report', dueDate: '2026-07-01', category: 'annual-report' }], bcCompany), 'legacy company title');
  assert.ok(complianceDeadlineAlreadyTracked(companyReport, [{ title: 'BC company annual report', dueDate: '2026-07-02' }], bcCompany), 'a shifted due date in the same cycle');

  // --- 7. Ontario return recorded with only a reporting year -----------------
  const onOrg = { jurisdictionCode: 'CA-ON-OBCA', entityType: 'corporation__business_', actFormedUnder: 'business_corporations_act__ontario_', incorporationDate: '2015-01-15', fiscalYearEnd: '06-30' };
  const yearOnly = { _id: 'on-2025', kind: 'OntarioAnnualReturn', reportingYear: 2025, status: 'Filed', filedAt: '2025-11-01' };
  assert.equal(annualReturnEvidence(onOrg, [yearOnly])[0].periodEnd, '2025-06-30', 'the fiscal calendar gives exactly one period ending that year');
  const onSettings = annualGovernanceSettings(onOrg, [], [yearOnly], today);
  assert.equal(assessAnnualGovernanceReturnCycle(onSettings, 2025, today).status, 'satisfied', 'a year-only Ontario return closes its cycle');
  assert.equal(assessAnnualReturnDeadline(onSettings, today).anchorDate, '2026-06-30', 'the open period follows it');
  assert.equal(annualReturnEvidence(onOrg, [{ ...yearOnly, filedAt: '2025-05-01' }])[0].periodEnd, undefined, 'a period ending after the filing is not inferred');
  assert.equal(annualReturnEvidence({ ...onOrg, incorporationDate: '2025-08-01' }, [{ ...yearOnly, filedAt: '2026-01-10', reportingYear: 2025 }])[0].periodEnd, undefined, 'no period ends in the year before recognition');
  assert.equal(annualReturnEvidence({ ...onOrg, fiscalYearEnd: undefined }, [yearOnly])[0].periodEnd, undefined, 'no fiscal calendar, no inference');
  const filedFacts = { kind: 'OntarioAnnualReturn', status: 'Filed', filedAt: '2025-11-01', submissionMethod: 'ManualPortal', confirmationNumber: 'ON-123', reportingYear: 2025 };
  assert.throws(() => validateFiledFacts(filedFacts), /taxation-year end/, 'marking filed requires the taxation-year end');
  validateFiledFacts({ ...filedFacts, reportingPeriodEnd: '2025-06-30' });
  validateFiledFacts({ ...filedFacts, status: 'Upcoming' });
  validateFiledFacts({ ...filedFacts, kind: 'FederalAnnualReturn' });

  // --- 4 and 2b. Portable annual-cycle summary --------------------------------
  async function summary(organization: Record<string, any>, meetings: Record<string, any>[], year: number) {
    const societyId = 'cycle-fixture';
    const membership = portableTestSeed(societyId);
    const db = new MemoryDb({ seed: { ...membership, societies: [{ ...membership.societies[0], ...organization }], meetings: meetings.map(row => ({ ...row, societyId })) } });
    return new PortableRuntime({ db, capabilities: makeCapabilities({}), principalProvider: portableTestPrincipal })
      .register(definePortableQuery({ name: 'cycle', handler: summaryPortable }))
      .runQuery('cycle', { societyId, year }) as Promise<any>;
  }
  const planned = { _id: 'agm-2026', type: 'AGM', title: 'Annual General Meeting', status: 'Scheduled', scheduledAt: '2026-11-20T18:00:00Z' };
  const noticeItem = (result: any) => result.phases.before.find((item: any) => item.id === 'notice-package');
  const withNotice = noticeItem(await summary(oldSociety, [{ ...planned, noticeSentAt: '2026-10-01T12:00:00Z' }], 2026));
  assert.equal(withNotice.status, 'complete', 'recorded notice completes the notice step');
  assert.ok(withNotice.detail.includes(NOTICE_CALENDAR_REVIEW_CAVEAT), 'the calendar caveat stays in the detail');
  assert.equal(noticeItem(await summary(oldSociety, [planned], 2026)).status, 'attention');
  assert.equal(noticeItem(await summary(oldSociety, [], 2026)).status, 'blocked');
  const staleCycle = await summary(staleCompany, [{ ...agm('2024-06-15'), _id: 'a' }, { ...agm('2025-06-14'), _id: 'b' }], 2026);
  assert.equal(staleCycle.meetingAssessment.dueDate, '2026-09-14', 'the annual-cycle path also ignores the stale reference date');

  // --- complianceDeadlines portable query matches the settings page -----------
  {
    const societyId = 'deadline-fixture';
    const membership = portableTestSeed(societyId);
    const db = new MemoryDb({ seed: { ...membership, societies: [{ ...membership.societies[0], ...oldSociety, agmMonth: 6, agmDay: 15 }],
      meetings: [{ ...agm('2024-06-15'), _id: 'm1', societyId }, { ...agm('2025-06-14'), _id: 'm2', societyId }],
      filings: reports.map(row => ({ ...row, societyId })) } });
    const query = await new PortableRuntime({ db, capabilities: makeCapabilities({}), principalProvider: portableTestPrincipal })
      .register(definePortableQuery({ name: 'deadlines', handler: complianceDeadlinesPortable }))
      .runQuery('deadlines', { societyId, fromISO: '2026-10-11T08:30:00.000Z' }) as any[];
    assert.deepEqual(query, deriveComplianceDeadlines({ ...old, agmMonth: 6, agmDay: 15 }, today), 'built from the shared evidence adapter, filings included');
  }

  // --- 3. Recording evidence: native Convex schema and the portable runtime ---
  type Actor = { mutation(name: string, args: any): Promise<any> };
  type Store = { insert(table: string, doc: any): Promise<any>; get(id: string): Promise<any> };
  async function seed(store: Store, issuer: string, provider: string) {
    const base = { isCharity: false, isMemberFunded: false, updatedAt: Date.now() };
    const cbcaId = await store.insert('societies', { ...base, name: 'Federal company', entityType: 'corporation__business_', jurisdictionCode: 'CA-FED-CBCA', actFormedUnder: 'canada_business_corporations_act', incorporationDate: '2018-02-01', fiscalYearEnd: '12-31' });
    const societyId = await store.insert('societies', { ...base, name: 'BC society', entityType: 'society', jurisdictionCode: 'CA-BC', actFormedUnder: 'societies_act', incorporationDate: '2015-05-01' });
    const foreignId = await store.insert('societies', { ...base, name: 'Foreign company', entityType: 'corporation__business_', jurisdictionCode: 'CA-FED-CBCA', actFormedUnder: 'canada_business_corporations_act', incorporationDate: '2018-02-01' });
    const user = { status: 'Active', authIssuer: issuer, authProvider: provider, createdAtISO: clockISO };
    const ownerId = await store.insert('users', { ...user, societyId: cbcaId, role: 'Owner', authSubject: 'annual-owner', email: 'owner@example.test', displayName: 'Annual officer' });
    await store.insert('users', { ...user, societyId: cbcaId, role: 'Member', authSubject: 'annual-member', email: 'member@example.test', displayName: 'Member' });
    await store.insert('users', { ...user, societyId, role: 'Owner', authSubject: 'society-owner', email: 'society@example.test', displayName: 'Society officer' });
    const foreignOwner = await store.insert('users', { ...user, societyId: foreignId, role: 'Owner', authSubject: 'foreign-owner', email: 'foreign@example.test', displayName: 'Foreign officer' });
    const consent = (key: string, at: string, recordedBy: string) => ({ signerName: key, electorKey: key, weight: 1, consentEvidence: 'Signed counterpart received and filed.', recordedByUserId: recordedBy, signedAtISO: at, recordedAtISO: at.replace('T15', 'T16') });
    const verified = (owner: string, society: string, overrides: Record<string, any> = {}) => ({
      societyId: society, title: 'Annual business 2026', text: 'Financial statements received; directors elected; auditor appointed.', kind: 'Ordinary', body: 'shareholders', profileId: 'federal_cbca', evidenceVersion: 2,
      circulatedAtISO: '2026-03-01T15:00:00.000Z', circulationRecordedAtISO: '2026-03-01T16:00:00.000Z', circulationRecordedByUserId: owner,
      authorityReviewedAtISO: '2026-03-01T16:00:00.000Z', authorityReviewedByUserId: owner,
      governingInstrumentEvidence: 'Articles and by-laws reviewed for annual business.', electorateEvidence: 'Securities register reviewed at the record date.', circulationEvidence: 'Circulated to every voting shareholder.',
      electorate: [{ key: 'holder-a', name: 'Holder A', weight: 1 }, { key: 'holder-b', name: 'Holder B', weight: 1 }], electorateTotal: 2, countUnit: 'people',
      approvalRule: { numerator: 1, denominator: 1, strict: false, unit: 'people' }, statutoryRequiredCount: 2, requiredCount: 2,
      signatures: [consent('holder-a', '2026-03-02T15:00:00.000Z', owner), consent('holder-b', '2026-03-03T15:00:00.000Z', owner)],
      completedAtISO: '2026-03-03T15:00:00.000Z', status: 'Carried', ...overrides,
    });
    const resolutionId = await store.insert('writtenResolutions', verified(ownerId, cbcaId));
    const directorsId = await store.insert('writtenResolutions', verified(ownerId, cbcaId, { body: 'directors' }));
    const legacyId = await store.insert('writtenResolutions', { societyId: cbcaId, title: 'Legacy carried claim', text: 'Annual business', kind: 'Ordinary', circulatedAtISO: '2026-03-01', completedAtISO: '2026-03-03', requiredCount: 1, status: 'Carried', signatures: [{ signerName: 'Unverified', signedAtISO: '2026-03-03' }] });
    const foreignResolutionId = await store.insert('writtenResolutions', verified(foreignOwner, foreignId));
    return { cbcaId, societyId, resolutionId, directorsId, legacyId, foreignResolutionId };
  }
  async function qualify(label: string, ids: Awaited<ReturnType<typeof seed>>, store: Store, as: (subject: string) => Actor) {
    const owner = as('annual-owner'), member = as('annual-member'), societyOwner = as('society-owner');
    const written = { societyId: ids.cbcaId, writtenResolutionId: ids.resolutionId, kind: 'written_annual_business', completedOn: '2026-03-03', financialYearEnd: '2025-12-31', annualBusinessEvidence: 'Disposed of all annual business under CBCA s. 142, including statements and elections.', annualBusinessReviewed: true };
    await assert.rejects(member.mutation('recordWrittenAnnualBusinessCompletion', written), /permission|Permission/i, `${label}: compliance settings permission required`);
    for (const [patch, pattern] of [
      [{ annualBusinessReviewed: false }, /disposed of all required annual business/],
      [{ writtenResolutionId: ids.directorsId }, /not by a directors' resolution/],
      [{ writtenResolutionId: ids.legacyId }, /passage established/],
      [{ writtenResolutionId: ids.foreignResolutionId }, /not found/],
      [{ kind: 'written_waiver' }, /Only the BC Business Corporations Act/],
      [{ completedOn: '2026-04-01' }, /date the resolution took effect/],
    ] as const) await assert.rejects(owner.mutation('recordWrittenAnnualBusinessCompletion', { ...written, ...patch }), pattern, `${label}: ${JSON.stringify(patch)}`);
    await owner.mutation('recordWrittenAnnualBusinessCompletion', written);
    await assert.rejects(owner.mutation('recordWrittenAnnualBusinessCompletion', written), /already recorded/, `${label}: no duplicate completion`);
    const cbca = await store.get(ids.cbcaId);
    assert.equal(cbca.annualMeetingCompletions.length, 1);
    assert.equal(String(cbca.annualMeetingCompletions[0].writtenResolutionId), String(ids.resolutionId), 'the completion links the written resolution');
    assert.ok(cbca.annualMeetingCompletions[0].evidenceRef.includes('CBCA s. 142'));
    const cbcaMeeting = assessAnnualMeetingDeadline(annualGovernanceSettings(cbca, [], [], today), today);
    assert.equal(cbcaMeeting.anchorDate, '2026-03-03', `${label}: written annual business completes the cycle`);
    assert.equal(cbcaMeeting.dueDate, '2027-06-03', 'the next meeting: 15 months, within six months of the next year-end');

    // Calendar reviews must match a calculated boundary and stay a few days at most.
    const calendar = { societyId: ids.societyId, obligation: 'annual_meeting', cycleYear: 2025, nominalDueDate: '2025-12-31', reviewedDueDate: '2025-12-31', calendarBasis: 'BC Interpretation Act; December 31, 2025 is a business day.', evidenceRef: 'Calendar review memo 2025-AGM', channel: 'BC Registries online' };
    for (const [patch, pattern] of [
      [{ reviewedDueDate: '2025-12-30' }, /earlier/], [{ reviewedDueDate: '2026-01-20' }, /few days at most/],
      [{ nominalDueDate: '2025-12-30', reviewedDueDate: '2025-12-30' }, /does not match/], [{ calendarBasis: 'short' }, /interpretation statute/],
      [{ reviewedOn: '2026-10-12' }, /future/],
    ] as const) await assert.rejects(societyOwner.mutation('recordAnnualDeadlineCalendarReview', { ...calendar, ...patch }), pattern, `${label}: ${JSON.stringify(patch)}`);
    await assert.rejects(owner.mutation('recordAnnualDeadlineCalendarReview', calendar), /membership|not found/i, `${label}: tenant-scoped`);
    await societyOwner.mutation('recordAnnualDeadlineCalendarReview', calendar);
    const society = await store.get(ids.societyId);
    assert.equal(society.annualDeadlineCalendarReviews.length, 1);
    assert.equal(society.annualDeadlineCalendarReviews[0].profileId, 'bc_society');
    const reviewed = assessAnnualMeetingDeadline({ ...annualGovernanceSettings(society, [], [], today), annualMeetingAssessmentYear: 2025 }, today);
    assert.equal(reviewed.calendarReviewStatus, 'reviewed', `${label}: the stored review applies`);
    assert.equal(reviewed.status, 'overdue');

    // Actual periods are validated and clearable.
    await assert.rejects(owner.mutation('updateAnnualEvidenceSettings', { societyId: ids.cbcaId, annualMeetingFinancialYearEnd: '2025-02-30' }), /valid date/);
    await owner.mutation('updateAnnualEvidenceSettings', { societyId: ids.cbcaId, annualMeetingFinancialYearEnd: '2026-12-31' });
    assert.equal((await store.get(ids.cbcaId)).annualMeetingFinancialYearEnd, '2026-12-31');
    await owner.mutation('updateAnnualEvidenceSettings', { societyId: ids.cbcaId, annualMeetingFinancialYearEnd: null });
    assert.equal((await store.get(ids.cbcaId)).annualMeetingFinancialYearEnd, undefined);
    console.log(`${label}: written annual business, calendar review and actual-period evidence passed.`);
  }

  const native = convexTest(schema, { './_generated/api.js': () => import('../convex/_generated/api.js'), './_generated/server.js': () => import('../convex/_generated/server.js'), './corporationSettings.js': () => import('../convex/corporationSettings') } as any);
  const issuer = betterAuthIssuer();
  const nativeStore: Store = { insert: (table, doc) => native.run((ctx) => ctx.db.insert(table as any, doc)), get: (id) => native.run((ctx) => ctx.db.get(id as any)) };
  await qualify('Native Convex', await seed(nativeStore, issuer, 'better-auth'), nativeStore, (subject) => {
    const actor = native.withIdentity({ subject, issuer });
    return { mutation: (name, args) => actor.mutation((api.corporationSettings as any)[name], args) };
  });
  const db = new MemoryDb();
  const memoryStore: Store = { insert: (table, doc) => db.transaction(() => db.insert(table, doc)), get: (id) => db.get(id) };
  const memoryIds = await seed(memoryStore, PORTABLE_TEST_IDENTITY.issuer, 'portable-fixture');
  await qualify('Portable runtime', memoryIds, memoryStore, (subject) => {
    const runtime = new PortableRuntime({ db, capabilities: makeCapabilities({}), principalProvider: () => ({ kind: 'user', runtime: 'test', assurance: 'verified-jwt', issuer: PORTABLE_TEST_IDENTITY.issuer, subject }) });
    runtime.registerAll(['recordAnnualDeadlineCalendarReview', 'recordWrittenAnnualBusinessCompletion', 'updateAnnualEvidenceSettings'].map((name) => ({
      ...definePortableMutation({ name: `corporationSettings:${name}`, handler: (corporationSettingsHandlers as any)[`${name}Portable`] }), applicationPolicy: true })));
    return { mutation: (name, args) => runtime.runMutation(`corporationSettings:${name}`, args) };
  });
} finally { globalThis.Date = RealDate; }
console.log('Annual deadline review fixes passed: evidence-based open cycles with unverified history, latest reference date, overdue escalation, written annual business, notice completion, timestamp dates, stable de-duplication and Ontario year-only returns.');
