// Dashboard dismissals gate. Whether a finding may be dismissed depends on
// what it rests on, not its level (shared/dashboardFindingPolicy.ts): only
// recommendations at warn/info can be dismissed; statutory, bylaw and
// internal-policy findings (and any unclassified rule) can be acknowledged,
// which keeps them on the dashboard and in every count. The server looks each
// item up itself, so neither mutation path dismisses a requirement whatever
// level the client sends. Dismissals and acknowledgements hold only while the
// finding's subject (rule version + affected records) is unchanged; rows
// dismissed before a rule became protected are ignored and kept as they were.
import assert from "node:assert/strict";
import type { PortableDoc, PortableMutationCtx } from "../shared/portable/ctx";
import {
  activeAcknowledgement,
  activeDismissal,
  activeSnooze,
  isBindingSeverity,
  isRecommendationLevel,
  normalizeDismissalReason,
  normalizeSnoozeUntil,
  nudgeableFindings,
  snoozedLast,
} from "../shared/dashboardDismissals";
import {
  continuityFindingPolicy,
  decisionWaivesFinding,
  findingPolicy,
  findingSubjectKey,
  isClassifiedFinding,
  isDismissableFinding,
  isProtectedAtEveryLevel,
  OBLIGATION_RECOMMENDATION_RULE_IDS,
  obligationRuleId,
} from "../shared/dashboardFindingPolicy";
import { todayDateOnly } from "../shared/dateOnly";
import { bcSocietiesDashboardComplianceRulePack, type DashboardComplianceFlag } from "../shared/dashboardComplianceRules";
import { LEGAL_GOVERNANCE_PROFILES } from "../shared/legalGovernanceProfiles";
import { PRIVACY_LAWS } from "../shared/privacyRuleProfiles";
import type { ContinuityCheck } from "../src/features/gaps/ContinuityChecksCard";

