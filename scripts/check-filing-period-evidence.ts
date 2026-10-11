import assert from 'node:assert/strict';
import { convexTest } from 'convex-test';
import schema from '../convex/schema';
import { api } from '../convex/_generated/api';
import { betterAuthIssuer } from '../convex/lib/authIdentity';
import { annualGovernanceSettings, assessAnnualGovernanceReturnCycle } from '../shared/annualGovernanceEvidence';

const native = convexTest(schema, {
  './_generated/api.js': () => import('../convex/_generated/api.js'),
  './_generated/server.js': () => import('../convex/_generated/server.js'),
  './filings.js': () => import('../convex/filings'),
});
const issuer = betterAuthIssuer();
const today = new Date().toISOString().slice(0, 10);
const fixture = await native.run(async ctx => {
  const societyId = await ctx.db.insert('societies', { name: 'Period evidence fixture', entityType: 'corporation__business_', actFormedUnder: 'business_corporations_act__ontario_', jurisdictionCode: 'CA-ON-OBCA', incorporationDate: '2020-01-01', fiscalYearEnd: '12-31', isCharity: false, isMemberFunded: false, updatedAt: 0 });
  const foreignSocietyId = await ctx.db.insert('societies', { name: 'Foreign period fixture', isCharity: false, isMemberFunded: false, updatedAt: 0 });
  for (const role of ['Owner', 'Member']) await ctx.db.insert('users', { societyId, displayName: role, email: `${role}@period.example`, role, status: 'Active', authSubject: `period-${role}`, authIssuer: issuer, authProvider: 'better-auth', createdAtISO: new Date().toISOString() });
  return { societyId, foreignSocietyId };
});
const owner = native.withIdentity({ issuer, subject: 'period-Owner' });
const member = native.withIdentity({ issuer, subject: 'period-Member' });
const create = { societyId: fixture.societyId, kind: 'OntarioAnnualReturn', contextKind: 'home', jurisdictionCode: 'CA-ON-OBCA', periodLabel: 'Period ending February 2025', reportingYear: 2025, reportingPeriodEnd: '2025-02-28', dueDate: '2025-08-31', status: 'Upcoming' };
const filingId = await owner.mutation(api.filings.create, create);
await assert.rejects(() => owner.mutation(api.filings.create, { ...create, reportingYear: 2025.5 }), /Reporting year/);
await assert.rejects(() => owner.mutation(api.filings.create, { ...create, reportingPeriodEnd: '2025-02-30' }), /period end/);
await assert.rejects(() => owner.mutation(api.filings.create, { ...create, reportingYear: 2024 }), /must agree/);
await assert.rejects(() => member.mutation(api.filings.create, create), /filings:write|Permission/);
await assert.rejects(() => owner.mutation(api.filings.create, { ...create, societyId: fixture.foreignSocietyId }));
await assert.rejects(() => owner.mutation(api.filings.markFiled, { id: filingId, filedAt: '2999-01-01', submissionMethod: 'ManualPortal', evidenceNotes: 'Future-date rejection fixture' }), /valid filed date/);
await owner.mutation(api.filings.markFiled, { id: filingId, filedAt: today, reportingYear: 2025, reportingPeriodEnd: '2025-02-28', submissionMethod: 'ManualPortal', confirmationNumber: 'SYNTHETIC-PERIOD-RECEIPT', evidenceNotes: 'The receipt identifies the exact period ending 2025-02-28.' });
const row = await owner.query(api.filings.get, { id: filingId });
assert.equal(row.reportingYear, 2025);
assert.equal(row.reportingPeriodEnd, '2025-02-28');
assert.equal(row.status, 'Filed');
const organization = await native.run(ctx => ctx.db.get(fixture.societyId));
const assessment = assessAnnualGovernanceReturnCycle(annualGovernanceSettings(organization!, [], [row], today), 2025, today);
assert.equal(assessment.dueDate, '2025-08-31', 'Actual period overrides a later fiscal-calendar preference');
assert.equal(assessment.status, 'satisfied');
assert.equal(assessment.late, today > '2025-08-31' ? undefined : false);
assert.equal(assessment.timingReviewRequired, today > '2025-08-31', 'Recorded filing remains complete while calendar timeliness is reviewed separately');
const wrongContext = { ...row, contextKind: 'extra_provincial' };
assert.notEqual(assessAnnualGovernanceReturnCycle(annualGovernanceSettings(organization!, [], [wrongContext], today), 2025, today).status, 'satisfied', 'A registration-context filing cannot close the home return');
await assert.rejects(() => owner.mutation(api.filings.update, { id: filingId, patch: { reportingPeriodEnd: '2024-12-31' } }), /must agree/);
console.log('Native filing-period evidence passed: schema persistence, exact covered period, date/year validation, future-date rejection, home-context isolation and access boundaries.');
