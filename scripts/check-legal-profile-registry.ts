import assert from 'node:assert/strict';
import { LEGAL_GOVERNANCE_PROFILES, createLegalProfileRegistry, legalGovernanceProfile, minimumLegalDirectors, requiredResidentCanadianDirectors, requiredWrittenConsents, writtenResolutionRule } from '../shared/legalGovernanceProfiles';
import { LEGAL_SOURCES, legalSourceById } from '../shared/legalSources';
import { audienceAppliesToOrganization } from '../shared/entityRuleScope';
import { getRegulatoryCitation, buildHighlightUrl } from '../src/lib/regulatoryCitations';
import { dashboardComplianceRulePackForOrganization } from '../shared/dashboardComplianceRules';
import { resolutionConsentProgress, validateResolutionConsent } from '../shared/writtenResolutionEvidence';
import { legalMeetingQuorum, evaluateLegalDecision } from '../shared/legalDecision';

const society = { entityType: 'society', jurisdictionCode: 'CA-BC', actFormedUnder: 'societies_act' };
const bc = { entityType: 'corporation__business_', jurisdictionCode: 'CA-BC', actFormedUnder: 'business_corporations_act', distributing: false };
const federal = { ...bc, jurisdictionCode: 'CA-FED-CBCA', actFormedUnder: 'canada_business_corporations_act' };
const ontario = { ...bc, jurisdictionCode: 'CA-ON-OBCA', actFormedUnder: 'business_corporations_act__ontario_' };
const organizations = [society, bc, federal, ontario];
assert.deepEqual(organizations.map(o => legalGovernanceProfile(o)?.id), ['bc_society', 'bc_company', 'federal_cbca', 'ontario_obca']);
assert.equal(legalGovernanceProfile({ ...ontario, jurisdictionCode: 'CA-ON' })?.id, 'ontario_obca', 'Explicit OBCA resolves a generic Ontario province code');
assert.equal(legalGovernanceProfile({ ...federal, jurisdictionCode: 'CA-FED' })?.id, 'federal_cbca', 'Explicit CBCA resolves a generic federal code');
assert.equal(legalGovernanceProfile({ ...ontario, jurisdictionCode: 'CA-ON', actFormedUnder: 'not_for_profit_corporations_act' }), undefined);
for (const o of [null, { ...bc, actFormedUnder: 'custom_act' }, { ...bc, jurisdictionCode: 'CA-AB' }, { ...federal, entityType: 'corporation__nfp_' }, { ...federal, actFormedUnder: 'canada_not_for_profit_corporations_act' }]) assert.equal(legalGovernanceProfile(o), undefined, 'Unknown or contradictory law must not inherit a statutory profile');
assert.equal(legalGovernanceProfile({ name: 'Legacy' })?.id, 'bc_society');
assert.throws(() => createLegalProfileRegistry([LEGAL_GOVERNANCE_PROFILES[0], LEGAL_GOVERNANCE_PROFILES[0]]), /Duplicate legal profile/);
assert.throws(() => createLegalProfileRegistry([LEGAL_GOVERNANCE_PROFILES[0], { ...LEGAL_GOVERNANCE_PROFILES[0], id: 'other' }]), /Duplicate governing Act/);
const extension = { ...LEGAL_GOVERNANCE_PROFILES[0], id: 'test_extension', actKeys: ['test_governing_act'], jurisdictionCode: 'TEST', confidence: 'review_required' as const };
assert.equal(createLegalProfileRegistry([extension]).resolve({ entityType: 'society', jurisdictionCode: 'TEST', actFormedUnder: 'test_governing_act' })?.id, 'test_extension', 'Registry supports explicit new Act profiles without editing existing ones');
assert.equal(minimumLegalDirectors(society), 3);
assert.equal(minimumLegalDirectors({ ...society, isMemberFunded: true }), 1);
assert.equal(minimumLegalDirectors(bc), 1);
assert.equal(minimumLegalDirectors({ ...bc, legalSubtype: 'community_contribution_company' }), 3);
for (const o of [bc, federal, ontario]) assert.equal(minimumLegalDirectors({ ...o, distributing: true }), 3);
assert.deepEqual([0, 1, 2, 3, 4, 5, 8, 9].map(requiredResidentCanadianDirectors), [1, 1, 1, 1, 1, 2, 2, 3]);
const required = (org: any, kind: 'Ordinary' | 'Special', total: number, body: 'members' | 'shareholders' | 'directors') => requiredWrittenConsents(total, writtenResolutionRule(org, kind, body)!);
assert.equal(required(society, 'Ordinary', 100, 'members'), 67);
assert.equal(required(society, 'Special', 100, 'members'), 100);
assert.equal(required(bc, 'Ordinary', 100, 'shareholders'), 67);
assert.equal(required(federal, 'Ordinary', 100, 'shareholders'), 100);
assert.equal(writtenResolutionRule(federal, 'Ordinary', 'shareholders')?.unit, 'people');
assert.equal(required(ontario, 'Ordinary', 100, 'shareholders'), 51);
assert.equal(writtenResolutionRule(ontario, 'Ordinary', 'shareholders')?.unit, 'shares');
assert.equal(writtenResolutionRule(ontario, 'Ordinary', 'shareholders')?.noticeBusinessDays, 10);
assert.equal(required({ ...ontario, distributing: undefined }, 'Ordinary', 100, 'shareholders'), 100);
for (const o of organizations) assert.equal(required(o, 'Ordinary', 3, 'directors'), 3);
assert.equal(requiredWrittenConsents(Number.MAX_SAFE_INTEGER, { numerator: 2, denominator: 3, strict: false }), 6004799503160661);
assert.equal(requiredWrittenConsents(0, { numerator: 1, denominator: 1, strict: false }), 0);