// ---- policy: requirement basis, independent of level
{
  const mustBeProtected = [
    "BC-SOC-DIRECTOR-CONSENT",
    "BC-SOC-CONSTITUTION-EVIDENCE",
    "BC-SOC-BYLAWS-EVIDENCE",
    "PIPA-POLICY-DOCUMENTED",
    "PIPA-POLICY-EVIDENCE",
    "BC-SOC-DIRECTORS-MIN",
    "BC-SOC-DIRECTORS-BC-RESIDENT",
    "CONTINUITY-DIRECTOR-CONSENT",
    "CONTINUITY-AGM-THIS-YEAR",
    "CONTINUITY-ANNUAL-REPORT-FILED",
    "home:compliance-ca-bc-societies-annual-report:2026-07-31",
  ];
  for (const corporate of LEGAL_GOVERNANCE_PROFILES.filter((profile) => profile.kind === "corporation")) {
    for (const suffix of ["DIRECTORS-MIN", "DIRECTOR-CONSENT", "DIRECTORS-RESIDENCY", "CLASSIFICATION", "GOVERNING-DOCUMENTS"]) {
      mustBeProtected.push(`LEGAL-${corporate.id}-${suffix}`);
    }
  }
  for (const lawId of Object.keys(PRIVACY_LAWS)) mustBeProtected.push(`PRIVACY-${lawId}-OFFICER`, `PRIVACY-${lawId}-POLICY`);
  for (const ruleId of mustBeProtected) {
    const policy = findingPolicy(ruleId);
    assert.ok(policy.protected && policy.basis && policy.basis !== "recommendation", `${ruleId} is a requirement`);
    assert.equal(isDismissableFinding(policy, "warn"), false, `${ruleId} is not dismissable at warn`);
    assert.equal(isDismissableFinding(policy, "info"), false, `${ruleId} is not dismissable at info`);
  }
  assert.equal(findingPolicy("LEGAL-bc_company-DIRECTOR-CONSENT").subject, "directors");
  // Level-dependent basis: a governing document not identified (warn) is
  // statutory; the "on record, currentness not verified" note (info) is a
  // recommendation held to the identified copy. No level = the stricter basis.
  for (const [ruleId, field] of [["BC-SOC-CONSTITUTION-EVIDENCE", "constitutionDocId"], ["BC-SOC-BYLAWS-EVIDENCE", "bylawsDocId"]] as const) {
    assert.equal(findingPolicy(ruleId, "warn").basis, "statutory");
    assert.ok(!isDismissableFinding(findingPolicy(ruleId, "warn"), "warn"), `${ruleId} at warn is protected`);
    const note = findingPolicy(ruleId, "info");
    assert.equal(note.basis, "recommendation", `${ruleId} at info is a recommendation`);
    assert.ok(isDismissableFinding(note, "info"));
    assert.equal(note.subject, "governingCopy");
    assert.equal(note.evidenceField, field);
    assert.ok(!isProtectedAtEveryLevel(ruleId), `${ruleId} can be dismissed at some level`);
  }
  assert.ok(findingPolicy("PIPA-POLICY-DOCUMENTED", "info").protected, "the privacy note without a review stays a requirement");
  assert.ok(isProtectedAtEveryLevel("PIPA-POLICY-DOCUMENTED") && isProtectedAtEveryLevel("SOMETHING-NEW"));
  // The corporate governing-documents rule has no info-level note; it stays statutory.
  assert.ok(findingPolicy("LEGAL-cbca-GOVERNING-DOCUMENTS", "info").protected);
  for (const ruleId of ["PRIVACY-APPLICABILITY", "BYLAW-RULE-SET-CONFIGURED", "FINANCE-CONTROL-SINGLE-APPROVAL", "CONTINUITY-MINUTES-APPROVED"]) {
    const policy = findingPolicy(ruleId);
    assert.equal(policy.basis, "recommendation", `${ruleId} is a recommendation`);
    assert.ok(isDismissableFinding(policy, "warn") && isDismissableFinding(policy, "info"));
    assert.equal(isDismissableFinding(policy, "err"), false, "a recommendation at err still stays");
  }
  assert.equal(findingPolicy("FINANCE-CONTROL-SIGNING-AUTHORITY").basis, "internal_policy");
  assert.ok(findingPolicy("FINANCE-CONTROL-SIGNING-AUTHORITY").protected, "an adopted internal policy is not dismissable");
  // Unknown ids fail closed.
  const unknown = findingPolicy("SOMETHING-NEW");
  assert.ok(unknown.protected && unknown.basis === undefined && !isClassifiedFinding("SOMETHING-NEW"));
  // Every rule in the BC pack is classified.
  for (const rule of bcSocietiesDashboardComplianceRulePack.rules) assert.ok(isClassifiedFinding(rule.id), `${rule.id} has a requirement basis`);
  // A continuity expectation marked binding makes a recommendation check a requirement.
  assert.equal(continuityFindingPolicy("CONTINUITY-MINUTES-APPROVED", "bylaw").basis, "bylaw");
  assert.ok(continuityFindingPolicy("CONTINUITY-MINUTES-APPROVED", "bylaw").protected);
  assert.ok(!continuityFindingPolicy("CONTINUITY-MINUTES-APPROVED", "practice").protected);
  assert.ok(continuityFindingPolicy("CONTINUITY-AGM-THIS-YEAR", "practice").protected, "a practice expectation never loosens a statutory check");
  // Obligation decisions: only a dismissed recommendation leaves the counts.
  const occurrence = "home:compliance-ca-bc-societies-annual-report:2025-07-31";
  assert.equal(decisionWaivesFinding(occurrence, { status: "dismissed" }), false, "a dismissed statutory occurrence still counts");
  assert.equal(decisionWaivesFinding(occurrence, { status: "acknowledged" }), false);
  assert.equal(decisionWaivesFinding("CONTINUITY-MINUTES-APPROVED", { status: "dismissed" }), true);
  // Obligation occurrences: good-practice reviews are recommendations per
  // occurrence; filings, deadlines and anything citing a section are statutory.
  for (const ruleId of OBLIGATION_RECOMMENDATION_RULE_IDS) {
    for (const key of [`home:${ruleId}:2026-03-31`, `registration:reg-on:${ruleId}:2026-03-31`, ruleId]) {
      assert.equal(obligationRuleId(key), ruleId);
      assert.equal(findingPolicy(key).basis, "recommendation", `${key} is a recommendation`);
    }
    assert.equal(decisionWaivesFinding(`home:${ruleId}:2026-03-31`, { status: "dismissed" }), true, `${ruleId}: a dismissed occurrence leaves the counts`);
  }
  for (const key of [
    "home:compliance-ca-fed-cbca-annual-return-window:2026-06-30",
    "home:compliance-ca-bc-company-records-review:2026-03-31",
    "home:compliance-ca-fed-cbca-isc-annual-review:2026-03-31",
    "home:compliance-ca-bc-societies-agm-planning:2026-12-31",
    "registration:reg-on:compliance-ca-on-extra-provincial-initial-return:2026-03-03",
    "home:compliance-something-new:2026-01-01",
  ]) {
    assert.equal(findingPolicy(key).basis, "statutory", `${key} is statutory`);
    assert.equal(decisionWaivesFinding(key, { status: "dismissed" }), false);
  }

  // Subject keys: order-free, versioned, and different for different records.
  assert.equal(findingSubjectKey("BC-SOC-DIRECTOR-CONSENT", ["director:a", "director:b"]), findingSubjectKey("BC-SOC-DIRECTOR-CONSENT", ["director:b", "director:a"]));
  assert.notEqual(findingSubjectKey("BC-SOC-DIRECTOR-CONSENT", ["director:a"]), findingSubjectKey("BC-SOC-DIRECTOR-CONSENT", ["director:a", "director:c"]));
  assert.match(findingSubjectKey("BC-SOC-DIRECTOR-CONSENT", ["x"]), /^BC-SOC-DIRECTOR-CONSENT@v1:[0-9a-f]{8}$/);

  assert.ok(isRecommendationLevel("warn") && isRecommendationLevel("info"));
  assert.ok(!isRecommendationLevel("err") && !isRecommendationLevel("ok"));
  assert.ok(isBindingSeverity("statutory") && isBindingSeverity("bylaw") && !isBindingSeverity("practice") && !isBindingSeverity(undefined));
  // Snoozes end on their date, with a new subject, or when the level rises.
  const snoozeRow = { snoozedUntilISO: "2026-12-05", snoozedByName: "Mina Patel", snoozedSubjectKey: "K1", snoozedLevel: "warn" };
  assert.deepEqual(activeSnooze(snoozeRow, { level: "warn", subjectKey: "K1" }, "2026-11-21"), { untilISO: "2026-12-05", snoozedByName: "Mina Patel" });
  assert.ok(activeSnooze(snoozeRow, { level: "info", subjectKey: "K1" }, "2026-11-21"), "a finding that eases keeps its snooze");
  assert.equal(activeSnooze(snoozeRow, { level: "warn", subjectKey: "K1" }, "2026-12-05"), undefined, "ends on its date");
  assert.equal(activeSnooze(snoozeRow, { level: "warn", subjectKey: "K2" }, "2026-11-21"), undefined, "ends with a new subject");
  assert.equal(activeSnooze(snoozeRow, { level: "err", subjectKey: "K1" }, "2026-11-21"), undefined, "ends when it escalates");
  assert.equal(activeSnooze({ ...snoozeRow, snoozedLevel: undefined }, { level: "info", subjectKey: "K1" }, "2026-11-21"), undefined, "a snooze without a level holds nothing");
  assert.throws(() => normalizeSnoozeUntil("2026-11-21", "2026-11-21"), /after today/);
  assert.throws(() => normalizeSnoozeUntil("2026-02-30", "2026-01-01"), /date/);
  assert.throws(() => normalizeSnoozeUntil("2028-01-01", "2026-11-21"), /within a year/);
  assert.equal(normalizeSnoozeUntil("2026-12-21", "2026-11-21"), "2026-12-21");
  assert.deepEqual(snoozedLast([{ id: 1, snooze: {} }, { id: 2 }, { id: 3, snooze: {} }, { id: 4 }]).map((item) => item.id), [2, 4, 1, 3]);

  const row = { status: "dismissed", flagLevel: "warn", dismissedAtISO: "2026-11-20T10:00:00.000Z", dismissedByName: "Mina Patel", dismissalReason: "Handled offline", dismissedSubjectKey: "K1" };
  assert.deepEqual(activeDismissal(row, { level: "warn", dismissable: true, subjectKey: "K1" }), { level: "warn", dismissedAtISO: row.dismissedAtISO, dismissedByName: "Mina Patel", reason: "Handled offline" });
  assert.equal(activeDismissal(row, { level: "warn", dismissable: true, subjectKey: "K2" }), undefined, "a new subject is not hidden by an old dismissal");
  assert.equal(activeDismissal({ ...row, dismissedSubjectKey: undefined }, { level: "warn", dismissable: true, subjectKey: "K1" }), undefined, "a row without a subject key hides nothing");
  assert.equal(activeDismissal(row, { level: "err", dismissable: false, subjectKey: "K1" }), undefined, "an item that escalated shows again");
  assert.equal(activeDismissal(row, { level: "info", dismissable: true, subjectKey: "K1" }), undefined, "a dismissal at another level no longer applies");
  assert.equal(activeDismissal({ ...row, status: "open" }, { level: "warn", dismissable: true, subjectKey: "K1" }), undefined);
  assert.equal(activeDismissal(row, { level: "warn", dismissable: false, subjectKey: "K1" }), undefined, "a protected item is never hidden");
  assert.deepEqual(activeAcknowledgement({ acknowledgedAtISO: "2026-11-21", acknowledgedByName: "Mina", acknowledgedSubjectKey: "K1" }, { subjectKey: "K1" }), { acknowledgedAtISO: "2026-11-21", acknowledgedByName: "Mina" });
  assert.equal(activeAcknowledgement({ acknowledgedAtISO: "2026-11-21", acknowledgedSubjectKey: "K1" }, { subjectKey: "K2" }), undefined);
  assert.equal(normalizeDismissalReason("   "), undefined);
  assert.equal(normalizeDismissalReason("x".repeat(900))?.length, 500);
}

