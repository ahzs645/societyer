/**
 * Gate: per-body quorum rules entered from the interface (committee terms of
 * reference, board and committee-default rules in the bylaw rule set) and
 * committee creation validation. Synthetic fixtures only.
 */
import assert from "node:assert/strict";
import { cleanQuorumRule, describeQuorumRule, quorumRuleProblems, resolveMeetingQuorumRule } from "../shared/bodyQuorum";
import { requiredQuorumForMeeting } from "../shared/bodyQuorumPortable";
import { PORTABLE_FUNCTIONS } from "../shared/functions/registry";
import { PortableRuntime } from "../shared/portable/define";
import { MemoryDb } from "../shared/portable/memoryDb";
import { makeCapabilities } from "../shared/portable/capabilities";
import { bylawRuleEffectiveDay, bylawRuleSelectionDay, selectBylawRuleSetForDay } from "../shared/bylawRuleSelection";

// --- pure helpers -------------------------------------------------------------
assert.equal(describeQuorumRule({ quorumType: "majority", quorumMinimumCount: 3 }, "committee"), "Majority of committee members (at least 3)");
assert.equal(describeQuorumRule({ quorumType: "majority" }, "board"), "Majority of directors in office");
assert.equal(describeQuorumRule({ quorumType: "percentage", quorumValue: 60, countBasis: "directors_in_office" }), "60% of directors in office");
assert.equal(describeQuorumRule({ quorumType: "fixed", quorumValue: 5 }), "5 present");
assert.equal(describeQuorumRule({ quorumType: "all_members" }, "committee"), "All committee members");
assert.equal(describeQuorumRule(null), "Not set");

assert.deepEqual(quorumRuleProblems(null), []);
assert.deepEqual(quorumRuleProblems({ quorumType: "majority" }), []);
assert.ok(quorumRuleProblems({ quorumType: "fixed" }).some((p) => /how many/.test(p)));
assert.ok(quorumRuleProblems({ quorumType: "fixed", quorumValue: 2.5 }).some((p) => /whole number/.test(p)));
assert.ok(quorumRuleProblems({ quorumType: "percentage", quorumValue: 150 }).some((p) => /exceed 100/.test(p)));
assert.ok(quorumRuleProblems({ quorumType: "percentage", quorumValue: Number.NaN }).some((p) => /above 0/.test(p)));
assert.ok(quorumRuleProblems({ quorumType: "majority", quorumMinimumCount: -1 }).some((p) => /minimum/.test(p)));
assert.ok(quorumRuleProblems({ quorumType: "sometimes" }).some((p) => /Choose/.test(p)));

assert.deepEqual(cleanQuorumRule({ quorumType: "fixed", quorumValue: 4, quorumMinimumCount: 3, countBasis: "committee_members", notes: "  " }), { quorumType: "fixed", quorumValue: 4 }, "fixed keeps only the count");
assert.deepEqual(cleanQuorumRule({ quorumType: "all_members", quorumValue: 4, quorumMinimumCount: 2 }), { quorumType: "all_members" });
assert.deepEqual(cleanQuorumRule({ quorumType: "majority", quorumMinimumCount: 3, notes: " TOR s.4 " }), { quorumType: "majority", quorumMinimumCount: 3, notes: "TOR s.4" });

// --- handlers -----------------------------------------------------------------
const db = new MemoryDb({
  seed: {
    societies: [{ _id: "soc", name: "Synthetic Quorum Society", jurisdictionCode: "CA-BC", entityType: "society", incorporationDate: "2018-02-01", isMemberFunded: false }],
    users: [{ _id: "owner", societyId: "soc", role: "Owner", status: "Active", displayName: "Owner" }],
    directors: ["A", "B", "C", "D", "E"].map((letter, index) => ({ _id: `d${index}`, societyId: "soc", firstName: letter, lastName: "Example", position: "Director", isBCResident: true, status: "Active", consentOnFile: true, termStart: "2024-06-01" })),
  },
});
const runtime = new PortableRuntime({ db, capabilities: makeCapabilities({}), principalProvider: () => ({ kind: "user" as const, runtime: "test" as const, assurance: "trusted-workspace" as const, subject: "owner", userId: "owner", societyId: "soc" }) }).registerAll(PORTABLE_FUNCTIONS);

await assert.rejects(() => runtime.runMutation("committees:create", { societyId: "soc", name: "   ", cadence: "Monthly", color: "#000" }), /needs a name/);
const opsId = await runtime.runMutation("committees:create", { societyId: "soc", name: "  Operations Committee ", cadence: "Monthly", color: "#000" }) as string;
assert.equal((await db.get(opsId) as any).name, "Operations Committee", "name is trimmed");
for (const name of ["Ana", "Ben", "Cy", "Di"]) await db.insert("committeeMembers", { societyId: "soc", committeeId: opsId, name, role: "Member" });