assert.equal(legalMeetingQuorum({ entityType: 'society', jurisdiction: 'CA-BC', eligiblePeople: 41, presentPeople: 4, adoptedModel: 'bc_society' }).met, false);
for (const jurisdiction of ['CA-FED-CBCA', 'CA-ON-OBCA'] as const) {
  assert.equal(legalMeetingQuorum({ entityType: 'corporation__business_', jurisdiction, eligiblePeople: 2, presentPeople: 1, eligibleVotingShares: 100, presentVotingShares: 50 }).met, false);
  assert.equal(legalMeetingQuorum({ entityType: 'corporation__business_', jurisdiction, eligiblePeople: 2, presentPeople: 1, eligibleVotingShares: 100, presentVotingShares: 51 }).met, true);
}
const onDecision = { jurisdiction: 'CA-ON-OBCA', entityType: 'corporation__business_', body: 'shareholders', mode: 'written', resolution: 'ordinary', votesFor: 51, votesAgainst: 0, eligibleVotes: 100, circulatedToAll: true, offeringCorporation: false, governingInstrumentEvidence: 'Reviewed articles and shareholder agreement', votingShareCountsConfirmed: true } as const;
assert.equal(evaluateLegalDecision(onDecision).carries, true);
assert.equal(evaluateLegalDecision({ ...onDecision, votesFor: 50 }).carries, false);
assert.equal(evaluateLegalDecision({ ...onDecision, votingShareCountsConfirmed: false }).carries, null);

const electorate = [{ key: 'a', name: 'Same name', weight: 70 }, { key: 'b', name: 'Same name', weight: 30 }];
const signature = { electorKey: 'a', weight: 70, consentEvidence: 'Signed counterpart on file', recordedByUserId: 'officer', signedAtISO: '2026-10-01T10:00:00.000Z', recordedAtISO: '2026-10-02T10:00:00.000Z' };
assert.equal(resolutionConsentProgress(electorate, [signature], 67).thresholdMet, true);
assert.equal(resolutionConsentProgress(electorate, [signature, signature], 100).valid, false);
assert.equal(resolutionConsentProgress(electorate, [{ ...signature, electorKey: 'foreign' }], 67).thresholdMet, false);
assert.equal(resolutionConsentProgress(electorate, [{ ...signature, weight: 100 }], 100).thresholdMet, false);
assert.throws(() => validateResolutionConsent(electorate, [signature], 'a', 'Other signed record'), /already recorded/);
assert.throws(() => validateResolutionConsent(electorate, [], 'foreign', 'Signed foreign record'), /frozen legal electorate/);
assert.equal(validateResolutionConsent(electorate, [signature], 'b', 'Signed counterpart B').key, 'b', 'Names do not establish or deduplicate legal identity');

assert.equal(new Set(LEGAL_SOURCES.map(s => s.id)).size, LEGAL_SOURCES.length);
for (const source of LEGAL_SOURCES) {
  assert.match(source.url, /^https:\/\//, source.id);
  assert.match(source.reviewedOn, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(source.summary.trim() && source.section && source.fullCitation, source.id);
  if (source.consolidatedThrough) assert.ok(source.consolidatedThrough <= source.reviewedOn, source.id);
  const citation = getRegulatoryCitation(source.id);
  assert.equal(citation?.quoteKind, 'summary', source.id);
  assert.equal(buildHighlightUrl(citation!), source.url, `${source.id}: summaries must not become fabricated quote highlights`);
}
for (const profile of LEGAL_GOVERNANCE_PROFILES) {
  const coreIds = [...profile.directors.sourceIds, ...profile.directors.consentSourceIds, ...profile.annualMeeting.sourceIds, ...profile.annualReturn.sourceIds, ...profile.resolutions.sourceIds, ...profile.meetings.noticeSourceIds, ...profile.meetings.quorumSourceIds];
  for (const id of coreIds) { assert.ok(legalSourceById.has(id), id); assert.notEqual(legalSourceById.get(id)?.status, 'proposed', `${id} cannot authorize a current governance action`); }
  for (const record of profile.records) {
    assert.ok(record.sourceIds.length && record.retention && record.access, record.key);
    assert.ok(record.sourceIds.every(id => legalSourceById.has(id)), record.key);
  }
}
for (const o of organizations) {
  const pack = dashboardComplianceRulePackForOrganization(o);
  for (const rule of pack.rules) {
    assert.ok(audienceAppliesToOrganization(rule.audience, o), rule.id);
    const result = rule.passFail({ society: { ...o, isMemberFunded: false }, activeDirectors: [], rulesConfigured: false });
    for (const id of [...(result?.citationIds ?? []), ...(result?.citationId ? [result.citationId] : [])]) { const citation = getRegulatoryCitation(id); assert.ok(citation, id); assert.ok(audienceAppliesToOrganization(citation!.audience ?? 'general', o), `${id} must apply to this organization`); }
  }
}
console.log(`Legal profile registry passed: ${LEGAL_GOVERNANCE_PROFILES.length} profiles, ${LEGAL_SOURCES.length} sources, isolated legal identities, director minima/residency, exact consent arithmetic, source currency and scoped citations.`);