// ---- portable handlers on the demo seed
const { tables, society } = await import("../src/lib/staticConvexFixtures");
const { MemoryDb } = await import("../shared/portable/memoryDb");
const { makeCapabilities } = await import("../shared/portable/capabilities");
const dashboard = await import("../shared/functions/dashboard");
const continuity = await import("../shared/functions/continuity");
const remediation = await import("../shared/functions/dashboardRemediation");
const obligations = await import("../shared/functions/complianceObligations");

const seed: Record<string, PortableDoc[]> = {};
for (const [key, rows] of Object.entries(tables as Record<string, PortableDoc[]>)) seed[key] = JSON.parse(JSON.stringify(rows));
seed.users = seed.users.map((user) => ({ ...user, status: "Active", authIssuer: "https://issuer.test", authSubject: `sub-${user._id}` }));
seed.societies = [JSON.parse(JSON.stringify(society)), { _id: "other_society", name: "Elsewhere Ltd", entityType: "corporation" }];
const db = new MemoryDb({ seed });
const S = String(seed.users[0].societyId);
const owner = seed.users.find((user) => user.role === "Owner")!;
const ctx: PortableMutationCtx = {
  db,
  principal: { kind: "user", runtime: "test", assurance: "trusted-workspace", subject: `sub-${owner._id}`, issuer: "https://issuer.test", userId: owner._id, societyId: S },
  capabilities: makeCapabilities({}),
  runQuery: async () => { throw new Error("nested"); },
  runMutation: async () => { throw new Error("nested"); },
};
const flags = async (): Promise<DashboardComplianceFlag[]> => (await dashboard.summaryPortable(ctx, { societyId: S })).complianceFlags;
const checks = async (): Promise<ContinuityCheck[]> => (await continuity.dashboardChecksPortable(ctx, { societyId: S })).checks;
const flagById = async (ruleId: string) => (await flags()).find((row) => row.ruleId === ruleId);
const outstanding = (rows: DashboardComplianceFlag[]) => rows.filter((row) => !row.dismissal && row.level !== "ok" && row.level !== "info").length;
const remediationRows = async () => (await db.query("complianceRemediations").collect()) as (PortableDoc & Record<string, unknown>)[];

const demoFlags = await flags();
const demoChecks = await checks();
for (const flag of demoFlags) {
  const policy = findingPolicy(flag.ruleId, flag.level);
  assert.equal(flag.requirementBasis, policy.basis, `${flag.ruleId}: basis surfaced`);
  assert.equal(flag.dismissable, isDismissableFinding(policy, flag.level), `${flag.ruleId}: only recommendations at warn/info are dismissable`);
  assert.ok(flag.subjectKey?.startsWith(`${flag.ruleId}@v`), `${flag.ruleId}: has a subject key`);
  assert.equal(flag.dismissal, undefined, `${flag.ruleId}: nothing is dismissed in the seed`);
  if (policy.protected && flag.level !== "ok" && flag.level !== "info") {
    assert.ok(flag.remediationActions.some((action) => action.intent === "createComplianceReviewTask" || action.intent === "createPrivacyReviewTask"), `${flag.ruleId}: a requirement can get a follow-up`);
  }
}
for (const check of demoChecks) {
  const policy = continuityFindingPolicy(check.id, check.requirement);
  assert.equal(check.requirementBasis, policy.basis);
  assert.equal(check.dismissable, isDismissableFinding(policy, check.level), `${check.id}: dismissable only as a recommendation`);
}
if (process.env.DASHBOARD_DISMISSALS_VERBOSE) {
  console.log(demoFlags.map((flag) => `flag ${flag.ruleId} ${flag.level} basis=${flag.requirementBasis ?? "-"} dismissable=${flag.dismissable}`).join("\n"));
  console.log(demoChecks.map((check) => `check ${check.id} ${check.level} basis=${check.requirementBasis ?? "-"} dismissable=${check.dismissable}`).join("\n"));
}

// ---- a protected warn cannot be dismissed through either mutation path
const consent = demoFlags.find((row) => row.ruleId === "BC-SOC-DIRECTOR-CONSENT");
assert.ok(consent && consent.level === "warn" && !consent.dismissable, "the demo has an amber, protected consent finding");
for (const flagLevel of ["warn", "info", undefined]) {
  await assert.rejects(
    remediation.dismissItemPortable(ctx, { societyId: S, ruleId: consent.ruleId, flagLevel, flagText: consent.text }),
    /requirement/,
    `dashboard dismiss refuses a statutory finding (client level ${flagLevel ?? "none"})`,
  );
}
await assert.rejects(
  remediation.dismissItemPortable(ctx, { societyId: S, ruleId: "CONTINUITY-DIRECTOR-CONSENT", flagLevel: "warn", flagText: "x" }),
  /requirement/,
  "the continuity twin is protected too",
);
await assert.rejects(
  obligations.dismissDecisionPortable(ctx, { societyId: S, ruleId: consent.ruleId, flagLevel: "info", flagText: consent.text, evidenceRequired: [] }),
  /requirement/,
  "the obligations path cannot dismiss a dashboard requirement either",
);
await assert.rejects(
  obligations.dismissDecisionPortable(ctx, { societyId: S, ruleId: "home:compliance-ca-bc-societies-annual-report:2025-07-31", flagLevel: "warn", flagText: "Annual report", evidenceRequired: [] }),
  /requirement/,
  "a statutory obligation occurrence cannot be dismissed",
);
assert.equal((await remediationRows()).length, 0, "refused dismissals write nothing");
assert.equal((await flagById(consent.ruleId))?.dismissal, undefined);