await assert.rejects(() => runtime.runMutation("committees:update", { id: opsId, patch: { quorumRule: { quorumType: "percentage", quorumValue: 140 } } }), /cannot exceed 100/);
await runtime.runMutation("committees:update", { id: opsId, patch: { quorumRule: cleanQuorumRule({ quorumType: "majority", quorumMinimumCount: 3, notes: "TOR 2019" }) } });
const committeeQuorum = await requiredQuorumForMeeting({ db } as any, {}, { societyId: "soc", meetingType: "Committee", committeeId: opsId });
assert.equal(committeeQuorum.required, 3, "majority of 4 members is 3");
assert.match(committeeQuorum.label ?? "", /Operations Committee quorum rule/);
await runtime.runMutation("committees:update", { id: opsId, patch: { clearQuorumRule: true } });
assert.equal((await db.get(opsId) as any).quorumRule, undefined, "the rule can be cleared");

// Bylaw rules: board and committee-default rules are stored and carried by the next version.
const baseRules = {
  societyId: "soc", generalNoticeMinDays: 14, generalNoticeMaxDays: 60, allowElectronicMeetings: true, allowHybridMeetings: true, allowElectronicVoting: false, allowProxyVoting: false, proxyHolderMustBeMember: true, proxyLimitPerGrantorPerMeeting: 1, quorumType: "fixed", quorumValue: 3, memberProposalThresholdPct: 5, memberProposalMinSignatures: 2, memberProposalLeadDays: 7, requisitionMeetingThresholdPct: 10, annualReportDueDaysAfterMeeting: 30, requireAgmFinancialStatements: true, requireAgmElections: true, ballotIsAnonymous: true, voterMustBeMemberAtRecordDate: true, inspectionMemberRegisterByMembers: true, inspectionMemberRegisterByPublic: false, inspectionDirectorRegisterByMembers: true, inspectionCopiesAllowed: true, ordinaryResolutionThresholdPct: 50, specialResolutionThresholdPct: 66.67, unanimousWrittenSpecialResolution: true,
};
await assert.rejects(() => runtime.runMutation("bylawRules:upsertActive", { ...baseRules, effectiveFromISO: "2024-01-01T00:00:00.000Z", bodyQuorumRules: [{ body: "board", quorumType: "fixed" }] }), /quorumValue must be positive/);
await runtime.runMutation("bylawRules:upsertActive", { ...baseRules, effectiveFromISO: "2024-01-01T00:00:00.000Z", bodyQuorumRules: [{ body: "board", quorumType: "majority", countBasis: "directors_in_office" }, { body: "committee", quorumType: "fixed", quorumValue: 2 }] });
const active: any = await runtime.runQuery("bylawRules:getActive", { societyId: "soc" });
assert.equal(active.bodyQuorumRules.length, 2);
const board = resolveMeetingQuorumRule(active, { type: "Board" });
assert.equal(board?.source, "body_rule");
const boardQuorum = await requiredQuorumForMeeting({ db } as any, active, { societyId: "soc", meetingType: "Board" });
assert.equal(boardQuorum.required, 3, "majority of 5 directors");
const committeeDefault = await requiredQuorumForMeeting({ db } as any, active, { societyId: "soc", meetingType: "Committee", committeeId: opsId });
assert.equal(committeeDefault.required, 2, "committee default applies when the committee has no rule");

// "Reset to defaults" then "Save new version" on the same day: the saved
// version is not "backdated" against the draft baseline, and it governs.
{
  const fresh = new MemoryDb({
    seed: {
      societies: [{ _id: "soc3", name: "Synthetic Fresh Society", jurisdictionCode: "CA-BC", entityType: "society", isMemberFunded: false }],
      users: [{ _id: "owner3", societyId: "soc3", role: "Owner", status: "Active", displayName: "Owner" }],
    },
  });
  const run = new PortableRuntime({ db: fresh, capabilities: makeCapabilities({}), principalProvider: () => ({ kind: "user" as const, runtime: "test" as const, assurance: "trusted-workspace" as const, subject: "owner3", userId: "owner3", societyId: "soc3" }) }).registerAll(PORTABLE_FUNCTIONS);
  await run.runMutation("bylawRules:resetToDefault", { societyId: "soc3" });
  const baseline = (fresh.dump("bylawRuleSets") as any[])[0];
  assert.equal(baseline.status, "Baseline");
  // The editor saves "today" as the society's local day at midnight UTC.
  const todayMidnight = `${bylawRuleEffectiveDay(baseline.effectiveFromISO, "America/Vancouver")}T00:00:00.000Z`;
  await run.runMutation("bylawRules:upsertActive", { ...baseRules, societyId: "soc3", quorumValue: 4, effectiveFromISO: todayMidnight });
  const governing: any = await run.runQuery("bylawRules:getActive", { societyId: "soc3" });
  assert.equal(governing.version, 2, "the society's saved version governs over the same-day baseline");
  assert.equal(governing.quorumValue, 4);
  const dashboardRules: any = await run.runQuery("dashboard:summary", { societyId: "soc3" });
  assert.ok(!JSON.stringify(dashboardRules.complianceFlags ?? []).includes("Bylaw rule set not configured"), "dashboard reads the saved version");
}

