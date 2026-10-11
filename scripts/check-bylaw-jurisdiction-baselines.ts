import assert from "node:assert/strict";
import { bylawBaselineForOrganization, clearNoticeDays, contextualBylawRules } from "../shared/bylawBaselines";
import { legalGovernanceProfile } from "../shared/legalGovernanceProfiles";
import { noticeWindowSatisfied } from "../src/features/meetings/lib/noticeWindow";
import { computedQuorumMet } from "../src/features/meetings/lib/meetingDetailHelpers";
import { StaticConvexClient } from "../src/lib/staticConvex";
assert.equal(bylawBaselineForOrganization({ entityType: "society", jurisdictionCode: "CA-FED-CBCA" }, "wrong").governanceAutomationBlocked, true);
assert.equal(bylawBaselineForOrganization({ entityType: "corporation__non_profit_", jurisdictionCode: "CA-BC" }, "nfp").governanceAutomationBlocked, true);
const emptyLegacy = bylawBaselineForOrganization({}, "empty-legacy");
assert.equal(emptyLegacy.governanceAutomationBlocked, false, "An absent legacy identity retains the established BC compatibility default");
assert.equal(emptyLegacy.jurisdictionCode, "CA-BC");
assert.equal(emptyLegacy.noticeRequiresClearDays, true, "Legacy BC compatibility must apply the same clear-day rule as an explicit BC society");
assert.equal(bylawBaselineForOrganization(null, "missing-record").governanceAutomationBlocked, true);
for (const override of [
  { jurisdictionCode: "unknown" },
  { homeJurisdictionCode: "unknown" },
  { homeJurisdiction: "unknown" },
  { jurisdiction: "unknown" },
  { jurisdictionCode: "unknown", homeJurisdictionCode: "CA-BC" },
  { jurisdictionCode: "unknown", incorporationNumber: "S1234" },
  { jurisdictionCode: "unknown", entityType: "society", actFormedUnder: "societies_act" },
  { jurisdictionCode: "unknown", entityType: "corporation__business_", actFormedUnder: "canada_business_corporations_act" },
  { jurisdictionCode: "unreviewed_jurisdiction", entityType: "society", actFormedUnder: "societies_act" },
]) {
  const baseline = bylawBaselineForOrganization(override, "explicit-unknown");
  assert.equal(legalGovernanceProfile(override), undefined, "An explicit unknown jurisdiction must not acquire an inferred legal profile");
  assert.equal(baseline.governanceAutomationBlocked, true);
  assert.equal(baseline.quorumDenominator, "review_required");
  assert.match(baseline.authorityCitation, /No reviewed legal authority/);
  const stored = contextualBylawRules(override, "explicit-unknown", { status: "Active", governanceAutomationBlocked: false, jurisdictionCode: "CA-BC" });
  assert.equal(stored.governanceAutomationBlocked, true, "Stored draft rules cannot undo an explicit jurisdiction-review requirement");
  assert.equal(stored.quorumDenominator, "review_required");
}
assert.equal(bylawBaselineForOrganization({ incorporationNumber: "S1234", name: "Legacy BC society" }, "legacy").governanceAutomationBlocked, false);
assert.equal(bylawBaselineForOrganization({ entityType: "corporation__business_", homeJurisdiction: "federal__canada_" }, "alias").jurisdictionCode, "CA-FED-CBCA");
const society = bylawBaselineForOrganization({ entityType: "society", jurisdictionCode: "CA-BC" }, "society");
assert.equal(society.quorumType, "fixed");
assert.equal(society.quorumValue, 3, "statutory society fallback cannot assert adopted model's 10% clause");
assert.equal(society.isFallback, true);
const bc = bylawBaselineForOrganization({ entityType: "corporation__business_", jurisdictionCode: "CA-BC" }, "bc");
assert.equal(bc.generalNoticeMinDays, 21);
assert.equal(bc.quorumValue, 2);
assert.equal(bc.quorumDenominator, "legal_shareholders");
assert.equal(bc.noticeUsesCalendarMonthsMaximum, true);
const fed = bylawBaselineForOrganization({ entityType: "corporation__business_", jurisdictionCode: "CA-FED-CBCA" }, "fed");
assert.equal(fed.generalNoticeMinDays, 21);
assert.equal(fed.quorumDenominator, "issued_voting_shares");
assert.equal(fed.quorumRequiresLegalRegister, true);
const ontario = bylawBaselineForOrganization({ entityType: "corporation__business_", jurisdictionCode: "CA-ON-OBCA" }, "on");
assert.equal(ontario.governanceAutomationBlocked, false, "The reviewed Ontario corporate profile is now supported");
assert.equal(ontario.quorumRequiresLegalRegister, true);
assert.equal(bylawBaselineForOrganization({ entityType: "corporation__business_", jurisdictionCode: "CA-ON-OBCA", actFormedUnder: "unreviewed_act" }, "on-unknown-act").governanceAutomationBlocked, true);
assert.equal(clearNoticeDays("2026-07-13", "2026-07-27"), 13);
assert.equal(clearNoticeDays("2026-07-13", "2026-07-28"), 14);
assert.equal(clearNoticeDays("2026-03-07", "2026-03-23"), 15, "DST does not reduce full calendar days");
assert.equal(clearNoticeDays("2026-02-30", "2026-03-23"), null);
assert.equal(noticeWindowSatisfied("2026-07-13T23:59:00", "2026-07-27T09:00:00", 14, 60, society), false);
assert.equal(noticeWindowSatisfied("2026-07-13T23:59:00", "2026-07-28T09:00:00", 14, 60, society), true);
assert.equal(noticeWindowSatisfied("2026-01-01T09:00:00", "2026-03-02T09:00:00", 21, 62, bc), false, "two calendar months cannot be replaced with 62 days");
assert.equal(noticeWindowSatisfied("2026-01-31T09:00:00", "2026-03-31T09:00:00", 21, 62, bc), true);
assert.equal(contextualBylawRules({ entityType: "corporation__business_", jurisdictionCode: "CA-FED-CBCA" }, "fed", { _id: "old", status: "Active", quorumType: "percentage", quorumValue: 10 }).quorumRequiresLegalRegister, true, "legacy corporation society-style rules cannot confer member-headcount quorum");
assert.equal(computedQuorumMet({ presentCount: 100, required: 3, requiresLegalRegister: true }), null, "workspace attendance cannot establish corporate share electorate quorum");
const client = new StaticConvexClient({ databaseName: `jurisdiction-baselines-${Date.now()}`, seed: { societies: [] } });
const created = await client.mutation("society:createWorkspace", { name: "Federal quorum evidence test", incorporationDate: "2026-01-01", incorporationNumber: "123", fiscalYearEnd: "12-31", entityType: "corporation__business_", jurisdictionCode: "CA-FED-CBCA", actFormedUnder: "canada_business_corporations_act" });
let active = await client.query("bylawRules:getActive", { societyId: created.societyId });
assert.equal(active.generalNoticeMinDays, 21);
assert.equal(active.quorumRequiresLegalRegister, true);
assert.equal(active.isFallback, true);
const meetingId = await client.mutation("meetings:create", { societyId: created.societyId, type: "AGM", title: "Shareholders AGM", scheduledAt: "2027-06-01T12:00:00Z", electronic: false, status: "Scheduled", attendeeIds: [] });
const meeting = await client.query("meetings:get", { id: meetingId });
assert.equal(meeting.quorumRequired, undefined, "corporation quorum remains unknown without legal share electorate, regardless of app member count");
assert.match(meeting.quorumSourceLabel, /CBCA/);
await assert.rejects(client.mutation("bylawRules:resetToDefault", { societyId: created.societyId }), /corporation|articles/i, "main corporation reset guard is preserved");
const societyWorkspace = await client.mutation("society:createWorkspace", { name: "BC statutory baseline evidence test", incorporationDate: "2026-01-01", incorporationNumber: "S123", fiscalYearEnd: "12-31", entityType: "society", jurisdictionCode: "CA-BC", actFormedUnder: "societies_act" });
await client.mutation("bylawRules:resetToDefault", { societyId: societyWorkspace.societyId });
active = await client.query("bylawRules:getActive", { societyId: societyWorkspace.societyId });
assert.equal(active.isFallback, true);
assert.equal(active._id, undefined, "reset does not manufacture adopted operative bylaws");
const history = await client.query("bylawRules:list", { societyId: societyWorkspace.societyId });
assert.equal(history.at(-1).status, "Baseline", "reset has an audit marker");
console.log("Jurisdiction-aware bylaw baselines passed: empty legacy compatibility, explicit-unknown overrides blocked, share-quorum gates, reset provenance and clear/calendar-month notice boundaries.");