// ---- an old dismissal does not hide a newly protected finding; its row is kept
const legacyId = await db.insert("complianceRemediations", {
  societyId: S, ruleId: consent.ruleId, flagLevel: "warn", flagText: consent.text, evidenceRequired: [],
  status: "dismissed", dismissedAtISO: "2026-11-20T10:00:00.000Z", dismissedByName: "Mina Patel",
  dismissedSubjectKey: consent.subjectKey, createdAtISO: "2026-11-20T10:00:00.000Z", updatedAtISO: "2026-11-20T10:00:00.000Z",
});
const legacyBefore = JSON.stringify(await db.get(legacyId));
const reshown = await flagById(consent.ruleId);
assert.ok(reshown && !reshown.dismissal, "the protected finding shows despite the old dismissal row");
assert.equal(reshown.remediationStatus, undefined, "the ignored dismissal says nothing about the finding");
assert.equal(outstanding(await flags()), outstanding(demoFlags), "and it stays in the counts");
assert.equal(JSON.stringify(await db.get(legacyId)), legacyBefore, "the historical row is preserved untouched");
await db.delete(legacyId);

// ---- acknowledging a requirement records who/when and leaves it outstanding
await remediation.acknowledgeItemPortable(ctx, { societyId: S, ruleId: consent.ruleId, flagLevel: "warn", note: "  Chasing the signed form  " });
const acknowledged = (await flagById(consent.ruleId))!;
assert.equal(acknowledged.dismissal, undefined, "an acknowledgement hides nothing");
assert.equal(acknowledged.acknowledgement?.acknowledgedByName, "Mina Patel");
assert.equal(acknowledged.acknowledgement?.note, "Chasing the signed form");
assert.ok(acknowledged.acknowledgement?.acknowledgedAtISO);
assert.equal(acknowledged.remediationStatus, undefined, "a row made by an acknowledgement reports no workflow");
assert.equal(outstanding(await flags()), outstanding(demoFlags), "acknowledgement leaves the counts intact");
assert.ok((await db.query("activity").collect()).some((row) => row.action === "dashboard-item-acknowledged"));
await assert.rejects(
  remediation.acknowledgeItemPortable(ctx, { societyId: S, ruleId: consent.ruleId, flagLevel: "err" }),
  /changed/,
  "an acknowledgement of a stale level is refused",
);
// The consent continuity check stays on the dashboard too.
assert.ok((await checks()).some((row) => row.id === "CONTINUITY-DIRECTOR-CONSENT" && row.level === "warn" && !row.dismissal));

// Assign follow-up: the review task path keeps the finding outstanding and shows owner + due date.
const followUp = await remediation.createComplianceReviewTaskPortable(ctx, {
  societyId: S, ruleId: consent.ruleId, flagLevel: consent.level, flagText: consent.text, evidenceRequired: consent.evidenceRequired,
  assignee: "Jordan Lee", dueDate: "2026-12-15",
});
const owned = (await flagById(consent.ruleId))!;
assert.equal(owned.remediationStatus, "open");
assert.equal(owned.remediationTaskId, followUp.taskId);
assert.deepEqual(owned.followUp, { assignee: "Jordan Lee", dueDate: "2026-12-15" });
assert.ok(owned.acknowledgement, "the follow-up keeps the acknowledgement");
assert.equal(outstanding(await flags()), outstanding(demoFlags), "a follow-up leaves the counts intact");

// A newly affected director is a new subject: the acknowledgement no longer applies.
// Consent is derived from the register, so take a verified director's entries away.
const consentRows = await db.query("directorConsents").collect();
const otherDirector = seed.directors.find((row) =>
  row.status === "Active" && consentRows.some((entry) => String(entry.directorId) === String(row._id) && entry.reviewStatus === "Reviewed"))!;
assert.ok(otherDirector, "the demo has a director with a reviewed consent");
const removedConsents = consentRows.filter((entry) => String(entry.directorId) === String(otherDirector._id));
for (const entry of removedConsents) await db.delete(entry._id);
const widened = (await flagById(consent.ruleId))!;
assert.notEqual(widened.subjectKey, consent.subjectKey, "another affected director changes the subject");
assert.equal(widened.acknowledgement, undefined, "an acknowledgement covers only the directors it was made for");
const restoredConsentIds = new Map<string, string>();
for (const entry of removedConsents) {
  const { _id, _creationTime, ...rest } = entry as PortableDoc & { _creationTime?: number };
  void _creationTime;
  const previousId = rest.previousId ? restoredConsentIds.get(String(rest.previousId)) ?? rest.previousId : undefined;
  restoredConsentIds.set(String(_id), await db.insert("directorConsents", { ...rest, ...(previousId ? { previousId } : {}) }));
}
assert.ok((await flagById(consent.ruleId))!.acknowledgement, "back to the acknowledged subject");

// Withdrawing an acknowledgement keeps the row's review task.
assert.deepEqual(await remediation.restoreItemPortable(ctx, { societyId: S, ruleId: consent.ruleId }), { restored: true });
const withdrawn = (await flagById(consent.ruleId))!;
assert.equal(withdrawn.acknowledgement, undefined);
assert.equal(withdrawn.remediationStatus, "open");

// ---- obligations: acknowledge leaves the occurrence counted; reopen withdraws it
const occurrence = "home:compliance-ca-bc-societies-annual-report:2025-07-31";
await obligations.acknowledgeDecisionPortable(ctx, { societyId: S, ruleId: occurrence, flagLevel: "warn", flagText: "Annual report", evidenceRequired: [], notes: "Waiting on the AGM date" });
let decision = (await remediationRows()).find((row) => row.ruleId === occurrence)!;
assert.equal(decision.status, "acknowledged");
assert.equal(decision.acknowledgedByName, "Mina Patel");
assert.equal(decisionWaivesFinding(occurrence, decision), false, "an acknowledged overdue occurrence stays in the counts");
await obligations.reopenDecisionPortable(ctx, { societyId: S, ruleId: occurrence, flagLevel: "warn", flagText: "Annual report", evidenceRequired: [] });
decision = (await remediationRows()).find((row) => row.ruleId === occurrence)!;
assert.equal(decision.status, "open");
assert.equal(decision.acknowledgedAtISO, undefined, "reopening withdraws the acknowledgement");