// A rule effective June 1 governs from the meeting's local June 1, not from
// June 1 UTC: two meetings on the same Pacific evening get the same rule.
{
  assert.equal(bylawRuleEffectiveDay("2025-06-01T00:00:00.000Z", "America/Vancouver"), "2025-06-01", "midnight UTC is the chosen day");
  assert.equal(bylawRuleEffectiveDay("2025-06-01", "America/Vancouver"), "2025-06-01");
  assert.equal(bylawRuleEffectiveDay("2025-06-01T03:30:00.000Z", "America/Vancouver"), "2025-05-31", "a click instant is its local day");
  assert.equal(bylawRuleSelectionDay("2025-06-01T01:00:00.000Z", "America/Vancouver"), "2025-05-31");
  assert.equal(bylawRuleSelectionDay({ scheduledAt: "2025-06-01T01:00:00.000Z", timeZone: "America/Toronto" }, "America/Vancouver"), "2025-05-31");
  assert.equal(bylawRuleSelectionDay({ scheduledAt: "2025-06-01T04:30:00.000Z", timeZone: "America/Toronto" }, "America/Vancouver"), "2025-06-01", "the meeting's own zone wins");
  assert.equal(bylawRuleSelectionDay("2025-06-01T12:00:00.000Z", "Pacific/Kiritimati"), "2025-06-01", "a date-only placeholder keeps its day");
  const versions = [
    { version: 1, status: "Archived", effectiveFromISO: "2020-01-01T00:00:00.000Z" },
    { version: 2, status: "Active", effectiveFromISO: "2025-06-01T00:00:00.000Z" },
    { version: 3, status: "Draft", effectiveFromISO: "2025-05-01T00:00:00.000Z" },
  ];
  assert.equal(selectBylawRuleSetForDay(versions, "2025-05-31")?.version, 1);
  assert.equal(selectBylawRuleSetForDay(versions, "2025-06-01")?.version, 2);
  assert.equal(selectBylawRuleSetForDay(versions, undefined)?.version, 2, "an unparseable date keeps every version eligible");

  const pacific = new MemoryDb({
    seed: {
      societies: [{ _id: "soc4", name: "Synthetic Pacific Society", jurisdictionCode: "CA-BC", entityType: "society", isMemberFunded: false }],
      users: [{ _id: "owner4", societyId: "soc4", role: "Owner", status: "Active", displayName: "Owner" }],
    },
  });
  const run = new PortableRuntime({ db: pacific, capabilities: makeCapabilities({}), principalProvider: () => ({ kind: "user" as const, runtime: "test" as const, assurance: "trusted-workspace" as const, subject: "owner4", userId: "owner4", societyId: "soc4" }) }).registerAll(PORTABLE_FUNCTIONS);
  await run.runMutation("bylawRules:upsertActive", { ...baseRules, societyId: "soc4", quorumValue: 3, effectiveFromISO: "2020-01-01T00:00:00.000Z" });
  await run.runMutation("bylawRules:upsertActive", { ...baseRules, societyId: "soc4", quorumValue: 5, effectiveFromISO: "2025-06-01T00:00:00.000Z" });
  const required = async (scheduledAt: string) => {
    const meetingId = await run.runMutation("meetings:create", { societyId: "soc4", type: "AGM", title: `AGM ${scheduledAt}`, scheduledAt, electronic: false, status: "Scheduled" }) as string;
    const meeting = await pacific.get(meetingId) as { quorumRequired?: number };
    const minutes = (pacific.dump("minutes") as { meetingId: string; quorumRequired?: number }[]).find((row) => row.meetingId === meetingId);
    assert.equal(minutes?.quorumRequired, meeting.quorumRequired, "meeting and minutes snapshots agree");
    return meeting.quorumRequired;
  };
  assert.equal(await required("2025-05-31T23:00:00.000Z"), 3, "4 p.m. Pacific on May 31 keeps the old rule");
  assert.equal(await required("2025-06-01T01:00:00.000Z"), 3, "6 p.m. Pacific on May 31 keeps the old rule too");
  assert.equal(await required("2025-06-01T17:00:00.000Z"), 5, "10 a.m. Pacific on June 1 uses the new rule");
  assert.equal(await required("2025-06-01T12:00:00.000Z"), 5, "a date-only June 1 meeting uses the new rule");
  const formRules = await run.runQuery("bylawRules:getForDate", { societyId: "soc4", dateISO: "2025-06-01T01:00:00.000Z" }) as { quorumValue?: number };
  assert.equal(formRules.quorumValue, 3, "the meeting form reads the same rule");
}

console.log("governance quorum checks passed");