// ---- a recommendation can still be dismissed and restored
const recommendation = demoFlags.find((row) => row.dismissable)!;
assert.ok(recommendation, "the demo has a recommendation to dismiss");
await assert.rejects(
  remediation.dismissItemPortable(ctx, { societyId: S, ruleId: recommendation.ruleId, flagLevel: "err", flagText: recommendation.text }),
  /changed/,
  "a client acting on a stale level is refused",
);
await remediation.dismissItemPortable(ctx, { societyId: S, ruleId: recommendation.ruleId, flagLevel: recommendation.level, flagText: "client text is not stored", reason: "  Covered by the board's own review  " });
const dismissed = (await flagById(recommendation.ruleId))!;
assert.equal(dismissed.dismissal?.reason, "Covered by the board's own review");
assert.equal(dismissed.dismissal?.dismissedByName, "Mina Patel", "records who dismissed it");
assert.ok(dismissed.dismissal?.dismissedAtISO, "records when");
assert.equal(dismissed.remediationStatus, "dismissed");
assert.equal(outstanding(await flags()), outstanding(demoFlags) - 1, "a dismissed recommendation leaves the counts");
const stored = (await remediationRows()).find((row) => row.ruleId === recommendation.ruleId)!;
assert.equal(stored.societyId, S, "the dismissal belongs to this workspace");
assert.equal(stored.dismissedByUserId, owner._id);
assert.equal(stored.flagLevel, recommendation.level, "keyed to the level the server computed");
assert.equal(stored.flagText, recommendation.text, "the server's text, not the client's");
assert.equal(stored.dismissedSubjectKey, recommendation.subjectKey, "and to the finding's subject");
assert.ok((await db.query("activity").collect()).some((row) => row.action === "dashboard-item-dismissed" && row.societyId === S));

// The same row at another level (the flag escalated) no longer hides it.
await db.patch(stored._id, { flagLevel: "err" });
const escalated = (await flagById(recommendation.ruleId))!;
assert.equal(escalated.dismissal, undefined, "a dismissal at another level shows the item again");
assert.equal(escalated.remediationStatus, undefined);
await db.patch(stored._id, { flagLevel: recommendation.level });

// Restore: a row the dismissal created goes away; the activity log keeps the history.
assert.deepEqual(await remediation.restoreItemPortable(ctx, { societyId: S, ruleId: recommendation.ruleId }), { restored: true });
assert.equal((await flagById(recommendation.ruleId))!.dismissal, undefined);
assert.equal((await remediationRows()).some((row) => row.ruleId === recommendation.ruleId), false);
assert.deepEqual(await remediation.restoreItemPortable(ctx, { societyId: S, ruleId: recommendation.ruleId }), { restored: false }, "restoring twice is a no-op");

// A row holding a review task returns to it on restore.
const task = await remediation.createComplianceReviewTaskPortable(ctx, { societyId: S, ruleId: recommendation.ruleId, flagLevel: recommendation.level, flagText: recommendation.text, evidenceRequired: recommendation.evidenceRequired });
await remediation.dismissItemPortable(ctx, { societyId: S, ruleId: recommendation.ruleId, flagLevel: recommendation.level });
await remediation.dismissItemPortable(ctx, { societyId: S, ruleId: recommendation.ruleId, reason: "again" });
await remediation.restoreItemPortable(ctx, { societyId: S, ruleId: recommendation.ruleId });
const reopened = (await flagById(recommendation.ruleId))!;
assert.equal(reopened.remediationStatus, "open", "back to the open review workflow, even after dismissing twice");
assert.equal(reopened.remediationTaskId, task.taskId);

// The obligations path cannot hide a recommendation behind the dashboard's back:
// its rows carry no subject key.
await obligations.dismissDecisionPortable(ctx, { societyId: S, ruleId: recommendation.ruleId, flagLevel: recommendation.level, flagText: recommendation.text, evidenceRequired: [] });
assert.equal((await flagById(recommendation.ruleId))!.dismissal, undefined, "a decision without a subject key hides nothing on the dashboard");

// ---- continuity: a recommendation check dismisses; a new subject shows it again
const check = demoChecks.find((row) => row.id === "CONTINUITY-AGREEMENT-OBLIGATIONS" && row.dismissable);
assert.ok(check, "the demo has an agreement recommendation check");
await remediation.dismissItemPortable(ctx, { societyId: S, ruleId: check.id, flagLevel: check.level });
assert.ok((await checks()).find((row) => row.id === check.id)!.dismissal, `${check.id} is dismissed`);
const agreements = await db.query("agreements").collect();
for (const agreement of agreements) {
  const { _id, _creationTime, ...rest } = agreement as PortableDoc & { _creationTime?: number };
  void _id; void _creationTime;
  await db.insert("agreements", rest);
}
const changed = (await checks()).find((row) => row.id === check.id)!;
assert.notEqual(changed.subjectKey, check.subjectKey, "another expiring agreement changes the check's subject");
assert.equal(changed.dismissal, undefined, "a new affected record is not suppressed by the old dismissal");
await remediation.restoreItemPortable(ctx, { societyId: S, ruleId: check.id });

// ---- duplicates: the consent continuity check is left out only while its flag is listed
{
  const { buildAttentionItems, continuityChecksShownAsFlags } = await import("../src/features/dashboard/NeedsAttentionCard");
  const consentFlag = (await flagById("BC-SOC-DIRECTOR-CONSENT"))!;
  const consentCheck = (await checks()).find((row) => row.id === "CONTINUITY-DIRECTOR-CONSENT")!;
  assert.deepEqual(continuityChecksShownAsFlags([consentFlag]), ["CONTINUITY-DIRECTOR-CONSENT"], "desktop: the flag stands in for the check while listed");
  const hiddenFlag = { ...consentFlag, dismissal: { level: "warn" as const, dismissedAtISO: "2026-11-20" } };
  assert.deepEqual(continuityChecksShownAsFlags([hiddenFlag]), [], "a flag that is not listed does not hide its twin");
  assert.deepEqual(continuityChecksShownAsFlags([{ ...consentFlag, ruleId: "LEGAL-bc_company-DIRECTOR-CONSENT" }]), ["CONTINUITY-DIRECTOR-CONSENT"], "corporate consent flags count too");
  const attention = (flagRows: DashboardComplianceFlag[] | undefined) => buildAttentionItems({
    flags: flagRows, checks: [consentCheck], todayISO: "2026-11-21", filingLabel: (kind) => kind, canOpen: () => true,
    flagLink: () => undefined, flagActions: () => null,
  }).map((item) => item.key);
  assert.deepEqual(attention([consentFlag]), ["flag:BC-SOC-DIRECTOR-CONSENT"], "phone: consent listed once, as the compliance item");
  assert.deepEqual(attention([hiddenFlag]), ["continuity:CONTINUITY-DIRECTOR-CONSENT"], "phone: consent never disappears from both");
  assert.deepEqual(attention(undefined), ["continuity:CONTINUITY-DIRECTOR-CONSENT"], "phone: with Compliance hidden, the continuity check shows consent");
}

// ---- the obligation recommendations are good-practice reviews in the rule packs
{
  const { loadComplianceRulePacks } = await import("../src/lib/compliance/registry");
  const rules = new Map(loadComplianceRulePacks().flatMap((pack) => pack.rules.map((rule) => [rule.ruleId, rule] as const)));
  for (const ruleId of OBLIGATION_RECOMMENDATION_RULE_IDS) {
    const rule = rules.get(ruleId);
    assert.ok(rule, `${ruleId} is in a rule pack`);
    assert.equal(rule.creates?.filingKind, undefined, `${ruleId} files nothing`);
    assert.doesNotMatch(rule.authority.displayCitation, /\bss?\.\s*\d/, `${ruleId} cites guidance, not a section`);
  }
}

const societyEvidence = async () => (await db.get(S)) as PortableDoc & Record<string, unknown>;
const originalSociety = await societyEvidence();
const restoreSocietyEvidence = () => db.patch(S, {
  constitutionDocId: originalSociety.constitutionDocId,
  bylawsDocId: originalSociety.bylawsDocId,
  governingDocumentEvidence: originalSociety.governingDocumentEvidence,
  governingDocumentVerifications: originalSociety.governingDocumentVerifications,
  privacyProgramStatus: originalSociety.privacyProgramStatus,
  privacyProgramReview: originalSociety.privacyProgramReview,
});

// ---- currentness notes are dismissable and come back when the copy changes
{
  const ruleId = "BC-SOC-CONSTITUTION-EVIDENCE";
  assert.ok(originalSociety.constitutionDocId, "the demo has an uploaded constitution");
  await db.patch(S, { governingDocumentVerifications: [] });
  const note = (await flagById(ruleId))!;
  assert.equal(note.level, "info", "an identified, unverified copy is an info note");
  assert.equal(note.requirementBasis, "recommendation");
  assert.ok(note.dismissable, "the currentness note can be dismissed");
  await remediation.dismissItemPortable(ctx, { societyId: S, ruleId, flagLevel: "info", reason: "Checked against the registry" });
  assert.ok((await flagById(ruleId))!.dismissal, "dismissed while the same copy is on record");
  const storedNote = (await remediationRows()).find((row) => row.ruleId === ruleId)!;
  assert.equal(storedNote.dismissedSubjectKey, note.subjectKey);

  await db.patch(S, { constitutionDocId: "doc_replacement_constitution" });
  const replaced = (await flagById(ruleId))!;
  assert.equal(replaced.level, "info");
  assert.notEqual(replaced.subjectKey, note.subjectKey, "a replaced document is a new subject");
  assert.equal(replaced.dismissal, undefined, "replacing the document brings the note back");
  await db.patch(S, { constitutionDocId: originalSociety.constitutionDocId });
  assert.ok((await flagById(ruleId))!.dismissal, "the original copy is still dismissed");

  // A copy held elsewhere: recording a different external copy brings it back.
  const external = { field: "constitutionDocId", kind: "external", reference: "BC Registry filing 1234", recordedAtISO: "2026-11-01T10:00:00.000Z", recordedByName: "Mina Patel" };
  await db.patch(S, { constitutionDocId: undefined, governingDocumentEvidence: [external] });
  const held = (await flagById(ruleId))!;
  assert.equal(held.level, "info");
  assert.equal(held.dismissal, undefined, "a held-elsewhere copy is another copy");
  await remediation.dismissItemPortable(ctx, { societyId: S, ruleId, flagLevel: "info" });
  assert.ok((await flagById(ruleId))!.dismissal);
  await db.patch(S, { governingDocumentEvidence: [{ ...external, reference: "BC Registry filing 5678", recordedAtISO: "2026-11-20T10:00:00.000Z" }] });
  assert.equal((await flagById(ruleId))!.dismissal, undefined, "recording a different external copy brings the note back");
  await db.patch(S, { governingDocumentEvidence: [{ ...external, recordedAtISO: "2026-11-21T10:00:00.000Z" }] });
  assert.equal((await flagById(ruleId))!.dismissal, undefined, "re-recording the entry is a new copy too");

  // No copy identified: statutory, refused whatever the client sends, and counted.
  await db.patch(S, { governingDocumentEvidence: [] });
  const missing = (await flagById(ruleId))!;
  assert.equal(missing.level, "warn");
  assert.equal(missing.requirementBasis, "statutory");
  assert.equal(missing.dismissable, false);
  assert.equal(missing.dismissal, undefined, "the old info dismissal hides nothing at warn");
  for (const flagLevel of ["warn", undefined]) {
    await assert.rejects(remediation.dismissItemPortable(ctx, { societyId: S, ruleId, flagLevel }), /requirement/, "a governing document not identified cannot be dismissed");
  }
  await assert.rejects(remediation.dismissItemPortable(ctx, { societyId: S, ruleId, flagLevel: "info" }), /changed/, "a stale info level is refused");
  await assert.rejects(
    obligations.dismissDecisionPortable(ctx, { societyId: S, ruleId, flagLevel: "info", flagText: "x", evidenceRequired: [] }),
    /requirement/,
    "the obligations path applies the rule-wide (stricter) basis",
  );
  await remediation.restoreItemPortable(ctx, { societyId: S, ruleId });
  await restoreSocietyEvidence();
  assert.equal((await flagById(ruleId)), undefined, "a verified copy raises nothing");
}

// ---- the privacy note without a review stays a requirement; its fix is Record review
{
  const ruleId = "PIPA-POLICY-DOCUMENTED";
  await db.patch(S, { privacyProgramStatus: "Documented", privacyProgramReview: undefined });
  const note = (await flagById(ruleId))!;
  assert.equal(note.level, "info");
  assert.equal(note.requirementBasis, "statutory");
  assert.equal(note.dismissable, false);
  assert.equal(note.remediationActions[0]?.label, "Record review", "Record review is the row's action");
  assert.ok(note.remediationActions[0]?.to?.includes("record=privacy-review"), "and opens the review form");
  assert.ok(!note.remediationActions.some((action) => action.intent === "createPipaPolicyDraft"), "no policy template for a program marked documented");
  assert.ok(note.remediationActions.some((action) => action.intent === "createPrivacyReviewTask"), "a follow-up can still be assigned");
  for (const flagLevel of ["info", undefined]) {
    await assert.rejects(remediation.dismissItemPortable(ctx, { societyId: S, ruleId, flagLevel }), /requirement/, "the privacy note refuses dismissal");
  }
  await remediation.acknowledgeItemPortable(ctx, { societyId: S, ruleId, flagLevel: "info" });
  assert.ok((await flagById(ruleId))!.acknowledgement, "it can be acknowledged");
  await remediation.restoreItemPortable(ctx, { societyId: S, ruleId });
  assert.equal((await remediationRows()).some((row) => row.ruleId === ruleId), false, "withdrawing removes the row it made");
  await restoreSocietyEvidence();
}

// ---- obligations: recommendation occurrences dismiss and restore; the next one shows
{
  const occurrenceKey = (date: string) => `home:compliance-ca-fed-cbca-corporation-key-custody:${date}`;
  const thisYear = occurrenceKey("2026-03-31");
  const nextYear = occurrenceKey("2027-03-31");
  const payload = (ruleId: string) => ({ societyId: S, ruleId, flagLevel: "warn", flagText: "Corporation key custody review", evidenceRequired: [] });
  const decisionFor = async (ruleId: string) => (await remediationRows()).find((row) => row.ruleId === ruleId);
  await obligations.dismissDecisionPortable(ctx, payload(thisYear));
  assert.equal((await decisionFor(thisYear))?.status, "dismissed");
  assert.ok(decisionWaivesFinding(thisYear, await decisionFor(thisYear)), "a dismissed recommendation occurrence leaves the counts");
  assert.equal(await decisionFor(nextYear), undefined, "the next occurrence has no decision");
  assert.equal(decisionWaivesFinding(nextYear, await decisionFor(nextYear)), false, "so the next period still counts");
  await obligations.reopenDecisionPortable(ctx, payload(thisYear));
  assert.equal(decisionWaivesFinding(thisYear, await decisionFor(thisYear)), false, "restoring puts it back in the counts");
  const statutory = "home:compliance-ca-fed-cbca-annual-return-window:2026-06-30";
  await assert.rejects(obligations.dismissDecisionPortable(ctx, payload(statutory)), /requirement/, "a statutory filing occurrence is refused");
  await assert.rejects(obligations.dismissDecisionPortable(ctx, payload("home:compliance-ca-bc-company-records-review:2026-03-31")), /requirement/, "a review citing a section is refused");
  assert.equal(await decisionFor(statutory), undefined);
}

// ---- snooze: still listed and counted, out of nudges; ends by date, subject or escalation
{
  const inDays = (days: number) => {
    const date = new Date();
    date.setDate(date.getDate() + days);
    return todayDateOnly(date);
  };
  const ruleId = "BC-SOC-DIRECTOR-CONSENT";
  const before = await flags();
  const consentNow = before.find((row) => row.ruleId === ruleId)!;
  assert.ok(consentNow.level === "warn" && !consentNow.dismissable && !consentNow.snooze);
  await assert.rejects(
    remediation.snoozeItemPortable(ctx, { societyId: S, ruleId: "PRIVACY-APPLICABILITY", flagLevel: "warn", untilISO: inDays(7) }),
    /recommendation/,
    "a recommendation is dismissed, not snoozed",
  );
  await assert.rejects(remediation.snoozeItemPortable(ctx, { societyId: S, ruleId, flagLevel: "warn", untilISO: inDays(0) }), /after today/);
  await assert.rejects(remediation.snoozeItemPortable(ctx, { societyId: S, ruleId, flagLevel: "err", untilISO: inDays(7) }), /changed/, "a stale level is refused");
  await remediation.snoozeItemPortable(ctx, { societyId: S, ruleId, flagLevel: "warn", untilISO: inDays(7) });
  const snoozed = (await flagById(ruleId))!;
  assert.deepEqual(snoozed.snooze, { untilISO: inDays(7), snoozedByName: "Mina Patel" });
  assert.equal(snoozed.dismissal, undefined, "a snooze hides nothing");
  assert.equal(snoozed.remediationStatus, "open", "the row keeps its review workflow");
  assert.equal(outstanding(await flags()), outstanding(before), "a snoozed requirement stays in the counts");
  assert.ok(!nudgeableFindings(await flags()).some((row) => row.ruleId === ruleId), "and is left out of nudges");
  assert.ok(nudgeableFindings(await flags()).some((row) => row.ruleId === "PRIVACY-APPLICABILITY"), "other findings still nudge");
  assert.ok((await db.query("activity").collect()).some((row) => row.action === "dashboard-item-snoozed"));

  const stored = (await remediationRows()).find((row) => row.ruleId === ruleId)!;
  assert.equal(stored.snoozedSubjectKey, consentNow.subjectKey);
  assert.equal(stored.snoozedLevel, "warn");
  assert.equal(stored.snoozedByUserId, owner._id);
  await db.patch(stored._id, { snoozedUntilISO: inDays(0) });
  assert.equal((await flagById(ruleId))!.snooze, undefined, "the snooze ends on its date");
  await db.patch(stored._id, { snoozedUntilISO: inDays(7), snoozedLevel: "info" });
  assert.equal((await flagById(ruleId))!.snooze, undefined, "a finding more serious than when snoozed reminds again");
  await db.patch(stored._id, { snoozedLevel: "warn", snoozedSubjectKey: "BC-SOC-DIRECTOR-CONSENT@v1:00000000" });
  assert.equal((await flagById(ruleId))!.snooze, undefined, "a snooze for other directors does not apply");
  await db.patch(stored._id, { snoozedSubjectKey: consentNow.subjectKey });
  assert.ok((await flagById(ruleId))!.snooze);
  assert.deepEqual(await remediation.cancelSnoozePortable(ctx, { societyId: S, ruleId }), { cancelled: true });
  const cancelled = (await remediationRows()).find((row) => row.ruleId === ruleId)!;
  assert.equal(cancelled.snoozedUntilISO, undefined);
  assert.equal(cancelled.status, "open", "cancelling keeps the review workflow");
  assert.deepEqual(await remediation.cancelSnoozePortable(ctx, { societyId: S, ruleId }), { cancelled: false });

  // A continuity requirement: a row made by a snooze, kept while acknowledged, removed when both end.
  const checkId = "CONTINUITY-AGM-THIS-YEAR";
  const agm = (await checks()).find((row) => row.id === checkId)!;
  assert.ok(agm && !agm.dismissable && agm.level === "warn");
  await remediation.snoozeItemPortable(ctx, { societyId: S, ruleId: checkId, flagLevel: agm.level, untilISO: inDays(30) });
  const agmSnoozed = (await checks()).find((row) => row.id === checkId)!;
  assert.equal(agmSnoozed.snooze?.untilISO, inDays(30));
  assert.equal(agmSnoozed.dismissal, undefined);
  assert.equal((await remediationRows()).find((row) => row.ruleId === checkId)?.status, "snoozed");
  await remediation.acknowledgeItemPortable(ctx, { societyId: S, ruleId: checkId, flagLevel: agm.level });
  await remediation.restoreItemPortable(ctx, { societyId: S, ruleId: checkId });
  assert.equal((await remediationRows()).find((row) => row.ruleId === checkId)?.status, "snoozed", "withdrawing the acknowledgement keeps the snooze");
  assert.ok((await checks()).find((row) => row.id === checkId)!.snooze);
  await remediation.cancelSnoozePortable(ctx, { societyId: S, ruleId: checkId });
  assert.equal((await remediationRows()).some((row) => row.ruleId === checkId), false, "a row only the snooze held is removed");

  // Phone list: the snoozed item stays listed, after the others of its severity.
  {
    const { buildAttentionItems } = await import("../src/features/dashboard/NeedsAttentionCard");
    const consentFlag = (await flagById(ruleId))!;
    const privacy = (await flagById("PRIVACY-APPLICABILITY"))!;
    const list = (rows: DashboardComplianceFlag[]) => buildAttentionItems({
      flags: rows, todayISO: inDays(0), filingLabel: (kind) => kind, canOpen: () => true, flagLink: () => undefined, flagActions: () => null,
    });
    const snoozedFlag = { ...consentFlag, snooze: { untilISO: inDays(7) } };
    const items = list([snoozedFlag, { ...privacy, dismissal: undefined }]);
    assert.deepEqual(items.map((item) => item.key), [`flag:${privacy.ruleId}`, `flag:${ruleId}`], "snoozed after the others");
    assert.match(items[1].snoozedLabel ?? "", /^Snoozed until /);
  }

  // Obligation requirements can be snoozed too; recommendations cannot.
  const occurrence = "home:compliance-ca-bc-societies-annual-report:2026-07-31";
  await remediation.snoozeItemPortable(ctx, { societyId: S, ruleId: occurrence, flagLevel: "info", flagText: "Annual report", untilISO: inDays(14) });
  const decision = (await remediationRows()).find((row) => row.ruleId === occurrence)!;
  assert.ok(activeSnooze(decision, { level: "info", subjectKey: occurrence }, inDays(0)), "snoozed while upcoming");
  assert.equal(activeSnooze(decision, { level: "warn", subjectKey: occurrence }, inDays(0)), undefined, "reminds again once it is past its date");
  assert.equal(decisionWaivesFinding(occurrence, decision), false, "a snoozed occurrence stays in the counts");
  await assert.rejects(
    remediation.snoozeItemPortable(ctx, { societyId: S, ruleId: "home:compliance-ca-fed-cbca-corporation-key-custody:2026-03-31", flagLevel: "warn", untilISO: inDays(7) }),
    /recommendation/,
  );
  await remediation.cancelSnoozePortable(ctx, { societyId: S, ruleId: occurrence });
}

// ---- Assign follow-up on an open task reassigns it; a closed task gets a new one
{
  const ruleId = "BC-SOC-DIRECTOR-CONSENT";
  const current = (await flagById(ruleId))!;
  const existingTaskId = String(current.remediationTaskId);
  const args = { societyId: S, ruleId, flagLevel: current.level, flagText: current.text, evidenceRequired: current.evidenceRequired };
  const kept = await remediation.createComplianceReviewTaskPortable(ctx, { ...args, assignee: "Jordan Lee", dueDate: "2026-12-15" });
  assert.equal(kept.taskId, existingTaskId);
  assert.ok(kept.reused && !kept.reassigned, "the same owner and date change nothing");
  const reassigned = await remediation.createComplianceReviewTaskPortable(ctx, { ...args, assignee: "Priya Shah", dueDate: "2027-01-10" });
  assert.equal(reassigned.taskId, existingTaskId, "the open task is updated, not duplicated");
  assert.ok(reassigned.reused && reassigned.reassigned);
  const task = (await db.get(existingTaskId)) as PortableDoc & Record<string, unknown>;
  assert.equal(task.assignee, "Priya Shah");
  assert.equal(task.dueDate, "2027-01-10");
  assert.deepEqual((await flagById(ruleId))!.followUp, { assignee: "Priya Shah", dueDate: "2027-01-10" });
  assert.ok((await db.query("activity").collect()).some((row) => row.action === "follow-up-reassigned" && row.summary === "Follow-up reassigned to Priya Shah, due 2027-01-10"));
  const tasksFor = async () => (await db.query("tasks").collect()).filter((row) => row.eventId === `compliance:${ruleId}`);
  assert.equal((await tasksFor()).length, 1);
  await db.patch(existingTaskId, { status: "Done" });
  const fresh = await remediation.createComplianceReviewTaskPortable(ctx, { ...args, assignee: "Sam Ortiz" });
  assert.notEqual(fresh.taskId, existingTaskId, "a closed task is left as history");
  assert.ok(!fresh.reused);
  assert.equal((await tasksFor()).length, 2);
  assert.deepEqual((await flagById(ruleId))!.followUp, { assignee: "Sam Ortiz" });
}

console.log(`Dashboard dismissals: ${demoFlags.filter((row) => row.dismissable).length} of ${demoFlags.length} demo flags and ${demoChecks.filter((row) => row.dismissable).length} of ${demoChecks.length} continuity checks are dismissable; requirements refuse dismissal on both paths.`);
